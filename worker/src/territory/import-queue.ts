import { randomUUID } from "node:crypto";
import { unitKey, type TerritoryState, type Unit, type Run } from "./model.js";
import { runSettings } from "./run-options.js";

export type ImportQueueEntry = { id: string; key: string; streetId: string; addedAt: string };
export function queueStreet(state: TerritoryState, unit: Unit, preferred?: string) {
  const canonical = (id: string) => {
    const street = state.streets.find(s => s.id === id);
    const target = street?.linkedOfficialId ? state.streets.find(s => s.id === street.linkedOfficialId) : street;
    return target?.needsReview ? undefined : target;
  };
  const streets = [...new Map(unit.streetIds.map(canonical).filter(s => s).map(s => [s!.id, s!])).values()];
  if (preferred) return streets.find(s => s.id === canonical(preferred)?.id);
  const observed = [...unit.observations].reverse().find(o => o.streetId)?.streetId;
  return (observed && streets.find(s => s.id === canonical(observed)?.id)) || (streets.length === 1 ? streets[0] : undefined);
}
export function queueLocked(state: TerritoryState, key: string) {
  return state.runs.some(r => r.operation === "apply" && r.state === "running" && !r.imports?.[key]?.crmId && r.itemKeys.slice(r.handled).includes(key));
}
/** Recover a single property's original plan, even after a newer SISTER observation. */
export function pendingUnitImport(state: TerritoryState, key: string) {
  const checkpoints = Object.values(state.checkpoints).filter(c => {
    if (c.stage === "completed" || !c.plan) return false;
    try { return unitKey(c.plan.source) === key; } catch { return false; }
  });
  if (!checkpoints.length) return null;
  if (checkpoints.length !== 1) throw new Error("Più piani conservati per questo immobile: controlla lo storico prima di importare");
  const checkpoint = checkpoints[0]!;
  const run = [...state.runs].reverse().find(r => r.operation === "apply" && r.itemKeys.includes(key) && (r.applySources?.[key]?.sourcePropertyId === checkpoint.propertyId || (!r.applySources && state.units[key]?.observations.some(o => o.source.sourcePropertyId === checkpoint.propertyId))));
  if (!run) throw new Error("Opzioni originali dell’immobile non disponibili: nessuna scrittura automatica");
  return { checkpoint, source: structuredClone(checkpoint.plan!.source), settings: runSettings(run.unitSettings?.[key] ?? run.settings), streetId: run.unitStreetIds?.[key] ?? run.streetId, origin: run.origin };
}
/** Removal is tied to this enrollment, never to an older import of the same unit. */
export function settleQueueImport(state: TerritoryState, run: Run, key: string) {
  if (run.imports?.[key]?.crmId && state.importQueue?.[key]?.id === run.queueEntryIds?.[key]) delete state.importQueue![key];
}
export function hydrateImportQueue(state: TerritoryState, closeInterrupted = false) {
  state.importQueue ??= {};
  for (const run of state.runs) {
    if (run.operation !== "apply") continue;
    if (!run.queueEntryIds && ["running", "paused", "failed", "stopped"].includes(run.state)) {
      run.queueEntryIds = {};
      for (const key of run.itemKeys.slice(run.handled)) {
        const unit = state.units[key];
        if (!unit || run.imports?.[key]?.crmId) continue;
        const street = queueStreet(state, unit, run.unitStreetIds?.[key] ?? run.streetId) ?? queueStreet(state, unit);
        const entry = state.importQueue[key] ??= { id: randomUUID(), key, streetId: street?.id ?? run.streetId, addedAt: run.startedAt };
        run.queueEntryIds[key] = entry.id;
      }
    }
    for (const key of Object.keys(run.queueEntryIds ?? {})) settleQueueImport(state, run, key);
    if (["paused", "failed"].includes(run.state) || closeInterrupted && run.state === "running") {
      run.state = "stopped";
      run.endedAt ??= new Date().toISOString();
    }
  }
}
