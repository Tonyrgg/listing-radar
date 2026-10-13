import { createHash } from "node:crypto";
import { buildPlan, splitSourcePersonName } from "../import-v2/identity.js";
import { buildCadastralKey } from "../core/normalize.js";
import { sanitizeSensitiveText } from "../logger.js";
import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import { effectiveSource, type QuarantineItem, type Run, type TerritoryState, type Unit } from "./model.js";
import type { SourceProperty } from "../import-v2/model.js";

export function sourceProblem(source: SourceProperty): string | null {
  try {
    const plan = buildPlan(source);
    for (const owner of plan.source.owners) splitSourcePersonName(owner.fullName, owner.taxCode);
    return null;
  } catch (error) { return sanitizeSensitiveText(error instanceof Error ? error.message : "Dati SISTER non interpretabili"); }
}
export function quarantine(state: TerritoryState, item: Omit<QuarantineItem, "id" | "resolvedAt">) {
  const token = item.unitKey ?? item.recordKey ?? createHash("sha256").update(JSON.stringify([item.address, item.cadastral])).digest("hex");
  const id = `${item.runId}:${item.origin}:${token}`;
  const previous = state.quarantine?.[id];
  (state.quarantine ??= {})[id] = { ...previous, ...item, id, resolvedAt: null };
  return id;
}
export function isQuarantined(state: TerritoryState, unit: Unit): boolean {
  return Object.values(state.quarantine ?? {}).some(item => !item.resolvedAt && item.unitKey === unit.key);
}
/** A rejected read/preview can be compared again without editing good source data. */
export function canRetryQuarantinedUnit(state: TerritoryState, unit: Unit): boolean {
  const items = Object.values(state.quarantine ?? {}).filter(item => !item.resolvedAt && item.unitKey === unit.key);
  if (!items.length || sourceProblem(effectiveSource(unit))) return false;
  return items.every(item => item.origin === "apply" && (!item.checkpoint ||
    ["queued", "planned"].includes(item.checkpoint.stage) && !item.checkpoint.crmPropertyId && !item.checkpoint.syncedPeople.length));
}
export function resolveUnitQuarantine(state: TerritoryState, unit: Unit, at: string) {
  if (sourceProblem(effectiveSource(unit))) return;
  const recordKey = buildCadastralKey({ municipality: effectiveSource(unit).municipality, ...effectiveSource(unit).cadastral });
  for (const item of Object.values(state.quarantine ?? {})) if (!item.resolvedAt && (item.unitKey === unit.key || item.recordKey === recordKey)) item.resolvedAt = at;
}
/** Row-level anomalies finish in quarantine; interrupted queries never become completed. */
export function collectScanQuarantine(state: TerritoryState, run: Run) {
  const checkpoint = run.checkpoint as SisterStreetRunCheckpoint | undefined;
  if (!Array.isArray(checkpoint?.results)) return;
  for (const result of checkpoint.results) for (const record of result.recordLedger ?? []) {
    if (record.status !== "completed_with_anomalies" && !(record.status === "skipped" && /intestatario non persona fisica/i.test(record.anomaly ?? ""))) continue;
    const property = result.inventoryProperties?.find(p => buildCadastralKey(p) === record.key);
    const existing = Object.values(state.quarantine ?? {}).find(q => q.runId === run.id && q.recordKey === record.key);
    if (existing?.resolvedAt) continue;
    quarantine(state, { streetId: run.streetId, runId: run.id, at: record.completedAt || checkpoint.updatedAt || run.startedAt,
      origin: "scan", recordKey: record.key, address: property?.address ?? record.label,
      cadastral: property ? { urbanSection: null, sheet: property.sheet, parcel: property.parcel, parcelDenomination: null, subaltern: property.subaltern, income: null } : null,
      reason: sanitizeSensitiveText(record.anomaly ?? "Lettura SISTER da controllare"), ...(existing?.source ? { source: existing.source, unitKey: existing.unitKey } : {}) });
  }
}
export function hydrateQuarantine(state: TerritoryState) {
  for (const unit of Object.values(state.units)) {
    const observation = unit.observations.at(-1);
    const run = state.runs.find(r => r.id === observation?.runId && r.operation === "scan");
    if (!run) continue;
    const source = effectiveSource(unit), problem = sourceProblem(source);
    if (problem && !isQuarantined(state, unit)) quarantine(state, { streetId: run.streetId, runId: run.id, at: observation!.at, origin: "scan", source, address: source.fullAddress, cadastral: source.cadastral, unitKey: unit.key, recordKey: buildCadastralKey({ municipality: source.municipality, ...source.cadastral }), reason: problem });
  }
  for (const run of state.runs) if (run.operation === "scan") {
    collectScanQuarantine(state, run);
    const checkpoint = run.checkpoint as SisterStreetRunCheckpoint | undefined;
    // Repair only the old false partial state, with conclusive saved portal evidence.
    if (run.state === "paused" && run.error?.startsWith("Acquisizione parziale:") && checkpoint?.status === "completed" && !checkpoint.lastError
      && checkpoint.results.every(result => ["found", "empty"].includes(result.outcome))) {
      run.state = "completed"; run.endedAt = checkpoint.completedAt ?? checkpoint.updatedAt; run.error = null;
    }
  }
}
