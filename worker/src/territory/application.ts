import { randomUUID } from "node:crypto";
import { ImportV2Engine } from "../import-v2/engine.js";
import { buildPlan } from "../import-v2/identity.js";
import { sanitizeSensitiveText } from "../logger.js";
import { TerritoryImportStore } from "./import-store.js";
import { assess } from "./reconcile.js";
import { effectiveSource, latest, streetSummary, unitKey, type Run, type SourceProperty, type Unit } from "./types.js";
import { TerritoryStore } from "./store.js";
import type { TerritoryProvider } from "./providers.js";
import { associateHistory } from "./history.js";
import { applyNetworkBindings } from "./network.js";
import { relatedStreetIds } from "./model.js";
import { importProgress } from "./progress.js";
import { runSettings, sourceForApply } from "./run-options.js";
import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";

const now = () => new Date().toISOString();
const publicRun = ({ applySources: _sources, checkpoint: _checkpoint, ...run }: Run) => run;
const observationData = (source: SourceProperty) => JSON.stringify({ ...source, sourcePropertyId: undefined, jobId: undefined, owners: source.owners.map(({ sourcePersonId: _id, ...owner }) => owner) });
export class TerritoryApplication {
  private active: { runId: string; pause: boolean } | null = null;
  private execution: Promise<void> | null = null;
  private fatalError: string | null = null;
  constructor(readonly store: TerritoryStore, private readonly provider: TerritoryProvider, private readonly changed: () => void = () => {}) {}
  get origin() { return this.provider.origin; }
  get hasActiveRun() { return this.active !== null; }
  historyReview() { return this.store.read().history?.flatMap(job => job.issues.map(issue => ({ jobId: job.id, propertyId: issue.propertyId, address: issue.address, reason: issue.reason, canAssociate: Boolean(issue.source), cadastral: issue.source?.cadastral ?? null }))) ?? []; }
  async associate(propertyId: string, streetId: string) { if (this.active) throw new Error("Metti in pausa prima di associare lo storico"); await associateHistory(this.store, propertyId, streetId); this.changed(); }
  isPaused = () => Boolean(this.active?.pause);
  snapshot() {
    const state = this.store.read();
    const activeRun = this.active ? state.runs.find(r => r.id === this.active!.runId) : undefined;
    return { origin: this.provider.origin, error: this.fatalError, historyIssues: state.history?.reduce((n, job) => n + job.issues.length, 0) ?? 0, network: { official: state.streets.filter(s => s.catalogKind !== "network").length, paths: state.streets.filter(s => s.catalogKind === "network").length, linked: Object.keys(state.networkBindings ?? {}).length }, streets: state.streets.filter(s => !s.linkedOfficialId).map(s => streetSummary(state, s)), activeRun: activeRun ? publicRun(activeRun) : null };
  }
  detail(streetId: string) {
    const state = this.store.read(); const requested = state.streets.find(s => s.id === streetId);
    const street = requested?.linkedOfficialId ? state.streets.find(s => s.id === requested.linkedOfficialId) : requested;
    if (!street) throw new Error("Via non trovata");
    streetId = street.id;
    const ids = relatedStreetIds(state, streetId);
    const summary = streetSummary(state, street);
    return { street: summary, history: state.history?.filter(h => h.streetIds.some(id => ids.includes(id))) ?? [], memory: { ...(state.memories[streetId] ?? { note: "" }), attention: summary.attention }, linkedNotes: ids.filter(id => id !== streetId && state.memories[id]?.note).map(id => ({ streetId: id, ...state.memories[id]! })), units: Object.values(state.units).filter(u => u.streetIds.some(id => ids.includes(id))).map(u => ({ ...u, source: effectiveSource(u), origin: latest(u).origin, canWrite: this.provider.canWrite(u.key, effectiveSource(u)) })), runs: state.runs.filter(r => ids.includes(r.streetId)).map(publicRun), events: state.events.filter(e => ids.includes(e.streetId)).slice(-100) };
  }
  async bindNetwork(networkId: string, officialId: string) {
    if (this.active) throw new Error("Attendi la fine dell'operazione prima di associare un tracciato");
    await this.store.change(state => {
      if (Object.values(state.checkpoints).some(c => c.stage !== "completed")) throw new Error("Concludi gli import parziali prima di associare un tracciato");
      const network = state.streets.find(s => s.id === networkId && s.catalogKind === "network" && s.geometry);
      const official = state.streets.find(s => s.id === officialId && s.catalogKind !== "network" && !s.needsReview);
      if (!network || !official) throw new Error("Scegli un tracciato e una via ufficiale valida");
      if (state.networkBindings?.[networkId]) throw new Error("Tracciato già associato: nessuna sostituzione automatica");
      const at = now(); (state.networkBindings ??= {})[networkId] = { officialId, confirmedAt: at, geometry: structuredClone(network.geometry!), evidence: network.geometryEvidence };
      applyNetworkBindings(state);
      state.events.push({ id: randomUUID(), streetId: officialId, at, text: `Tracciato della rete propria associato manualmente: ${network.name}` });
    });
    this.changed();
  }
  async annotate(streetId: string, note: string, attention: boolean) {
    if (!this.store.read().streets.some(s => s.id === streetId)) throw new Error("Via non trovata");
    await this.store.change(s => {
      s.memories[streetId] = { ...s.memories[streetId], note, attention, updatedAt: now() };
      // An explicit flag change on the canonical dossier includes its linked traces.
      for (const id of relatedStreetIds(s, streetId)) if (id !== streetId && s.memories[id]) s.memories[id] = { ...s.memories[id]!, attention, updatedAt: now() };
      s.events.push({ id: randomUUID(), streetId, at: now(), text: attention ? "Via segnata da verificare" : "Annotazioni della via aggiornate" });
    });
    this.changed();
  }
  async correct(key: string, correction: Unit["corrections"], note: string) {
    if (this.active) throw new Error("Metti in pausa e attendi la fine dell'operazione prima di correggere i dati");
    await this.store.change(state => {
      const unit = state.units[key]; if (!unit) throw new Error("Immobile non trovato");
      const source = effectiveSource(unit);
      const checkpoint = state.checkpoints[source.sourcePropertyId];
      if (checkpoint && checkpoint.stage !== "completed") throw new Error("Import parziale: conserva il piano originale e riprendilo prima di cambiare i dati");
      unit.corrections = { ...unit.corrections, ...correction }; unit.note = note; unit.sourceVersionId = randomUUID(); unit.assessment = null;
      for (const streetId of unit.streetIds) state.events.push({ id: randomUUID(), streetId, at: now(), text: "Correzione manuale conservata; serve un nuovo confronto", unitKey: key });
    });
    this.changed();
  }
  async start(streetId: string, operation: Run["operation"], selected: string[] = [], resumeId?: string, settings?: unknown): Promise<string> {
    if (this.active) throw new Error("Una via è già in lavorazione. Mettila in pausa prima di avviarne un'altra.");
    const state = this.store.read(); const street = state.streets.find(s => s.id === streetId);
    if (!street) throw new Error("Via non trovata");
    if (street.linkedOfficialId) return this.start(street.linkedOfficialId, operation, selected, resumeId, settings);
    if (operation === "scan" && street.needsReview) throw new Error("Associa il tratto senza nome a una via ufficiale prima di acquisire");
    const ids = relatedStreetIds(state, streetId);
    const unitKeys = Object.values(state.units).filter(u => u.streetIds.some(id => ids.includes(id))).map(u => u.key);
    if (selected.some(key => !unitKeys.includes(key))) throw new Error("La selezione contiene immobili di un'altra via");
    if (new Set(selected).size !== selected.length) throw new Error("Seleziona ogni immobile una sola volta");
    if (operation === "scan" && unitKeys.some(key => { const checkpoint = state.checkpoints[effectiveSource(state.units[key]!).sourcePropertyId]; return checkpoint && checkpoint.stage !== "completed"; })) throw new Error("Riprendi prima l'import parziale della via: una nuova acquisizione non deve sostituire il suo piano");
    let run: Run;
    if (resumeId) {
      const prior = state.runs.find(r => r.id === resumeId && ids.includes(r.streetId));
      if (!prior || !["paused", "failed"].includes(prior.state) || prior.operation !== operation || prior.origin !== this.origin) throw new Error("Questa operazione non è riprendibile nel profilo corrente");
      run = { ...prior, state: "running", endedAt: null, error: null };
      const scanCheckpoint = prior.operation === "scan" ? prior.checkpoint as SisterStreetRunCheckpoint | undefined : undefined;
      const lockedFilters = scanCheckpoint?.runSettings?.filters ?? scanCheckpoint?.filters;
      run.settings = runSettings(prior.settings ?? (lockedFilters ? { filters: lockedFilters } : undefined));
      if (settings !== undefined && JSON.stringify(runSettings(settings)) !== JSON.stringify(run.settings)) throw new Error("La ripresa conserva le opzioni iniziali. Avvia una nuova run dopo aver concluso questa.");
    } else {
      if (operation === "apply" && !selected.length) throw new Error("Seleziona gli immobili da applicare");
      run = { id: randomUUID(), streetId, operation, origin: this.origin, state: "running", startedAt: now(), endedAt: null, error: null, handled: 0, total: operation === "scan" ? null : (selected.length ? selected.length : unitKeys.length), itemKeys: operation === "scan" ? [] : selected.length ? selected : unitKeys, acquisitionRunId: operation === "apply" ? importProgress(state, ids).acquisitionRunId : null };
      run.settings = runSettings(settings);
    }
    if (operation !== "scan") {
      for (const key of run.itemKeys) {
        const unit = state.units[key]!;
        if ((latest(unit).origin === "simulation") !== (this.origin === "simulation")) throw new Error("Dati simulati e acquisizioni reali usano archivi distinti");
        const checkpoint = state.checkpoints[effectiveSource(unit).sourcePropertyId];
        if (operation === "apply" && !resumeId && checkpoint && checkpoint.stage !== "completed") throw new Error("Riprendi la run originale dell'import parziale prima di cambiarne le opzioni");
        const frozen = run.applySources?.[key];
        if (frozen && buildPlan(frozen).fingerprint !== buildPlan(effectiveSource(unit)).fingerprint) throw new Error("I dati sono cambiati dopo l'avvio: verifica il piano prima di riprendere");
        if (operation === "apply" && !resumeId && run.settings!.importPolicy === "existing_only" && unit.assessment?.kind === "create") throw new Error("Solo schede esistenti: deseleziona gli immobili da creare");
        const resumable = Boolean(resumeId && checkpoint && checkpoint.stage !== "completed");
        if (operation === "apply" && (!this.provider.canWrite(key, effectiveSource(unit)) || (!resumable && !["create", "update", "synced"].includes(unit.assessment?.kind ?? "unknown")))) throw new Error("Un immobile selezionato richiede una verifica o non è autorizzato alle scritture");
      }
    }
    this.active = { runId: run.id, pause: false };
    try { await this.store.change(s => {
      if (operation === "apply" && !resumeId) for (const key of run.itemKeys) {
        const unit = s.units[key]!;
        if (s.checkpoints[effectiveSource(unit).sourcePropertyId]?.stage === "completed") unit.sourceVersionId = randomUUID();
        const observation = latest(unit);
        (run.applySources ??= {})[key] = sourceForApply(effectiveSource(unit), run.settings!, observation.activityEligible ?? !observation.historyPropertyId);
      }
      // Old paused runs retain their original checkpoint activity, never the new UI choices.
      if (operation === "apply" && resumeId && !run.applySources) for (const key of run.itemKeys) {
        const source = effectiveSource(s.units[key]!);
        (run.applySources ??= {})[key] = structuredClone(s.checkpoints[source.sourcePropertyId]?.plan?.source ?? source);
      }
      const i = s.runs.findIndex(r => r.id === run.id); if (i >= 0) s.runs[i] = run; else s.runs.push(run);
    }); }
    catch (error) { this.active = null; throw error; }
    this.changed();
    this.fatalError = null;
    this.execution = this.execute(run).catch(error => { this.fatalError = sanitizeSensitiveText(error instanceof Error ? error.message : "Archivio locale non raggiungibile"); }).finally(() => { this.active = null; this.changed(); });
    return run.id;
  }
  pause() { if (this.active) this.active.pause = true; this.changed(); }
  async waitForIdle() { await this.execution; }
  private async updateRun(id: string, patch: Partial<Run>) { await this.store.change(s => { const run = s.runs.find(r => r.id === id); if (!run) throw new Error("Operazione non trovata"); Object.assign(run, patch); }); this.changed(); }
  private async execute(run: Run) {
    try {
      this.provider.beginOperation?.(run.operation);
      const street = this.store.read().streets.find(s => s.id === run.streetId)!;
      if (run.operation === "scan") {
        const complete = await this.provider.scan(street, run.id, run.checkpoint, async source => {
          const key = unitKey(source);
          await this.store.change(state => {
            const currentRun = state.runs.find(r => r.id === run.id)!;
            const unit = state.units[key] ??= { key, streetIds: [], observations: [], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null };
            if (!unit.streetIds.includes(street.id)) unit.streetIds.push(street.id);
            // A replay is harmless; a repaired SISTER row retains both readings.
            if (!unit.observations.some(o => o.runId === run.id && observationData(o.source) === observationData(source))) {
              unit.observations.push({ at: now(), runId: run.id, streetId: street.id, source, origin: this.origin === "simulation" ? "simulation" : "sister" });
              unit.sourceVersionId = source.sourcePropertyId; unit.assessment = null;
            }
            if (!currentRun.itemKeys.includes(key)) currentRun.itemKeys.push(key);
            currentRun.handled = currentRun.itemKeys.length;
          }); this.changed();
        }, async checkpoint => this.updateRun(run.id, { checkpoint }), this.isPaused, run.settings!.filters);
        await this.updateRun(run.id, { state: complete ? "completed" : "paused", endedAt: complete ? now() : null, error: complete ? null : "Acquisizione parziale: i dati letti restano conservati. Riprendi o verifica le anomalie." });
      } else {
        for (let index = run.handled; index < run.itemKeys.length; index++) {
          if (this.isPaused()) { await this.updateRun(run.id, { state: "paused" }); return; }
          const key = run.itemKeys[index]!;
          const unit = this.store.read().units[key]!; const source = run.applySources?.[key] ?? effectiveSource(unit);
          if (run.operation === "compare") {
            let assessment;
            try { const result = await this.provider.candidates(street, source); assessment = assess(source, result.rows, result.complete); }
            catch (error) { assessment = { ...assess(source, [], false), reason: sanitizeSensitiveText(error instanceof Error ? error.message : "Ricerca non riuscita") }; }
            await this.store.change(s => { s.units[key]!.assessment = assessment; });
          } else {
            // A plan is a preview, not permission to trust an old CRM read.
            const fresh = await this.provider.candidates(street, source);
            const assessment = assess(source, fresh.rows, fresh.complete);
            if (run.settings!.importPolicy === "existing_only" && assessment.kind === "create") throw new Error("Scheda esistente non trovata nella nuova lettura: nessuna creazione autorizzata da questa run");
            if (!this.provider.canWrite(key, source)) throw new Error("Scrittura non autorizzata per questo immobile");
            if (!["create", "update"].includes(assessment.kind)) {
              await this.store.change(s => { s.units[key]!.assessment = assessment; });
              await this.updateRun(run.id, { state: "paused", error: "La corrispondenza è cambiata: verifica il piano prima di riprendere." }); return;
            }
            const plan = buildPlan(source);
            const narrowed = fresh.rows.filter(c => c.id === assessment.candidateId);
            const prior = this.store.read().checkpoints[source.sourcePropertyId];
            this.provider.authorizeWrite(source, prior?.propertyResolution?.kind === "create" && !prior.crmPropertyId ? "create" : assessment.kind as "create" | "update");
            const requireExisting = run.settings!.importPolicy === "existing_only" || (prior?.propertyResolution?.kind === "create" ? false : assessment.kind === "update");
            const engine = new ImportV2Engine(await this.provider.port(), new TerritoryImportStore(this.store, street.id), { isInterruptionRequested: this.isPaused, requireExistingProperty: requireExisting, includeCoOwners: run.settings!.includeCoOwners, propertyCandidates: async () => narrowed });
            const outcome = await engine.run(plan.source);
            await this.store.change(s => {
              const u = s.units[key]!;
              u.assessment = { ...assessment, kind: outcome.state === "completed" ? "synced" : "review", reason: outcome.failure?.message ?? "Indirizzo, catasto e intestatari riletti e verificati.", candidateId: outcome.crmPropertyId };
              if (outcome.state === "completed") {
                u.crmId = outcome.crmPropertyId; u.importedAt = now();
                if (outcome.crmPropertyId) (s.runs.find(r => r.id === run.id)!.imports ??= {})[key] = { at: u.importedAt, crmId: outcome.crmPropertyId };
              }
            });
            if (outcome.state !== "completed") { await this.updateRun(run.id, { state: "paused", error: outcome.failure?.message ?? "Import da verificare" }); return; }
          }
          await this.updateRun(run.id, { handled: index + 1 });
        }
        await this.updateRun(run.id, { state: "completed", endedAt: now() });
      }
      await this.store.change(s => { s.events.push({ id: randomUUID(), streetId: street.id, at: now(), text: `${({ scan: "Acquisizione", compare: "Confronto", apply: "Applicazione" })[run.operation]} ${s.runs.find(r => r.id === run.id)?.state === "completed" ? "conclusa" : "conservata per la ripresa"}` }); });
    } catch (error) {
      await this.updateRun(run.id, { state: "paused", error: sanitizeSensitiveText(error instanceof Error ? error.message : "Operazione interrotta") });
    } finally { this.provider.endOperation?.(); }
  }
}
