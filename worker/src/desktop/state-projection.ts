import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import type { JobRow, PropertyRow } from "../services/repository.js";
import { buildPropertyRunLedger, type RunLedgerAnomaly } from "../services/run-ledger.js";

function acquisitionFilters(acquisition: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!acquisition) return {};
  const runSettings = acquisition.runSettings as Record<string, unknown> | undefined;
  const acquisitionSettings = acquisition.acquisitionSettings as Record<string, unknown> | undefined;
  const checkpoint = acquisition.acquisitionCheckpoint as Record<string, unknown> | undefined;
  return (runSettings?.filters
    ?? acquisitionSettings?.filters
    ?? checkpoint?.filters
    ?? acquisition.filters
    ?? {}) as Record<string, unknown>;
}

/** A range containing one civic is part of the run identity, not just a filter. */
export function exactCivicNumber(acquisition: Record<string, unknown> | null | undefined): string | null {
  const filters = acquisitionFilters(acquisition);
  const minimum = filters.minCivicNumber;
  const maximum = filters.maxCivicNumber;
  if (minimum == null || maximum == null || String(minimum).trim() !== String(maximum).trim()) return null;
  return String(minimum).trim() || null;
}

/** Once Cloud import started, a stale SISTER cursor must never take control again. */
export function canResumeStreetAcquisition(job: Pick<JobRow, "status" | "import_started_at" | "acquisition">): boolean {
  if (job.status === "completed" || job.import_started_at) return false;
  return true;
}

export type JobImportProgress = {
  state: "not_started" | "running" | "stopped" | "completed";
  handled: number;
  total: number;
  nextRow: number | null;
  nextRecordId: string | null;
  completed: number;
  completedWithAnomalies: number;
  skipped: number;
  pending: number;
};

export function summarizeJobImportProgress(
  job: JobRow,
  properties: PropertyRow[],
  isActive = false,
  anomalies: RunLedgerAnomaly[] = [],
  activePropertyId: string | null = null,
): JobImportProgress {
  const ledger = buildPropertyRunLedger({
    job,
    properties,
    anomalies,
    activePropertyId: isActive ? activePropertyId : null,
  });
  return {
    state: ledger.state,
    handled: ledger.counts.terminal,
    total: ledger.counts.total,
    nextRow: ledger.cursor.nextRow,
    nextRecordId: ledger.cursor.nextRecordId,
    completed: ledger.counts.completed,
    completedWithAnomalies: ledger.counts.completedWithAnomalies,
    skipped: ledger.counts.skipped,
    pending: ledger.counts.pending,
  };
}

export type CompletedImportSummary = {
  propertyCount: number;
  peopleCount: number;
  ownershipCount: number;
  completedProperties: number;
  skippedProperties: number;
  skippedPeople: number;
};

export type AcquisitionProgressSummary = {
  state: "running" | "paused" | "completed" | "failed";
  position: number | null;
  total: number;
  totalIsFinal: boolean;
  completed: number;
  completedWithAnomalies: number;
  skipped: number;
  remaining: number;
  currentLabel: string | null;
  currentOwnerNames: string[];
  variant: number;
  variants: number;
};

/** A single, deterministic vocabulary for every acquisition counter shown by the UI. */
export function summarizeStreetAcquisition(
  checkpoint: SisterStreetRunCheckpoint,
): AcquisitionProgressSummary {
  const records = checkpoint.results.flatMap((result) => result.recordLedger ?? []);
  const activeResult = checkpoint.results.find((result) => result.cursor)
    ?? checkpoint.results.find((result) => result.outcome === "paused")
    ?? null;
  const knownTotal = checkpoint.results.reduce((sum, result) => sum + Number(result.rawRecords || 0), 0);
  const completed = records.filter((record) => record.status === "completed").length;
  const completedWithAnomalies = records.filter((record) => record.status === "completed_with_anomalies").length;
  const skipped = records.filter((record) => record.status === "skipped").length;
  const handled = completed + completedWithAnomalies + skipped;
  const cursor = activeResult?.cursor ?? null;
  return {
    state: checkpoint.status,
    position: cursor?.position ?? (checkpoint.status === "completed" ? knownTotal : handled ? handled + 1 : null),
    total: knownTotal,
    totalIsFinal: checkpoint.status === "completed" || checkpoint.currentVariantIndex >= checkpoint.variants.length - 1,
    completed,
    completedWithAnomalies,
    skipped,
    remaining: Math.max(0, knownTotal - handled),
    currentLabel: cursor?.label ?? null,
    currentOwnerNames: cursor?.ownerNames ?? [],
    variant: Math.min(checkpoint.currentVariantIndex + 1, Math.max(1, checkpoint.variants.length)),
    variants: checkpoint.variants.length,
  };
}

type CompletedGraph = {
  properties: Array<{
    id: string;
    processing_status: string;
    raw_payload: ({ property_flow?: { stage?: string } } & Record<string, unknown>) | null;
  }>;
  people: Array<{ id: string }>;
  ownerships: Array<{ property_id: string; person_id: string }>;
};

function isSkippedProperty(property: CompletedGraph["properties"][number]) {
  return ["skipped", "acquisition_skipped", "acquisition_failed", "quarantined"].includes(property.processing_status)
    || property.raw_payload?.property_flow?.stage === "skipped";
}

export function summarizeCompletedGraph(graph: CompletedGraph): CompletedImportSummary {
  const skippedPropertyIds = new Set(
    graph.properties.filter(isSkippedProperty).map((property) => property.id),
  );
  const skippedPeople = new Set(
    graph.ownerships
      .filter((ownership) => skippedPropertyIds.has(ownership.property_id))
      .map((ownership) => ownership.person_id),
  );
  return {
    propertyCount: graph.properties.length,
    peopleCount: graph.people.length,
    ownershipCount: graph.ownerships.length,
    completedProperties: graph.properties.length - skippedPropertyIds.size,
    skippedProperties: skippedPropertyIds.size,
    skippedPeople: skippedPeople.size,
  };
}

/** Keep resume data in the main process; send the renderer aggregates only. */
export function projectStreetCheckpointForRenderer(
  checkpoint: SisterStreetRunCheckpoint | null,
): SisterStreetRunCheckpoint | null {
  if (!checkpoint) return null;
  return {
    ...checkpoint,
    uniquePropertyKeys: [],
    results: checkpoint.results.map((result) => ({
      ...result,
      propertyKeys: [],
      expandedPropertyKeys: [],
      expandedOwnerKeys: [],
      filteredPropertyKeys: [],
    })),
  };
}
