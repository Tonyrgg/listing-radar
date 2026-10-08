import type { CrmPropertySnapshot, ImportV2Checkpoint, SourceProperty } from "../import-v2/model.js";
import { importProgress } from "./progress.js";
import type { RunSettings } from "./run-options.js";

export type Geometry = { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
export type Street = { id: string; name: string; sisterName: string; locality: string; geometry: Geometry | null; geometryEvidence: string | null; needsReview: boolean; catalogKind?: "official" | "network"; osmWayIds?: number[]; linkedOfficialId?: string };
export type Decision = "unknown" | "create" | "update" | "unchanged" | "review" | "synced";
export type Assessment = { kind: Decision; reason: string; candidateId: string | null; checkedAt: string; sourceId: string };
export type Observation = { at: string; runId: string; source: SourceProperty; origin: "simulation" | "sister"; activityEligible?: boolean; historyPropertyId?: string; historyRevision?: string; streetId?: string; importedAt?: string | null; crmId?: string | null; importVerified?: boolean };
export type HistoryIssue = { activityEligible?: boolean; propertyId: string; address: string | null; reason: string; source?: SourceProperty; at?: string; verifiedAt?: string | null; crmId?: string | null; importVerified?: boolean };
export type HistoricalWork = { id: string; streetIds: string[]; street: string | null; status: string; at: string; completedAt: string | null; acquired: number; imported: number; associated: number; issues: HistoryIssue[]; acquiredAt?: string; acquisitionComplete?: boolean; inventoryByStreet?: Record<string, string[]>; inventoryComplete?: boolean };
export type UnitEvent = {
  id: string; kind: "acquired" | "compared" | "corrected" | "import_started" | "stage_completed" | "retry_scheduled" | "import_paused" | "import_quarantined" | "import_completed" | "street_associated";
  at: string | null; recordedAt: string; runId: string; operationId?: string; origin: "simulation" | "live"; recovered?: boolean;
  sourceId?: string; streetId?: string; stage?: ImportV2Checkpoint["stage"]; message: string; crmId?: string | null;
  source?: SourceProperty; assessment?: Assessment; note?: string; failure?: Pick<import("../import-v2/model.js").ImportV2Failure, "kind" | "stage" | "message" | "retryable" | "global">;
  activity?: ImportV2Checkpoint["activityEvidence"]; resolution?: ImportV2Checkpoint["propertyResolution"];
  people?: { taxCode: string; crmIds: string[] }[]; syncedPeople?: ImportV2Checkpoint["syncedPeople"];
};
export type Unit = { key: string; streetIds: string[]; observations: Observation[]; sourceVersionId?: string; corrections: { address?: string; category?: string; owners?: SourceProperty["owners"] }; note: string; assessment: Assessment | null; importedAt: string | null; crmId: string | null; journal?: UnitEvent[] };
export type Run = { unitStreetIds?: Record<string, string>; selectionScope?: string[]; query?: import("./query.js").UnitQuery; id: string; streetId: string; operation: "scan" | "compare" | "apply"; origin: "simulation" | "live"; state: "running" | "paused" | "failed" | "completed"; startedAt: string; endedAt: string | null; handled: number; total: number | null; error: string | null; itemKeys: string[]; checkpoint?: unknown; acquisitionRunId?: string | null; imports?: Record<string, { at: string; crmId: string }>; settings?: RunSettings; applySources?: Record<string, SourceProperty> };
export type Event = { id: string; streetId: string; at: string; text: string; unitKey?: string };
export type StreetMemory = { note: string; attention: boolean; updatedAt: string; registeredAt?: string };
export type TerritoryState = { zones?: Record<string, import("./query.js").WorkerZone>; savedQueries?: Record<string, import("./query.js").SavedUnitQuery>; version: 1; streets: Street[]; memories: Record<string, StreetMemory>; units: Record<string, Unit>; runs: Run[]; events: Event[]; checkpoints: Record<string, ImportV2Checkpoint>; virtualCrm: Record<string, CrmPropertySnapshot>; virtualPeople: Record<string, import("../import-v2/model.js").CrmPersonSnapshot>; virtualActivities?: Record<string, { id: string; propertyId: string; activity: SourceProperty["activity"] }>; history?: HistoricalWork[]; historicalStreetMappings?: Record<string, string>; networkBindings?: Record<string, { officialId: string; confirmedAt: string; geometry?: Geometry; evidence?: string | null }> };
export type StreetStatus = "unseen" | "running" | "paused" | "review" | "acquired" | "completed";

export const STATUS_LABELS: Record<StreetStatus, string> = { unseen: "Mai acquisita", running: "In corso", paused: "Da riprendere", review: "Da verificare", acquired: "Acquisita", completed: "Allineata" };
export const DECISION_LABELS: Record<Decision, string> = { unknown: "Da confrontare", create: "Da creare", update: "Da aggiornare", unchanged: "Già coerente", review: "Da verificare", synced: "Allineato" };
export function latest(unit: Unit): Observation { const result = unit.observations.at(-1); if (!result) throw new Error("Immobile privo di acquisizione"); return result; }
export function effectiveSource(unit: Unit): SourceProperty {
  const source = structuredClone(latest(unit).source);
  source.sourcePropertyId = unit.sourceVersionId ?? source.sourcePropertyId;
  if (unit.corrections.address !== undefined) source.fullAddress = unit.corrections.address;
  if (unit.corrections.category !== undefined) source.category = unit.corrections.category;
  if (unit.corrections.owners !== undefined) source.owners = structuredClone(unit.corrections.owners);
  return source;
}
export function unitKey(source: SourceProperty): string {
  const values = [source.municipality, source.cadastral.urbanSection ?? "", source.cadastral.sheet, source.cadastral.parcel, source.cadastral.subaltern];
  if (![values[0], values[2], values[3], values[4]].every(x => x?.trim())) throw new Error("Identità catastale incompleta");
  return values.map(x => String(x).trim().toUpperCase()).join("|");
}
export function streetSummary(state: TerritoryState, street: Street) {
  const streetIds = relatedStreetIds(state, street.id);
  const units = Object.values(state.units).filter(unit => unit.streetIds.some(id => streetIds.includes(id)));
  const runs = state.runs.filter(run => streetIds.includes(run.streetId));
  const lastScan = [...runs].reverse().find(run => run.operation === "scan");
  const completeScan = [...runs].reverse().find(run => run.operation === "scan" && run.state === "completed");
  const lastObservationAt = units.map(unit => latest(unit).at).sort().at(-1) ?? null;
  const lastRun = runs.at(-1);
  const memory = state.memories[street.id];
  const review = units.filter(unit => unit.assessment?.kind === "review").length;
  const unresolved = units.filter(unit => !["synced", "unchanged"].includes(unit.assessment?.kind ?? "unknown")).length;
  let status: StreetStatus = "unseen";
  if (units.length) status = "acquired";
  if (lastScan) status = lastScan.state === "completed" ? "acquired" : "paused";
  if (lastScan?.state === "completed" && !unresolved) status = "completed";
  const attention = streetIds.some(id => state.memories[id]?.attention);
  if (review || attention) status = "review";
  if (lastRun?.state === "paused" || lastRun?.state === "failed") status = "paused";
  if (lastRun?.state === "running") status = "running";
  return { ...street, status, label: STATUS_LABELS[status], count: units.length, review, unresolved, lastScanAt: completeScan?.endedAt ?? null, lastObservationAt, registeredAt: memory?.registeredAt ?? null, attention, progress: importProgress(state, streetIds) };
}
export function relatedStreetIds(state: TerritoryState, id: string) { return [id, ...Object.entries(state.networkBindings ?? {}).filter(([, binding]) => binding.officialId === id).map(([networkId]) => networkId)]; }
