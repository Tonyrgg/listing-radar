import { randomUUID } from "node:crypto";
import { type TerritoryState, type Unit, type Run } from "./model.js";

export type ImportQueueEntry = { id: string; key: string; streetId: string; addedAt: string };
export function queueStreet(state: TerritoryState, unit: Unit, preferred?: string) {
  const canonical = (id: string) => state.streets.find(s => s.id === (state.streets.find(s => s.id === id)?.linkedOfficialId ?? id) && !s.needsReview);
  const streets = [...new Map(unit.streetIds.map(canonical).filter(s => s).map(s => [s!.id, s!])).values()];
  if (preferred) return streets.find(s => s.id === canonical(preferred)?.id);
  const observed = [...unit.observations].reverse().find(o => o.streetId)?.streetId;
  return (observed && streets.find(s => s.id === canonical(observed)?.id)) || (streets.length === 1 ? streets[0] : undefined);
}
export function queueLocked(state: TerritoryState, key: string) {
  return state.runs.some(r => r.operation === "apply" && ["running", "paused", "failed"].includes(r.state) && !r.imports?.[key]?.crmId && r.itemKeys.slice(r.handled).includes(key));
}
/** Removal is tied to this enrollment, never to an older import of the same unit. */
export function settleQueueImport(state: TerritoryState, run: Run, key: string) {
  if (run.imports?.[key]?.crmId && state.importQueue?.[key]?.id === run.queueEntryIds?.[key]) delete state.importQueue![key];
}
export function hydrateImportQueue(state: TerritoryState) {
  state.importQueue ??= {};
  for (const run of state.runs) {
    if (run.operation !== "apply") continue;
    if (!run.queueEntryIds && ["running", "paused", "failed"].includes(run.state)) {
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
  }
}
