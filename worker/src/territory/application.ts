import { compareSourceProperties, unitPosition } from "./unit-order.js";
import { randomUUID } from "node:crypto";
import { ImportV2Engine } from "../import-v2/engine.js";
import { failureFromError } from "../import-v2/errors.js";
import { buildPlan, canonicalTaxCode } from "../import-v2/identity.js";
import { sanitizeSensitiveText } from "../logger.js";
import { TerritoryImportStore } from "./import-store.js";
import { assess } from "./reconcile.js";
import { effectiveSource, latest, streetSummary, unitKey, type Run, type SourceProperty, type Unit, type TerritoryState } from "./types.js";
import { TerritoryStore } from "./store.js";
import type { TerritoryProvider } from "./providers.js";
import { associateHistory, matchHistoricalStreet } from "./history.js";
import { applyNetworkBindings } from "./network.js";
import { relatedStreetIds, streetSummaries } from "./model.js";
import { importProgress } from "./progress.js";
import { runSettings, sourceForApply } from "./run-options.js";
import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import { appendUnitEvent, rememberAcquisition, unitMemory } from "./unit-memory.js";
import { queryCatalog, queryUnitKeys, unitQuerySchema } from "./query.js";
import { collectScanQuarantine, isQuarantined, canRetryQuarantinedUnit, quarantine, resolveUnitQuarantine, sourceProblem } from "./quarantine.js";
import { buildCadastralKey } from "../core/normalize.js";
import { queueStreet, queueLocked, settleQueueImport, pendingUnitImport } from "./import-queue.js";
import { sisterStreetSettingsSchema } from "./sister-street-settings.js";

const now = () => new Date().toISOString();
const publicRun = ({ applySources: sources, checkpoint: _checkpoint, ...run }: Run) => ({ ...run,
  ...(run.skipped ? { skipped: Object.fromEntries(Object.entries(run.skipped).map(([key, issue]) => [key, { ...issue, address: issue.address ?? sources?.[key]?.fullAddress }])) } : {}) });
const observationData = (source: SourceProperty) => JSON.stringify({ ...source, sourcePropertyId: undefined, jobId: undefined, owners: source.owners.map(({ sourcePersonId: _id, ...owner }) => owner) });
export class TerritoryApplication {
  private active: { runId: string; pause: boolean; currentKey?: string; stage?: import("../import-v2/model.js").ImportV2Stage; attempt?: number } | null = null;
  private execution: Promise<void> | null = null;
  private fatalError: string | null = null;
  private presentationRevision = 0;
  private mapCache: { key: string; snapshot: ReturnType<TerritoryApplication["buildSnapshot"]> } | null = null;
  constructor(readonly store: TerritoryStore, private readonly provider: TerritoryProvider, private readonly changed: () => void = () => {}, private readonly recoveryDelayMs = 5000) {}
  get origin() { return this.provider.origin; }
  get hasActiveRun() { return this.active !== null; }
  refreshAuthorization() { this.presentationRevision++; this.changed(); }
  importQueue() {
    const state = this.store.read();
    const entries = Object.values(state.importQueue ?? {}).map(entry => {
      const unit = state.units[entry.key], locked = queueLocked(state, entry.key);
      let recovery = null, recoveryProblem: string | null = null;
      try { recovery = pendingUnitImport(state, entry.key); } catch (error) { recoveryProblem = (error as Error).message; }
      const source = recovery?.source ?? (unit && effectiveSource(unit));
      const problem = recoveryProblem ?? (!unit || !source ? "Immobile non più disponibile" : recovery && recovery.origin !== this.origin ? "Piano di un altro profilo: nessuna scrittura" : !recovery && isQuarantined(state, unit) && !canRetryQuarantinedUnit(state, unit) ? "In quarantena: correggi i dati prima di importare" : sourceProblem(source) ? "Dati da completare: " + sourceProblem(source) : !this.provider.canWrite(unit.key, source) ? "Dati o autorizzazioni da completare" : !queueStreet(state, unit, recovery?.streetId ?? entry.streetId) ? "Associazione alla via da completare" : null);
      return { ...entry, retry: !recovery && Boolean(unit && canRetryQuarantinedUnit(state, unit)), unit: unit ? this.presentUnit(unit, state) : null, locked, problem, recovery: recovery ? { stage: recovery.checkpoint.stage, settings: recovery.settings, address: recovery.source.fullAddress, activityEnabled: recovery.source.activity.enabled } : null, editLocked: locked || Boolean(recovery) || Boolean(recoveryProblem) };
    }).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    return { revision: this.store.revision, entries, readyKeys: entries.filter(e => !e.problem && !e.locked).map(e => e.key), runs: state.runs.filter(r => r.operation === "apply" && (r.queueEntryIds || ["paused", "failed"].includes(r.state)) && r.origin === this.origin).slice(-30).map(publicRun) };
  }
  async enqueue(keys: string[], preferredStreet?: string) {
    if (!keys.length || keys.length > 10000) throw new Error("Seleziona gli immobili da aggiungere alla coda");
    const count = await this.store.change(state => {
      let count = 0;
      for (const key of new Set(keys)) {
        const unit = state.units[key];
        let recovery;
        try { recovery = pendingUnitImport(state, key); } catch { /* The queue exposes an orphaned plan as blocked, without writing. */ }
        if (!unit || (isQuarantined(state, unit) && !recovery && !canRetryQuarantinedUnit(state, unit)) || (latest(unit).origin === "simulation") !== (this.origin === "simulation")) throw new Error("La selezione contiene immobili non disponibili: aggiorna la scheda");
        const street = queueStreet(state, unit, recovery?.streetId ?? preferredStreet);
        if (!street) throw new Error("Associa l'immobile a una via identificata prima di aggiungerlo alla coda");
        if (state.importQueue?.[key]) continue;
        const entry = { id: randomUUID(), key, streetId: street.id, addedAt: now() };
        (state.importQueue ??= {})[key] = entry;
        appendUnitEvent(unit, [entry.id, "queued"], { kind: "queued", at: entry.addedAt, runId: "manual", origin: this.origin, message: "Aggiunto alla coda di import" }); count++;
      }
      return count;
    }); this.changed(); return count;
  }
  async dequeue(keys: string[]) {
    await this.store.change(state => {
      for (const key of keys) {
        if (queueLocked(state, key)) throw new Error("Attendi la fine del lavoro in corso prima di rimuovere questo immobile");
        const entry = state.importQueue?.[key], unit = state.units[key];
        if (!entry) continue;
        if (unit) appendUnitEvent(unit, [entry.id, "removed"], { kind: "queue_removed", at: now(), runId: "manual", origin: this.origin, message: "Rimosso dalla coda; dati e storico conservati" });
        delete state.importQueue![key];
      }
    }); this.changed();
  }
  async clearQueue(expectedRevision: number) {
    if (this.active) throw new Error("Attendi la fine del lavoro in corso prima di svuotare la coda");
    const count = await this.store.change(state => {
      if (this.store.revision !== expectedRevision) throw new Error("La coda è cambiata: aggiornala e conferma di nuovo");
      if (this.active || state.runs.some(r => r.state === "running")) throw new Error("Attendi la fine del lavoro in corso prima di svuotare la coda");
      const entries = Object.values(state.importQueue ?? {}), at = now();
      for (const entry of entries) {
        const unit = state.units[entry.key];
        if (unit) appendUnitEvent(unit, [entry.id, "removed"], { kind: "queue_removed", at, runId: "manual", origin: this.origin, message: "Coda svuotata; dati e storico conservati" });
      }
      state.importQueue = {};
      return entries.length;
    }); this.changed(); return count;
  }
  async startQueue(keys: string[], settings?: unknown, resumeId?: string) {
    const state = this.store.read();
    if (resumeId) throw new Error("Questo lavoro è terminato: scegli dalla coda gli immobili da lavorare");
    if (!keys.length || keys.some(key => !state.importQueue?.[key] || !state.units[key])) throw new Error("La selezione non corrisponde più alla coda: aggiornala");
    const ready = new Set(this.importQueue().readyKeys);
    if (keys.some(key => !ready.has(key))) throw new Error("Dati o piani da completare prima di importare dalla coda");
    const routes = keys.map(key => queueStreet(state, state.units[key]!, pendingUnitImport(state, key)?.streetId ?? state.importQueue![key]!.streetId));
    if (routes.some(s => !s)) throw new Error("Completa le associazioni alle vie prima di importare");
    const scope = [...new Set(routes.map(s => s!.id))];
    return this.start(scope[0]!, "apply", keys, undefined, settings, { scope, query: unitQuerySchema.parse({}), routes: Object.fromEntries(keys.map((key, i) => [key, routes[i]!.id])), queueEntryIds: Object.fromEntries(keys.map(key => [key, state.importQueue![key]!.id])) });
  }
  quarantineList() { const state = this.store.read(); return Object.values(state.quarantine ?? {}).filter(q => !q.resolvedAt).map(q => ({ ...q, editableSource: q.unitKey && state.units[q.unitKey] ? effectiveSource(state.units[q.unitKey]!) : q.source, unitNote: q.unitKey ? state.units[q.unitKey]?.note ?? "" : "" })); }
  historyReview() { return this.store.read().history?.flatMap(job => job.issues.map(issue => ({ jobId: job.id, propertyId: issue.propertyId, address: issue.address, reason: issue.reason, canAssociate: Boolean(issue.source), cadastral: issue.source?.cadastral ?? null }))) ?? []; }
  async associate(propertyId: string, streetId: string) { if (this.active) throw new Error("Metti in pausa prima di associare lo storico"); await associateHistory(this.store, propertyId, streetId); this.changed(); }
  isPaused = () => Boolean(this.active?.pause);
  snapshot() {
    const key = `${this.store.revision}:${this.presentationRevision}:${Math.floor(Date.now() / 60000)}:${this.active?.runId ?? ""}:${this.active?.currentKey ?? ""}:${this.fatalError ?? ""}`;
    if (this.mapCache?.key !== key) this.mapCache = { key, snapshot: this.buildSnapshot() };
    const snapshot = structuredClone(this.mapCache.snapshot);
    if (snapshot.currentItem && this.active) { snapshot.currentItem.stage = this.active.stage ?? "queued"; snapshot.currentItem.attempt = this.active.attempt ?? 1; }
    return snapshot;
  }
  private buildSnapshot() {
    const state = this.store.read();
    const activeRun = this.active ? state.runs.find(r => r.id === this.active!.runId) : undefined;
    const currentKey = this.active?.currentKey;
    const currentSource = currentKey ? activeRun?.applySources?.[currentKey] : undefined;
    const observations = currentKey ? state.units[currentKey]?.observations ?? [] : [];
    const matching = observations.filter(o => o.source.jobId === currentSource?.jobId);
    const acquiredAt = observations.find(o => o.source.sourcePropertyId === currentSource?.sourcePropertyId)?.at ?? (matching.length === 1 ? matching[0]!.at : null);
    const currentItem = currentKey && currentSource ? { key: currentKey, source: currentSource, position: unitPosition(currentSource), note: state.units[currentKey]?.note ?? "", acquiredAt, crmId: state.checkpoints[currentSource.sourcePropertyId]?.crmPropertyId ?? null, stage: this.active?.stage ?? "queued", attempt: this.active?.attempt ?? 1 } : null;
    return { currentItem, revision: this.store.revision, presentationRevision: this.presentationRevision, minute: Math.floor(Date.now() / 60000), queueCount: Object.keys(state.importQueue ?? {}).length, queueKeys: Object.keys(state.importQueue ?? {}), quarantineCount: Object.values(state.quarantine ?? {}).filter(q => !q.resolvedAt).length, origin: this.provider.origin, error: this.fatalError, historyIssues: state.history?.reduce((n, job) => n + job.issues.length, 0) ?? 0, network: { official: state.streets.filter(s => s.catalogKind !== "network").length, paths: state.streets.filter(s => s.catalogKind === "network").length, linked: Object.keys(state.networkBindings ?? {}).length }, streets: streetSummaries(state), activeRun: activeRun ? publicRun(activeRun) : null };
  }
  detail(streetId: string) {
    const state = this.store.read(); const requested = state.streets.find(s => s.id === streetId);
    const street = requested?.linkedOfficialId ? state.streets.find(s => s.id === requested.linkedOfficialId) : requested;
    if (!street) throw new Error("Via non trovata");
    streetId = street.id;
    const ids = relatedStreetIds(state, streetId);
    const summary = streetSummary(state, street);
    return { quarantine: Object.values(state.quarantine ?? {}).filter(q => !q.resolvedAt && ids.includes(q.streetId)).map(q => ({ ...q, editableSource: q.unitKey && state.units[q.unitKey] ? effectiveSource(state.units[q.unitKey]!) : q.source, unitNote: q.unitKey ? state.units[q.unitKey]?.note ?? "" : "" })), street: summary, history: state.history?.filter(h => h.streetIds.some(id => ids.includes(id))) ?? [], memory: { ...(state.memories[streetId] ?? { note: "" }), attention: summary.attention }, linkedNotes: ids.filter(id => id !== streetId && state.memories[id]?.note).map(id => ({ streetId: id, ...state.memories[id]! })), units: Object.values(state.units).filter(u => u.streetIds.some(id => ids.includes(id)) && !isQuarantined(state, u)).map(u => this.presentUnit(u, state)).sort((a, b) => compareSourceProperties(a.source, b.source)), runs: state.runs.filter(r => ids.includes(r.streetId) || r.selectionScope?.some(id => ids.includes(id))).map(publicRun), events: state.events.filter(e => ids.includes(e.streetId)).slice(-100) };
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
      const search = state.memories[networkId]?.sisterSearch;
      const officialSearch = state.memories[officialId]?.sisterSearch;
      if (search && (search.searchText || search.resultName) && !officialSearch?.searchText && !officialSearch?.resultName) {
        state.memories[officialId] = { ...(state.memories[officialId] ?? { note: "", attention: false }), sisterSearch: structuredClone(search), updatedAt: at };
      }
      applyNetworkBindings(state);
      state.events.push({ id: randomUUID(), streetId: officialId, at, text: `Tracciato della rete propria associato manualmente: ${network.name}` });
    });
    this.changed();
  }
  async configureSisterStreet(streetId: string, value: unknown) {
    if (this.active) throw new Error("Attendi la fine del lavoro prima di modificare la ricerca SISTER");
    const settings = sisterStreetSettingsSchema.parse(value);
    await this.store.change(state => {
      const street = state.streets.find(s => s.id === streetId);
      if (!street || street.linkedOfficialId) throw new Error("Apri la scheda della via associata per modificare la ricerca SISTER");
      state.memories[streetId] = { ...(state.memories[streetId] ?? { note: "", attention: false }), sisterSearch: settings, updatedAt: now() };
      state.events.push({ id: randomUUID(), streetId, at: now(), text: "Ricerca e voce SISTER della via aggiornate manualmente" });
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
      if (queueLocked(state, key)) throw new Error("Attendi la fine del lavoro in corso prima di modificare questo immobile");
      if (pendingUnitImport(state, key)) throw new Error("Una scrittura di questo immobile è da verificare: il piano originale sarà recuperato al prossimo avvio dalla coda");
      unit.corrections = { ...unit.corrections, ...correction }; unit.note = note; unit.sourceVersionId = randomUUID(); unit.assessment = null;
      resolveUnitQuarantine(state, unit, now());
      appendUnitEvent(unit, ["corrected", unit.sourceVersionId], { kind: "corrected", at: now(), runId: "manual", origin: latest(unit).origin === "simulation" ? "simulation" : "live", source: effectiveSource(unit), note, message: "Correzione manuale conservata; serve un nuovo confronto" });
      for (const streetId of unit.streetIds) state.events.push({ id: randomUUID(), streetId, at: now(), text: "Correzione manuale conservata; serve un nuovo confronto", unitKey: key });
    });
    this.changed();
  }
  async start(streetId: string, operation: Run["operation"], selected: string[] = [], resumeId?: string, settings?: unknown, batch?: { scope: string[]; routes: Record<string, string>; query: import("./query.js").UnitQuery; queueEntryIds?: Record<string, string> }): Promise<string> {
    if (this.active) throw new Error("Una via è già in lavorazione. Mettila in pausa prima di avviarne un'altra.");
    if (operation === "apply" && resumeId) throw new Error("Questo lavoro è terminato: scegli dalla coda gli immobili da lavorare");
    const state = this.store.read(); const street = state.streets.find(s => s.id === streetId);
    if (!street) throw new Error("Via non trovata");
    if (street.linkedOfficialId) return this.start(street.linkedOfficialId, operation, selected, resumeId, settings);
    if (operation === "scan" && street.needsReview) throw new Error("Associa il tratto senza nome a una via ufficiale prima di acquisire");
    const ids = relatedStreetIds(state, streetId);
    const scope = batch?.scope ?? (resumeId ? state.runs.find(r => r.id === resumeId)?.selectionScope : undefined);
    if (scope) for (const id of scope) for (const related of relatedStreetIds(state, id)) if (!ids.includes(related)) ids.push(related);
    const unitKeys = Object.values(state.units).filter(u => u.streetIds.some(id => ids.includes(id))).map(u => u.key);
    if (selected.some(key => !unitKeys.includes(key))) throw new Error("La selezione contiene immobili di un'altra via");
    if (new Set(selected).size !== selected.length) throw new Error("Seleziona ogni immobile una sola volta");
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
      if (batch) { run.selectionScope = batch.scope; run.unitStreetIds = batch.routes; run.query = batch.query; run.queueEntryIds = batch.queueEntryIds; }
    }
    if (operation !== "scan") {
      for (const key of run.itemKeys) {
        const unit = state.units[key]!;
        if ((latest(unit).origin === "simulation") !== (this.origin === "simulation")) throw new Error("Dati simulati e acquisizioni reali usano archivi distinti");
        const recovery = operation === "apply" ? pendingUnitImport(state, key) : null;
        if (recovery && recovery.origin !== this.origin) throw new Error("Piano di un altro profilo: nessuna scrittura");
        if (operation === "apply" && (recovery?.settings ?? run.settings!).importPolicy === "existing_only" && unit.assessment?.kind === "create") throw new Error("Solo schede esistenti: deseleziona gli immobili da creare");
        if (operation === "apply" && (!this.provider.canWrite(key, recovery?.source ?? effectiveSource(unit)) || (!recovery && isQuarantined(state, unit) && !canRetryQuarantinedUnit(state, unit)))) throw new Error("Un immobile selezionato è in quarantena o non è autorizzato alle scritture");
      }
    }
    this.active = { runId: run.id, pause: false };
    try { await this.store.change(s => {
      let directContactOrdinal = 0;
      if (operation === "apply" && !resumeId) for (const [index, key] of run.itemKeys.entries()) {
        if (run.queueEntryIds && s.importQueue?.[key]?.id !== run.queueEntryIds[key]) throw new Error("La coda è cambiata: scegli di nuovo gli immobili da lavorare");
        const unit = s.units[key]!;
        const recovery = pendingUnitImport(s, key);
        if (recovery) {
          if (recovery.source.activity.enabled && recovery.source.activity.contactMode === "Contatto diretto") directContactOrdinal++;
          (run.applySources ??= {})[key] = recovery.source;
          (run.unitSettings ??= {})[key] = recovery.settings;
          (run.unitStreetIds ??= {})[key] = recovery.streetId;
          continue;
        }
        if (s.checkpoints[effectiveSource(unit).sourcePropertyId]?.stage === "completed") unit.sourceVersionId = randomUUID();
        const observation = latest(unit);
        (run.applySources ??= {})[key] = sourceForApply(effectiveSource(unit), run.settings!, observation.activityEligible ?? !observation.historyPropertyId, run.settings!.activityMode === "killer" ? index + 1 : directContactOrdinal + 1);
        const planned = run.applySources![key]!;
        if (planned.activity.enabled && planned.activity.contactMode === "Contatto diretto") directContactOrdinal++;
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
  unitDetail(key: string) { const state = this.store.read(), unit = state.units[key]; if (!unit) throw new Error("Immobile non trovato"); return this.presentUnit(unit, state); }
  private presentUnit(unit: Unit, state: TerritoryState) {
    const source = effectiveSource(unit);
    let writePending = false, writeIssue: string | null = null;
    try { writePending = Boolean(pendingUnitImport(state, unit.key)); }
    catch (error) { writePending = true; writeIssue = (error as Error).message; }
    return { ...unit, cloud: { property: state.cloudMemory?.properties[unit.key] ?? null, people: source.owners.map(o => ({ taxCode: o.taxCode, fullName: o.fullName, evidence: state.cloudMemory?.people[canonicalTaxCode(o.taxCode)] ?? null })) }, source, position: unitPosition(source), origin: latest(unit).origin, canWrite: this.provider.canWrite(unit.key, source), memory: unitMemory(unit), writePending, writeIssue };
  }
  queryCatalog() { return queryCatalog(this.store.read()); }
  query(input: unknown, limit = 100) { const state = this.store.read(), query = unitQuerySchema.parse(input), keys = queryUnitKeys(state, query); return { query, keys, queueKeys: keys.filter(key => queueStreet(state, state.units[key]!)), total: keys.length, readyKeys: keys.filter(key => { const u = state.units[key]!; return this.provider.canWrite(key, effectiveSource(u)) && !isQuarantined(state, u); }), createKeys: keys.filter(key => state.units[key]!.assessment?.kind === "create"), units: keys.slice(0, limit).map(key => this.presentUnit(state.units[key]!, state)), runs: state.runs.filter(r => r.query).slice(-20).map(publicRun) }; }
  async saveZone(name: string, streetIds: string[], id: string = randomUUID()) {
    if (this.active) throw new Error("Attendi la fine dell'operazione prima di modificare le zone");
    await this.store.change(state => { const canonical = [...new Set(streetIds.map(id => state.streets.find(s => s.id === id)?.linkedOfficialId ?? id))]; if (!canonical.length || canonical.some(id => !state.streets.some(s => s.id === id && !s.needsReview))) throw new Error("Scegli almeno una via identificata"); (state.zones ??= {})[id] = { id, name, streetIds: canonical, updatedAt: now() }; }); this.changed(); return id;
  }
  async saveQuery(name: string, input: unknown, id: string = randomUUID()) {
    if (this.active) throw new Error("Attendi la fine dell'operazione prima di salvare la query");
    const query = unitQuerySchema.parse(input); queryUnitKeys(this.store.read(), query);
    await this.store.change(state => { (state.savedQueries ??= {})[id] = { id, name, query, updatedAt: now() }; }); this.changed(); return id;
  }
  async startQuery(input: unknown, operation: "compare" | "apply", keys: string[], settings?: unknown) {
    const state = this.store.read(), query = unitQuerySchema.parse(input), allowed = new Set(queryUnitKeys(state, query));
    if (!keys.length || keys.some(key => !allowed.has(key))) throw new Error("La selezione non corrisponde più alla query: aggiorna i risultati");
    const routes = keys.map(key => {
      const unit = state.units[key]!, latestStreet = [...unit.observations].reverse().find(o => o.streetId)?.streetId;
      const canonical = (id: string) => state.streets.find(s => s.id === (state.streets.find(s => s.id === id)?.linkedOfficialId ?? id) && !s.needsReview);
      if (latestStreet && unit.streetIds.includes(latestStreet)) return canonical(latestStreet);
      const matches = [...new Map(unit.streetIds.map(canonical).filter(s => s).map(s => [s!.id, s!])).values()];
      return matches.length === 1 ? matches[0] : undefined;
    });
    if (routes.some(s => !s)) throw new Error("Associa alla via gli immobili senza posizione prima di avviare il confronto");
    const scope = [...new Set(routes.map(s => s!.linkedOfficialId ?? s!.id))];
    return this.start(scope[0]!, operation, keys, undefined, settings, { scope, query, routes: Object.fromEntries(keys.map((key, i) => [key, routes[i]!.id])) });
  }
  private async updateRun(id: string, patch: Partial<Run>) { await this.store.change(s => { this.provider.rememberCloud?.(s); const run = s.runs.find(r => r.id === id); if (!run) throw new Error("Operazione non trovata"); Object.assign(run, patch); }); this.changed(); }
  private async waitForRecovery(run: Run, reason: string) {
    if (/Chrome|connectOverCDP|ECONNREFUSED/i.test(reason)) reason = "Chrome di lavoro non disponibile. Aprilo e verifica l'accesso a Tecnocloud.";
    await this.updateRun(run.id, { waiting: sanitizeSensitiveText(reason), error: null });
    await this.provider.resetConnection?.();
    const until = Date.now() + this.recoveryDelayMs;
    while (!this.isPaused() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(250, until - Date.now())));
  }
  private async deferUnit(run: Run, key: string, index: number, source: SourceProperty, reason: string) {
    reason = sanitizeSensitiveText(reason);
    await this.store.change(state => {
      this.provider.rememberCloud?.(state);
      const unit = state.units[key]!, current = state.runs.find(r => r.id === run.id)!;
      const checkpoint = state.checkpoints[source.sourcePropertyId], at = now();
      quarantine(state, { origin: "apply", runId: run.id, streetId: run.unitStreetIds?.[key] ?? run.streetId, at, unitKey: key, source, checkpoint: checkpoint ? structuredClone(checkpoint) : undefined, address: source.fullAddress, cadastral: source.cadastral, reason });
      // After any possible write the checkpoint stays active, with its original plan.
      if (checkpoint && ["queued", "planned"].includes(checkpoint.stage) && !checkpoint.crmPropertyId && !checkpoint.syncedPeople.length) delete state.checkpoints[source.sourcePropertyId];
      appendUnitEvent(unit, [run.id, key, "quarantined"], { kind: "import_quarantined", at, runId: run.id, origin: run.origin, message: reason });
      (current.skipped ??= {})[key] = { at, reason, address: source.fullAddress }; current.handled = index + 1; current.waiting = null;
    }); this.changed();
  }
  private async execute(run: Run) {
    let currentKey: string | null = null;
    try {
      this.provider.beginOperation?.(run.operation);
      const street = this.store.read().streets.find(s => s.id === run.streetId)!;
      if (run.operation === "scan") {
        const complete = await this.provider.scan(street, run.id, run.checkpoint, async (source, context) => {
          let key: string | undefined;
          try { key = unitKey(source); } catch { /* The source itself remains in quarantine. */ }
          const problem = sourceProblem(source);
          await this.store.change(state => {
            const currentRun = state.runs.find(r => r.id === run.id)!;
            const matches = context?.portfolio ? matchHistoricalStreet(source, state.streets, undefined, state.memories) : [street];
            const destination = matches.length === 1 ? matches[0] : undefined;
            if (problem || !key) quarantine(state, { streetId: destination?.id ?? street.id, runId: run.id, at: now(), origin: "scan", reason: problem ?? "Identità catastale incompleta", address: source.fullAddress, cadastral: source.cadastral, source: structuredClone(source), unitKey: key, recordKey: buildCadastralKey({ municipality: source.municipality, ...source.cadastral }) });
            if (!key) return;
            const unit = state.units[key] ??= { key, streetIds: [], observations: [], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null };
            if (destination && !unit.streetIds.includes(destination.id)) unit.streetIds.push(destination.id);
            // A replay is harmless; a repaired SISTER row retains both readings.
            const sameReading = unit.observations.find(o => o.runId === run.id && observationData(o.source) === observationData(source));
            if (sameReading && context?.portfoliosExpanded) sameReading.portfoliosExpanded = true;
            if (!context?.reused && !sameReading) {
              // A fully read portfolio has the same evidence as a street row.
              // Activities still require an explicit choice when starting the queue.
              unit.observations.push({ at: now(), runId: run.id, streetId: destination?.id, source, ownersComplete: context?.ownersComplete, portfoliosExpanded: context?.portfoliosExpanded, portfolio: context?.portfolio, activityEligible: context?.ownersComplete ?? !context?.portfolio, origin: this.origin === "simulation" ? "simulation" : "sister" });
              rememberAcquisition(unit, unit.observations.at(-1)!);
              unit.sourceVersionId = source.sourcePropertyId; unit.assessment = null;
            }
            if (!currentRun.itemKeys.includes(key)) currentRun.itemKeys.push(key);
            if (context?.reused && !currentRun.reusedKeys?.includes(key)) (currentRun.reusedKeys ??= []).push(key);
            if (context?.portfolio && !currentRun.portfolioKeys?.includes(key)) (currentRun.portfolioKeys ??= []).push(key);
            currentRun.handled = currentRun.itemKeys.length;
            if (!problem) resolveUnitQuarantine(state, unit, now());
          }); this.changed();
        }, async checkpoint => this.updateRun(run.id, { checkpoint }), this.isPaused, run.settings!.filters, run.settings);
        await this.store.change(state => collectScanQuarantine(state, state.runs.find(r => r.id === run.id)!));
        await this.updateRun(run.id, { state: complete ? "completed" : "paused", endedAt: complete ? now() : null, error: complete ? null : "Lettura SISTER interrotta: riprendi dal punto conservato. Le anomalie dei singoli immobili restano in quarantena." });
      } else {
        for (let index = run.handled; index < run.itemKeys.length; index++) {
          if (this.isPaused()) { await this.updateRun(run.id, { state: run.operation === "apply" ? "stopped" : "paused", waiting: null, endedAt: run.operation === "apply" ? now() : null }); return; }
          const key = run.itemKeys[index]!;
          if (run.operation === "apply" && this.store.read().runs.find(r => r.id === run.id)?.imports?.[key]?.crmId) {
            await this.store.change(s => settleQueueImport(s, s.runs.find(r => r.id === run.id)!, key));
            await this.updateRun(run.id, { handled: index + 1 }); continue;
          }
          currentKey = key;
          if (this.active) { this.active.currentKey = key; this.active.stage = "queued"; this.active.attempt = 1; this.changed(); }
          const state = this.store.read(), unit = state.units[key]!; const source = run.applySources?.[key] ?? effectiveSource(unit);
          const settings = run.unitSettings?.[key] ?? run.settings!;
          const street = run.unitStreetIds?.[key] ? state.streets.find(s => s.id === run.unitStreetIds![key]) : run.selectionScope ? state.streets.find(s => unit.streetIds.some(id => id === s.id || state.networkBindings?.[id]?.officialId === s.id) && run.selectionScope!.includes(s.id))! : state.streets.find(s => s.id === run.streetId)!;
          try {
            if (!street) throw new Error("Via non disponibile per questo immobile: nessuna scrittura");
            if (run.operation === "compare") {
              let assessment;
              try { const result = await this.provider.candidates(street, source); assessment = assess(source, result.rows, result.complete); }
              catch (error) { assessment = { ...assess(source, [], false), reason: sanitizeSensitiveText(error instanceof Error ? error.message : "Ricerca non riuscita") }; }
              await this.store.change(s => { this.provider.rememberCloud?.(s); const u = s.units[key]!; u.assessment = assessment; appendUnitEvent(u, [run.id, key, "compared"], { kind: "compared", at: assessment.checkedAt, runId: run.id, origin: run.origin, sourceId: source.sourcePropertyId, assessment, message: assessment.reason }); });
            } else {
              // A plan is a preview, not permission to trust an old CRM read.
              let fresh;
              for (let attempt = 0; ; attempt++) {
                try { fresh = await this.provider.candidates(street, source); break; }
                catch (error) {
                  const failure = failureFromError(error, "planned");
                  if (failure.global || !failure.retryable || attempt >= 1 || this.isPaused()) throw error;
                  await (await this.provider.port()).recover("planned", error);
                }
              }
              if (this.store.read().runs.find(r => r.id === run.id)?.waiting) await this.updateRun(run.id, { waiting: null });
              const assessment = assess(source, fresh.rows, fresh.complete);
              if (assessment.kind === "unknown") {
                await this.store.change(s => { s.units[key]!.assessment = assessment; });
                throw new Error(assessment.reason);
              }
              if (!this.provider.canWrite(key, source)) throw new Error("Scrittura non autorizzata per questo immobile");
              if (assessment.kind === "review" || (settings.importPolicy === "existing_only" && assessment.kind === "create")) {
                const checkpoint = this.store.read().checkpoints[source.sourcePropertyId];
                if (checkpoint && checkpoint.stage !== "completed") {
                  await this.store.change(s => { s.units[key]!.assessment = assessment; });
                  throw new Error("Corrispondenza cambiata per una scrittura da verificare: piano conservato, nessuna scrittura ripetuta.");
                }
                await this.store.change(s => { s.units[key]!.assessment = assessment; });
                await this.deferUnit(run, key, index, source, assessment.kind === "review" ? assessment.reason : "Solo schede esistenti: nessuna creazione autorizzata"); continue;
              }
              const plan = buildPlan(source);
              const narrowed = fresh.rows.filter(c => c.id === assessment.candidateId);
              const prior = this.store.read().checkpoints[source.sourcePropertyId];
              this.provider.authorizeWrite(source, prior?.propertyResolution?.kind === "create" && !prior.crmPropertyId ? "create" : assessment.kind as "create" | "update");
              const requireExisting = settings.importPolicy === "existing_only" || (prior?.propertyResolution?.kind === "create" ? false : assessment.kind === "update");
              const crm = await this.provider.port();
              const engine = new ImportV2Engine(crm, new TerritoryImportStore(this.store, street.id, run.id, state => {
                this.provider.rememberCloud?.(state);
                appendUnitEvent(state.units[key]!, [run.id, key, "fresh_comparison"], { kind: "compared", at: assessment.checkedAt, runId: run.id, origin: run.origin, assessment, message: assessment.reason });
              }), { isInterruptionRequested: this.isPaused, requireExistingProperty: requireExisting, includeCoOwners: settings.includeCoOwners, replaceUnlistedPrimary: settings.replaceUnlistedPrimary, preferRegistryDuplicates: true, propertyCandidates: async () => narrowed });
              const outcome = await engine.run(plan.source, (stage, retry) => {
                if (this.active && (this.active.stage !== stage || this.active.attempt !== retry.attempt)) {
                  this.active.stage = stage; this.active.attempt = retry.attempt; this.changed();
                }
              });
              await this.store.change(s => {
                const u = s.units[key]!;
                u.assessment = { ...assessment, kind: outcome.state === "completed" ? "synced" : "review", reason: outcome.failure?.message ?? "Indirizzo, catasto e intestatari riletti e verificati.", candidateId: outcome.crmPropertyId };
                if (outcome.state === "completed") {
                  u.crmId = outcome.crmPropertyId; u.importedAt = s.runs.find(r => r.id === run.id)?.imports?.[key]?.at ?? now();
                  if (outcome.crmPropertyId) (s.runs.find(r => r.id === run.id)!.imports ??= {})[key] = { at: u.importedAt, crmId: outcome.crmPropertyId };
                  resolveUnitQuarantine(s, u, now());
                  settleQueueImport(s, s.runs.find(r => r.id === run.id)!, key);
                  s.runs.find(r => r.id === run.id)!.handled = index + 1;
                }
              });
              if (outcome.state !== "completed") {
                if (this.isPaused() || outcome.failure?.kind === "operator_pause") {
                  await this.updateRun(run.id, { state: "stopped", waiting: null, endedAt: now(), error: "Lavoro interrotto dall'operatore; dati e checkpoint conservati." }); return;
                }
                if (outcome.failure?.global && (outcome.failure.kind === "global_session" || outcome.failure.kind === "cloud_unavailable" || outcome.failure.kind === "global_portal" && (outcome.failure.retryable || ["queued", "planned"].includes(outcome.stage)))) {
                  await this.waitForRecovery(run, outcome.failure.message); index--; continue;
                }
                if (outcome.failure?.global) await crm.recover(outcome.stage, outcome.failure).catch(() => undefined);
                await this.deferUnit(run, key, index, source, outcome.failure?.message ?? "Scrittura dell'immobile da verificare");
              }
            }
            if (run.operation === "apply") this.changed();
            else await this.updateRun(run.id, { handled: index + 1 });
          } catch (error) {
            if (run.operation !== "apply") throw error;
            if (this.isPaused()) { await this.updateRun(run.id, { state: "stopped", waiting: null, endedAt: now() }); return; }
            const failure = failureFromError(error, this.store.read().checkpoints[source.sourcePropertyId]?.stage ?? "queued");
            if (failure.kind === "operator_pause") { await this.updateRun(run.id, { state: "stopped", waiting: null, endedAt: now() }); return; }
            if (failure.global && ["global_session", "global_portal", "cloud_unavailable"].includes(failure.kind)) { await this.waitForRecovery(run, failure.message); index--; continue; }
            await this.deferUnit(run, key, index, source, failure.message);
          }
        }
        await this.updateRun(run.id, { state: "completed", waiting: null, error: null, endedAt: now() });
      }
      await this.store.change(s => { s.events.push({ id: randomUUID(), streetId: street.id, at: now(), text: `${({ scan: "Acquisizione", compare: "Confronto", apply: "Applicazione" })[run.operation]} ${s.runs.find(r => r.id === run.id)?.state === "completed" ? "conclusa" : "conservata per la ripresa"}` }); });
    } catch (error) {
      if (currentKey && run.operation === "apply") await this.store.change(state => { const unit = state.units[currentKey!]; if (unit) appendUnitEvent(unit, [run.id, currentKey, "operation_error", now()], { kind: "import_paused", at: now(), runId: run.id, origin: run.origin, message: sanitizeSensitiveText(error instanceof Error ? error.message : "Operazione interrotta") }); });
      await this.updateRun(run.id, { state: run.operation === "apply" ? "stopped" : "paused", waiting: null, endedAt: run.operation === "apply" ? now() : null, error: sanitizeSensitiveText(error instanceof Error ? error.message : "Operazione interrotta") });
    } finally { this.provider.endOperation?.(); }
  }
}
