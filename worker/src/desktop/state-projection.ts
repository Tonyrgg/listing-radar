import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import type { JobRow, PropertyRow } from "../services/repository.js";
import { buildPropertyRunLedger, type RunLedgerAnomaly } from "../services/run-ledger.js";

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
  return ["skipped", "acquisition_skipped", "acquisition_failed"].includes(property.processing_status)
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
