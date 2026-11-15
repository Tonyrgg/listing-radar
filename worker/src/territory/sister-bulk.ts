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
  private recoveryReason: string | null = null;
  constructor(private app: TerritoryApplication, private store: TerritoryStore, private notify: () => void,
    private readonly recoveryDelayMs = 5000) {
    this.app.onBulkPause = reason => { if (reason) this.recoveryReason = reason; else this.stopping = true; };
  }
  get active() { return this.execution !== null; }
  list() {
    const state = this.store.read();
    return { active: this.active, entries: state.streets.flatMap(street => {
      const entry = state.memories[street.id]?.sisterQueue;
      if (!entry || street.outsideUrbanArea) return [];
      const run = state.runs.find(r => r.id === entry.runId);
      return [{ ...entry, streetId: street.id, name: street.name, municipality: street.locality,
        status: run?.state === 'completed' ? 'completed' : entry.status === 'running' && !this.active ? 'paused' : entry.status,
        handled: run?.handled ?? 0, total: run?.total ?? null, error: entry.error ?? run?.error }];
    }).sort((a,b) => a.addedAt.localeCompare(b.addedAt) || a.streetId.localeCompare(b.streetId)) };
  }
  async put(value: unknown) {
    if (this.active || this.app.hasActiveRun) throw Error('Metti in pausa prima di modificare la coda Sister');
    const {streetId, search} = sisterQueueInput.parse(value);
    if (!search.searchText || !search.resultName) throw Error('Inserisci parola chiave e voce esatta Sister');
    const street = this.store.read().streets.find(s => s.id === streetId);
    if (!street || street.linkedOfficialId || street.needsReview || street.outsideUrbanArea) throw Error('Scegli una via identificata');
    const existing = this.store.read().memories[streetId]?.sisterQueue;
    if (existing?.runId) throw Error('Rimuovi la riga prima di preparare una nuova acquisizione; lo storico rimane conservato');
    await this.app.configureSisterStreet(streetId, search);
    await this.store.change(s => {
      const memory = s.memories[streetId]!;
      memory.sisterQueue = {...search, addedAt: existing?.addedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'ready'};
    }); this.notify();
  }
  /** One durable mutation, no browser work and no automatic acquisition start. */
  async putMany(streetIds:string[]){
    if(this.active||this.app.hasActiveRun)throw Error('Metti in pausa prima di modificare la coda Sister');
    const result=await this.store.change(state=>{
      if(this.active||this.app.hasActiveRun)throw Error('Una lavorazione è già in corso');
      let added=0,alreadyQueued=0;const excluded:string[]=[];
      for(const id of new Set(streetIds)){
        const street=state.streets.find(s=>s.id===id);
        if(!street||street.linkedOfficialId||street.needsReview||street.outsideUrbanArea){excluded.push(id);continue;}
        const memory=state.memories[id];if(!memory){excluded.push(id);continue;}
        const previous=memory.sisterQueue,previousRun=previous?.runId?state.runs.find(r=>r.id===previous.runId):null;
        if(previous&&previousRun?.state!=='completed'&&!(previous.status==='completed'&&!previousRun)){alreadyQueued++;continue;}
        const saved=memory.sisterSearch;
        const resultName=saved?.resultName?.trim()||street.sisterName?.trim();
        const searchText=saved?.searchText?.trim()||resultName?.split(/\s+/).filter(word=>/[A-ZÀ-Ü]{3}/i.test(word)&&!(/^[IVXLCDM]+$/i.test(word))&&!['VIA','PIAZZA','CORSO','VIALE','LARGO','VICO','STRADA','TRAVERSA','CONTRADA','PIAZZALE'].includes(word.toUpperCase())).at(-1)||'';
        if(!resultName||!searchText){excluded.push(id);continue;}
        const search=sisterStreetSettingsSchema.parse({searchText,resultName}),at=new Date().toISOString();
        memory.sisterSearch=search;memory.sisterQueue={...search,addedAt:at,updatedAt:at,status:'ready'};added++;
      }
      return{added,alreadyQueued,excluded};
    });this.notify();return result;
  }
  async remove(streetId: string) {
    if (this.active || this.app.hasActiveRun) throw Error('Metti in pausa prima di modificare la coda Sister');
    await this.store.change(s => { if(s.memories[streetId]) delete s.memories[streetId]!.sisterQueue; }); this.notify();
  }
  pause(reason?: string) { this.app.pause(reason); }
  start(beforeStreet: () => Promise<void>) {
    if (this.active || this.app.hasActiveRun) throw Error('Esiste già una lavorazione attiva');
    const ids = this.list().entries.filter(e => e.status !== 'completed').map(e => e.streetId);
    if (!ids.length) throw Error('Aggiungi almeno una via da acquisire');
    this.stopping = false; this.recoveryReason = null;
    this.execution = this.execute(ids, beforeStreet).finally(() => { this.execution = null; this.app.bulkExecution = null; this.notify(); });
    this.app.bulkExecution = this.execution;
    this.notify();
  }
  async waitForIdle() { await this.execution; }
  private async execute(ids: string[], beforeStreet: () => Promise<void>) {
    for (const id of ids) {
      for (let attempt = 0; ; attempt++) {
        if (this.stopping) return;
        this.recoveryReason = null;
        try {
          // Production acknowledges the latest state and proves exclusive
          // ownership of the execution lease before recovering a stale run.
          await beforeStreet();
          if (this.stopping) return;
          const entry = this.store.readSelected(s => s.memories[id]?.sisterQueue);
          if (!entry) break;
          let prior = this.store.readSelected(s => s.runs.find(r => r.id === entry.runId));
          if (entry.runId && !prior) throw Error('Checkpoint della coda non trovato: dati conservati, verifica la memoria online');
          if (prior?.state === 'running') {
            await this.app.recoverInterruptedSisterRun(id, prior.id);
            prior = this.store.readSelected(s => s.runs.find(r => r.id === entry.runId));
          }
          if (prior?.state === 'completed' || entry.status === 'completed' && !prior) {
            await this.update(id, {status:'completed', error:undefined});
            break;
          }
          if (prior && !['paused','failed'].includes(prior.state)) throw Error('Questo checkpoint non è riprendibile: nessuna nuova acquisizione avviata');
          await this.app.configureSisterStreet(id, {searchText:entry.searchText,resultName:entry.resultName});
          this.recoveryReason = null;
          const runId = await this.app.start(id, 'scan', [], prior?.id, prior ? undefined : runSettings(), undefined, true);
          // start() already saves the run reference and queue state atomically.
          await this.app.waitForCurrent();
          const run = this.store.readSelected(s => s.runs.find(r => r.id === runId));
          if (run?.state !== 'completed') throw Error(this.recoveryReason || run?.error || 'Acquisizione in pausa: riprendi dal checkpoint');
          await this.update(id, {status:'completed', error:undefined});
          await beforeStreet(); // Acknowledged online before advancing.
          break;
        } catch (error) {
          const message = sanitizeSensitiveText(error instanceof Error ? error.message : 'Acquisizione interrotta');
          const entry = this.store.readSelected(s => s.memories[id]?.sisterQueue);
          const run = this.store.readSelected(s => s.runs.find(r => r.id === entry?.runId));
          const completed = run?.state === 'completed';
          const retry = !this.stopping && attempt < 2 && isTransientSisterInterruption(message);
          await this.update(id, {status: completed ? 'completed' : retry ? 'running' : 'paused',
            error: retry ? `Ripresa automatica ${attempt + 1}/2: ${message}` : message});
          if (!retry) return;
          const until = Date.now() + this.recoveryDelayMs;
          while (!this.stopping && Date.now() < until)
            await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
        }
      }
    }
  }
  private async update(id: string, patch: Partial<SisterQueueEntry>) {
    await this.store.change(s => { const entry=s.memories[id]?.sisterQueue; if(entry) Object.assign(entry, patch, {updatedAt:new Date().toISOString()}); }); this.notify();
  }
}

/** Retry transport/navigation failures, never an ambiguous identity or login. */
export function isTransientSisterInterruption(message: string): boolean {
  if (/session_expired|sessione.{0,20}scadut|autentic|login|accedi|password|captcha|via diversa|corrispondenza|non associato|checkpoint.{0,20}non trovato|altro PC/i.test(message)) return false;
  return /timeout|timed out|ECONN|ENOTFOUND|ERR_(?:NETWORK|CONNECTION)|fetch failed|socket|connessione|connection|rete|online|sincronizz|sessione condivisa|Chrome.{0,30}(?:chius|raggiung)|(?:page|target|browser|context).{0,30}closed|interrupted/i.test(message);
}
