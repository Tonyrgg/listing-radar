import { createHash } from "node:crypto";
import { sanitizeSensitiveText } from "../logger.js";
import { unitKey, type TerritoryState, type Unit, type UnitEvent } from "./model.js";
import type { SourceProperty, ImportV2Checkpoint } from "../import-v2/model.js";
import type { PropertyMemory } from "../import-v2/memory-store.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validAt = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? value : null;
export const legacyOperation = (jobId: string, propertyId: string) => `history:${jobId}:${propertyId}`;
export const unitOperation = (runId: string, key: string) => `v2:${runId}:${key}`;

/** Immutable, idempotent facts; replay does not inflate property statistics. */
export function appendUnitEvent(unit: Unit, identity: unknown, event: Omit<UnitEvent, "id" | "recordedAt"> & { recordedAt?: string }) {
  const id = digest(identity);
  if (unit.journal?.some(e => e.id === id)) return;
  (unit.journal ??= []).push(structuredClone({ ...event, id, recordedAt: event.recordedAt ?? new Date().toISOString(), at: validAt(event.at), message: sanitizeSensitiveText(event.message) }));
}
export function ensureMemoryUnit(state: TerritoryState, source: SourceProperty, at: string, runId: string): Unit {
  if (source.municipality.trim().toUpperCase() !== "BITONTO") throw new Error("Immobile fuori dal perimetro operativo");
  const key = unitKey(source);
  if (state.units[key]) return state.units[key]!;
  const unit = state.units[key] = { key, streetIds: [], observations: [{ at, runId, origin: "sister", source: structuredClone(source), historyPropertyId: source.sourcePropertyId }], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null } as Unit;
  rememberAcquisition(unit, unit.observations[0]!);
  return unit;
}
export function rememberCheckpoint(state: TerritoryState, memory: PropertyMemory, context?: { key: string; runId: string; streetId: string; origin: "simulation" | "live" }) {
  const { source, checkpoint, failure } = memory;
  const runId = context?.runId ?? `history:${source.jobId}`;
  const unit = context ? state.units[context.key]! : ensureMemoryUnit(state, source, validAt(memory.acquiredAt) ?? memory.at, runId);
  if (!unit || unit.key !== unitKey(source)) throw new Error("Identità della memoria immobile non coerente");
  const operationId = context ? unitOperation(runId, unit.key) : legacyOperation(source.jobId, source.sourcePropertyId);
  const completed = memory.event === "stage_completed" && checkpoint?.stage === "completed" && !checkpoint.lastError && Boolean(checkpoint.crmPropertyId);
  const kind = completed ? "import_completed" : memory.event;
  const origin = context?.origin ?? "live";
  appendUnitEvent(unit, [operationId, kind, kind === "import_started" || failure || completed ? memory.at : checkpoint?.stage], {
    kind, at: memory.at, runId, operationId, origin, sourceId: source.sourcePropertyId, streetId: context?.streetId,
    stage: checkpoint?.stage ?? failure?.stage, crmId: checkpoint?.crmPropertyId, message: completed ? "Import concluso e verificato nel gestionale" : failure?.message ?? ({ import_started: "Import avviato o ripreso", stage_completed: "Passaggio verificato e conservato", retry_scheduled: "Nuovo tentativo dopo un errore", import_paused: "Import in pausa", import_quarantined: "Immobile da verificare" })[memory.event],
    ...(completed || failure ? { source: structuredClone(source) } : {}),
    ...(failure ? { failure: { kind: failure.kind, stage: failure.stage, message: sanitizeSensitiveText(failure.message), retryable: failure.retryable, global: failure.global } } : {}),
    ...(completed ? { activity: checkpoint!.activityEvidence, resolution: checkpoint!.propertyResolution } : {}),
    ...(checkpoint && (completed || failure || checkpoint.stage === "people_resolved") ? { people: checkpoint.people.map(p => ({ taxCode: p.taxCode, crmIds: p.matches.map(m => m.id) })) } : {}),
    ...(checkpoint && (completed || failure || checkpoint.stage === "people_synced") ? { syncedPeople: checkpoint.syncedPeople } : {}),
    ...(checkpoint?.stage === "property_resolved" ? { resolution: checkpoint.propertyResolution } : {}),
  });
  if (completed) {
    const at = validAt(checkpoint!.updatedAt);
    if (!unit.importedAt || (at && Date.parse(at) >= Date.parse(unit.importedAt))) { unit.importedAt = at; unit.crmId = checkpoint!.crmPropertyId; }
    if (context && at) {
      const run = state.runs.find(r => r.id === runId);
      if (run) (run.imports ??= {})[unit.key] = { at, crmId: checkpoint!.crmPropertyId! };
    }
  }
}
export function rememberAcquisition(unit: Unit, observation: Unit["observations"][number], recovered = false) {
  appendUnitEvent(unit, ["acquired", observation.runId, observation.historyPropertyId ?? observation.source.sourcePropertyId, digest(observation.source)], {
    kind: "acquired", at: observation.at, runId: observation.runId, origin: observation.origin === "simulation" ? "simulation" : "live", sourceId: observation.source.sourcePropertyId, streetId: observation.streetId, recovered,
    message: recovered ? "Dati acquisiti recuperati dallo storico" : "Dati dell’immobile acquisiti e conservati",
  });
}
/** Backfill uses recorded evidence only; old logs cannot invent missing attempts or dates. */
export function hydrateUnitMemory(state: TerritoryState) {
  for (const job of state.history ?? []) for (const issue of job.issues) {
    if (!issue.source || !issue.at) continue;
    try {
      const unit = ensureMemoryUnit(state, issue.source, issue.at, `history:${job.id}`);
      if (issue.importVerified && issue.crmId) rememberHistoricalImport(unit, job.id, issue.source, issue.verifiedAt ?? null, issue.crmId);
    } catch { /* Incomplete cadastral identities remain in the original issues. */ }
  }
  for (const unit of Object.values(state.units)) {
    for (const observation of unit.observations) {
      rememberAcquisition(unit, observation, true);
      if (observation.importVerified && observation.crmId && observation.historyPropertyId) rememberHistoricalImport(unit, observation.source.jobId, observation.source, observation.importedAt ?? null, observation.crmId);
    }
    for (const run of state.runs.filter(r => r.operation === "apply" && r.imports?.[unit.key])) {
      const proof = run.imports![unit.key]!;
      const operationId = unitOperation(run.id, unit.key);
      appendUnitEvent(unit, [operationId, "import_completed", proof.at], { kind: "import_completed", at: proof.at, runId: run.id, operationId, origin: run.origin, streetId: run.streetId, crmId: proof.crmId, recovered: true, message: "Import verificato recuperato dal checkpoint della run", ...(run.applySources?.[unit.key] ? { source: run.applySources[unit.key] } : {}) });
    }
  }
}
export function rememberHistoricalImport(unit: Unit, jobId: string, source: SourceProperty, at: string | null, crmId: string, checkpoint?: Partial<ImportV2Checkpoint>) {
  const operationId = legacyOperation(jobId, source.sourcePropertyId);
  appendUnitEvent(unit, [operationId, "import_completed", validAt(at)], { kind: "import_completed", at, runId: `history:${jobId}`, operationId, origin: "live", sourceId: source.sourcePropertyId, source: checkpoint?.plan?.source ?? source, crmId, recovered: true, message: "Import verificato recuperato dallo storico", activity: checkpoint?.activityEvidence, resolution: checkpoint?.propertyResolution });
  const knownAt = validAt(at);
  if (knownAt && (!unit.importedAt || Date.parse(knownAt) >= Date.parse(unit.importedAt))) { unit.importedAt = knownAt; unit.crmId = crmId; }
  else if (!unit.crmId) unit.crmId = crmId;
}
export function unitMemory(unit: Unit) {
  const events = [...(unit.journal ?? [])].sort((a, b) => Date.parse(a.at ?? a.recordedAt) - Date.parse(b.at ?? b.recordedAt) || a.id.localeCompare(b.id));
  const successes = new Map<string, UnitEvent>();
  for (const e of events) if (e.kind === "import_completed" && e.crmId) {
    const key = e.operationId ?? e.id, prior = successes.get(key);
    if (!prior || e.at && (!prior.at || Date.parse(e.at) >= Date.parse(prior.at))) successes.set(key, e);
  }
  const acquisitions = events.filter(e => e.kind === "acquired");
  const last = events.filter(e => e.kind !== "stage_completed").at(-1);
  return { events, statistics: { acquisitions: new Set(acquisitions.map(e => e.runId)).size, versions: acquisitions.length, verifiedImports: successes.size, retries: events.filter(e => e.kind === "retry_scheduled").length, pauses: events.filter(e => e.kind === "import_paused").length, reviews: events.filter(e => e.kind === "import_quarantined").length, corrections: events.filter(e => e.kind === "corrected").length, lastImportedAt: [...successes.values()].map(e => e.at).filter((at): at is string => Boolean(at)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null },
    state: last?.kind === "import_completed" ? "Import verificato" : last && ["import_quarantined", "import_paused", "retry_scheduled"].includes(last.kind) ? "Da verificare o riprendere" : unit.assessment?.kind === "synced" ? "Import verificato" : "Dati da confrontare", incompleteHistory: events.some(e => e.recovered),
  };
}
