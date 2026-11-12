import { z } from 'zod';
import type { TerritoryApplication } from './application.js';
import type { TerritoryStore } from './store.js';
import { sisterStreetSettingsSchema } from './sister-street-settings.js';
import { runSettings } from './run-options.js';
import { sanitizeSensitiveText } from '../logger.js';

export type SisterQueueEntry = { searchText: string; resultName: string; addedAt: string; updatedAt: string; runId?: string; status: 'ready'|'running'|'paused'|'completed'; error?: string };
export const sisterQueueInput = z.object({ streetId: z.string().min(1).max(200), search: sisterStreetSettingsSchema }).strict();

/** Queue metadata shares the existing per-street records and their CAS protocol. */
export class SisterBulk {
  private execution: Promise<void> | null = null;
  private stopping = false;
  constructor(private app: TerritoryApplication, private store: TerritoryStore, private notify: () => void) { this.app.onBulkPause = () => { this.stopping = true; }; }
  get active() { return this.execution !== null; }
  list() {
    const state = this.store.read();
    return { active: this.active, entries: state.streets.flatMap(street => {
      const entry = state.memories[street.id]?.sisterQueue;
      if (!entry) return [];
      const run = state.runs.find(r => r.id === entry.runId);
      return [{ ...entry, streetId: street.id, name: street.name, municipality: street.locality,
        status: run?.state === 'completed' ? 'completed' : entry.status === 'running' && !this.active ? 'paused' : entry.status,
        handled: run?.handled ?? 0, total: run?.total ?? null, error: run?.error ?? entry.error }];
    }).sort((a,b) => a.addedAt.localeCompare(b.addedAt) || a.streetId.localeCompare(b.streetId)) };
  }
  async put(value: unknown) {
    if (this.active || this.app.hasActiveRun) throw Error('Metti in pausa prima di modificare la coda Sister');
    const {streetId, search} = sisterQueueInput.parse(value);
    if (!search.searchText || !search.resultName) throw Error('Inserisci parola chiave e voce esatta Sister');
    const street = this.store.read().streets.find(s => s.id === streetId);
    if (!street || street.linkedOfficialId || street.needsReview) throw Error('Scegli una via identificata');
    const existing = this.store.read().memories[streetId]?.sisterQueue;
    if (existing?.runId) throw Error('Rimuovi la riga prima di preparare una nuova acquisizione; lo storico rimane conservato');
    await this.app.configureSisterStreet(streetId, search);
    await this.store.change(s => {
      const memory = s.memories[streetId]!;
      memory.sisterQueue = {...search, addedAt: existing?.addedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'ready'};
    }); this.notify();
  }
  async remove(streetId: string) {
    if (this.active || this.app.hasActiveRun) throw Error('Metti in pausa prima di modificare la coda Sister');
    await this.store.change(s => { if(s.memories[streetId]) delete s.memories[streetId]!.sisterQueue; }); this.notify();
  }
  pause() { this.stopping = true; this.app.pause(); }
  start(beforeStreet: () => Promise<void>) {
    if (this.active || this.app.hasActiveRun) throw Error('Esiste già una lavorazione attiva');
    const ids = this.list().entries.filter(e => e.status !== 'completed').map(e => e.streetId);
    if (!ids.length) throw Error('Aggiungi almeno una via da acquisire');
    this.stopping = false;
    this.execution = this.execute(ids, beforeStreet).finally(() => { this.execution = null; this.app.bulkExecution = null; this.notify(); });
    this.app.bulkExecution = this.execution;
    this.notify();
  }
  async waitForIdle() { await this.execution; }
  private async execute(ids: string[], beforeStreet: () => Promise<void>) {
    for (const id of ids) {
      if (this.stopping) break;
      try {
        await beforeStreet();
        if (this.stopping) break;
        const entry = this.store.read().memories[id]?.sisterQueue;
        if (!entry || entry.status === 'completed') continue;
        const prior = this.store.read().runs.find(r => r.id === entry.runId);
        if (prior?.state === 'completed') { await this.update(id, {status:'completed'}); continue; }
        if (prior && !['paused','failed'].includes(prior.state)) throw Error('Acquisizione interrotta: verifica lo stato della via prima di riprendere');
        await this.app.configureSisterStreet(id, {searchText:entry.searchText,resultName:entry.resultName});
        const runId = await this.app.start(id, 'scan', [], prior?.id, prior ? undefined : runSettings(), undefined, true);
        await this.update(id, {runId, status:'running', error:undefined});
        await this.app.waitForCurrent();
        const run = this.store.read().runs.find(r => r.id === runId);
        if (run?.state !== 'completed') throw Error(run?.error || 'Acquisizione in pausa: riprendi dal checkpoint');
        await this.update(id, {status:'completed', error:undefined});
        await beforeStreet(); // Acknowledged online before advancing to another street.
      } catch (error) {
        this.app.pause(); await this.app.waitForCurrent();
        await this.update(id, {status:'paused', error:sanitizeSensitiveText(error instanceof Error ? error.message : 'Acquisizione interrotta')});
        break;
      }
    }
  }
  private async update(id: string, patch: Partial<SisterQueueEntry>) {
    await this.store.change(s => { const entry=s.memories[id]?.sisterQueue; if(entry) Object.assign(entry, patch, {updatedAt:new Date().toISOString()}); }); this.notify();
  }
}
