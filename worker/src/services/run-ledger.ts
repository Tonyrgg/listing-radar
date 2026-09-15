import type { JobRow, PropertyRow } from "./repository.js";

export type RunEngine = "lavorazione" | "rifinitura" | "portoni";
export type RunRecordState = "pending" | "running" | "completed" | "completed_with_anomalies" | "skipped";

export type RunLedgerAnomaly = {
  propertyId: string | null;
  code?: string | null;
  message: string;
};

export type RunLedgerRow = {
  position: number;
  recordId: string;
  label: string;
  reference: string;
  state: RunRecordState;
  anomalies: Array<{ code: string | null; message: string }>;
};

export type PropertyRunLedger = {
  version: 1;
  engine: Exclude<RunEngine, "portoni">;
  state: "not_started" | "running" | "stopped" | "completed";
  rows: RunLedgerRow[];
  counts: {
    total: number;
    terminal: number;
    completed: number;
    completedWithAnomalies: number;
    skipped: number;
    pending: number;
  };
  cursor: {
    nextRow: number | null;
    nextRecordId: string | null;
    nextLabel: string | null;
  };
};

const skippedStatuses = new Set(["skipped", "acquisition_skipped", "acquisition_failed"]);
const completedStatuses = new Set(["completed", "synced", "dry_run"]);

export function propertyRunEngine(job: JobRow): Exclude<RunEngine, "portoni"> {
  return job.acquisition?.strategy === "street_refinement" || job.acquisition?.engine === "rifinitura"
    ? "rifinitura"
    : "lavorazione";
}

/**
 * The database is a durable store shared by the desktop worker, while the
 * product exposes two independent workspaces.  Partition at the boundary so
 * a refinement can never leak into the ordinary import queue or archive.
 */
export function partitionPropertyRuns<T extends { job: JobRow }>(items: T[]) {
  return {
    lavorazione: items.filter(({ job }) => propertyRunEngine(job) === "lavorazione"),
    rifinitura: items.filter(({ job }) => propertyRunEngine(job) === "rifinitura"),
  };
}

export function partitionPropertyJobs<T extends JobRow>(jobs: T[]) {
  return {
    lavorazione: jobs.filter((job) => propertyRunEngine(job) === "lavorazione"),
    rifinitura: jobs.filter((job) => propertyRunEngine(job) === "rifinitura"),
  };
}

function skipReason(property: PropertyRow): string | null {
  const payload = property.raw_payload ?? {};
  const skip = payload.skip_details as { reason?: unknown } | undefined;
  const acquisition = payload.acquisition as { reason?: unknown } | undefined;
  const reason = skip?.reason ?? acquisition?.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

function rawState(property: PropertyRow): "pending" | "completed" | "skipped" {
  const flowStage = String((property.raw_payload?.property_flow as { stage?: unknown } | undefined)?.stage ?? "");
  const importState = String((property.raw_payload?.import_v2 as { state?: unknown } | undefined)?.state ?? "");
  if (skippedStatuses.has(property.processing_status) || flowStage === "skipped") return "skipped";
  if (completedStatuses.has(property.processing_status) || flowStage === "completed" || importState === "completed") return "completed";
  return "pending";
}

/**
 * Registro unico da cui derivano sia il contatore sia il punto di ripresa.
 * Non usa `processed_properties`, perche' quel numero puo' essere obsoleto o
 * non contiguo quando due finestre lavorano in parallelo.
 */
export function buildPropertyRunLedger(input: {
  job: JobRow;
  properties: PropertyRow[];
  anomalies?: RunLedgerAnomaly[];
  activePropertyId?: string | null;
}): PropertyRunLedger {
  const anomaliesByProperty = new Map<string, Array<{ code: string | null; message: string }>>();
  for (const anomaly of input.anomalies ?? []) {
    if (!anomaly.propertyId) continue;
    const values = anomaliesByProperty.get(anomaly.propertyId) ?? [];
    if (!values.some((value) => value.code === (anomaly.code ?? null) && value.message === anomaly.message)) {
      values.push({ code: anomaly.code ?? null, message: anomaly.message });
    }
    anomaliesByProperty.set(anomaly.propertyId, values);
  }

  const rows = input.properties.map((property, index): RunLedgerRow => {
    const base = rawState(property);
    const anomalies = [...(anomaliesByProperty.get(property.id) ?? [])];
    const skippedReason = base === "skipped" ? skipReason(property) : null;
    if (skippedReason && !anomalies.some((item) => item.message === skippedReason)) {
      anomalies.push({ code: "skip_reason", message: skippedReason });
    }
    const state: RunRecordState = base === "skipped"
      ? "skipped"
      : base === "completed"
        ? anomalies.length ? "completed_with_anomalies" : "completed"
        : input.activePropertyId === property.id ? "running" : "pending";
    return {
      position: index + 1,
      recordId: property.id,
      label: property.address ?? property.cadastral_key,
      reference: property.cadastral_key,
      state,
      anomalies,
    };
  });
  const terminal = rows.filter((row) => ["completed", "completed_with_anomalies", "skipped"].includes(row.state));
  const next = rows.find((row) => row.state === "pending" || row.state === "running") ?? null;
  const completed = rows.filter((row) => row.state === "completed").length;
  const completedWithAnomalies = rows.filter((row) => row.state === "completed_with_anomalies").length;
  const skipped = rows.filter((row) => row.state === "skipped").length;
  const allDone = rows.length > 0 && terminal.length === rows.length;
  return {
    version: 1,
    engine: propertyRunEngine(input.job),
    state: input.job.status === "completed" || allDone
      ? "completed"
      : input.activePropertyId
        ? "running"
        : input.job.import_started_at
          ? "stopped"
          : "not_started",
    rows,
    counts: {
      total: rows.length,
      terminal: terminal.length,
      completed,
      completedWithAnomalies,
      skipped,
      pending: rows.length - terminal.length,
    },
    cursor: {
      nextRow: next?.position ?? null,
      nextRecordId: next?.recordId ?? null,
      nextLabel: next?.label ?? null,
    },
  };
}
