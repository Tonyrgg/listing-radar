import { appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import path from "node:path";
import { IMPORT_V2_STAGES, type ImportV2Checkpoint, type ImportV2Stage } from "../import-v2/model.js";
import { logger } from "../logger.js";

export const IMPORT_TIMING_FILE = "import-v2-timings.jsonl";
type Timing = { durationMs: number; operationDurationMs: number; checkpointSaveDurationMs: number };
export type ImportTiming = Timing & {
  version: 1; id: string; runId: string | null; itemId: string; propertyId: string; at: string;
  event: "stage_completed" | "retry_scheduled" | "lookup_completed" | "lookup_failed";
  stage: ImportV2Stage | null; executedStage: ImportV2Stage | "candidate_lookup"; attempt: number; failureKind?: string;
};
const isStage = (value: unknown): value is ImportV2Stage => IMPORT_V2_STAGES.includes(value as ImportV2Stage);
const isMs = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Small append-only diagnostics; never serializes the property archive or copies failure payloads. */
export async function recordImportTiming(directory: string, runId: string | undefined, checkpoint: ImportV2Checkpoint, event: string, details: Record<string, unknown>): Promise<void> {
  if (!["stage_completed", "retry_scheduled"].includes(event) || !isStage(details.executedStage)
    || !isMs(details.durationMs) || !isMs(details.operationDurationMs) || !isMs(details.checkpointSaveDurationMs)) return;
  const attempt = typeof details.attempt === "number" && Number.isInteger(details.attempt) && details.attempt >= 1
    ? details.attempt : event === "retry_scheduled" ? checkpoint.attempts : 1;
  const identity = [runId ?? null, checkpoint.itemId, event, checkpoint.stage, details.executedStage, checkpoint.updatedAt, attempt];
  const row: ImportTiming = {
    version: 1, id: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    runId: runId ?? null, itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, at: checkpoint.updatedAt,
    event: event as ImportTiming["event"], stage: checkpoint.stage, executedStage: details.executedStage,
    attempt,
    durationMs: details.durationMs, operationDurationMs: details.operationDurationMs, checkpointSaveDurationMs: details.checkpointSaveDurationMs,
    ...(event === "retry_scheduled" && checkpoint.lastError ? { failureKind: checkpoint.lastError.kind } : {}),
  };
  await appendTiming(directory, row);
}

/** The initial cadastral lookup happens before the engine and must not disappear from performance evidence. */
export async function recordCandidateLookupTiming(directory: string, runId: string, propertyId: string, elapsedMs: number, attempt: number, failureKind?: string) {
  const at = new Date().toISOString(), durationMs = Math.max(0, Math.round(elapsedMs * 1000) / 1000);
  const event = failureKind ? "lookup_failed" : "lookup_completed";
  await appendTiming(directory, {
    version: 1, id: createHash("sha256").update(JSON.stringify([runId, propertyId, event, at, attempt])).digest("hex"),
    runId, itemId: propertyId, propertyId, at, event, stage: null, executedStage: "candidate_lookup", attempt,
    durationMs, operationDurationMs: durationMs, checkpointSaveDurationMs: 0, ...(failureKind ? { failureKind } : {}),
  });
}

async function appendTiming(directory: string, row: ImportTiming) {
  try { await appendFile(path.join(directory, IMPORT_TIMING_FILE), `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 }); }
  catch (error) {
    // Diagnostics cannot turn an already verified CRM save into a failed import.
    logger.warn({ action: "v2-timing-not-saved", code: (error as NodeJS.ErrnoException).code }, "Tempi V2 non salvati; checkpoint import conservato separatamente");
  }
}

function validRow(row: unknown): row is ImportTiming {
  if (!row || typeof row !== "object") return false;
  const r = row as ImportTiming;
  return r.version === 1 && typeof r.id === "string" && /^[a-f0-9]{64}$/.test(r.id)
    && (r.runId === null || typeof r.runId === "string" && Boolean(r.runId.trim()))
    && typeof r.itemId === "string" && Boolean(r.itemId.trim()) && typeof r.propertyId === "string" && Boolean(r.propertyId.trim())
    && typeof r.at === "string" && Number.isFinite(Date.parse(r.at))
    && ["stage_completed", "retry_scheduled", "lookup_completed", "lookup_failed"].includes(r.event)
    && (["lookup_completed", "lookup_failed"].includes(r.event)
      ? r.stage === null && r.executedStage === "candidate_lookup"
      : isStage(r.stage) && isStage(r.executedStage))
    && (r.failureKind === undefined || typeof r.failureKind === "string")
    && Number.isInteger(r.attempt) && r.attempt >= 1
    && isMs(r.durationMs) && isMs(r.operationDurationMs) && isMs(r.checkpointSaveDurationMs);
}
const percentile = (values: number[], fraction: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)]! : null;
const sumMs = (rows: ImportTiming[], field: keyof Timing) => Number(rows.reduce((sum, row) => sum + row[field], 0).toFixed(3));

/** Read-only report. Missing, malformed and conflicting evidence is never presented as a clean sample. */
export async function importTimingReport(filename: string, runId?: string) {
  const records = new Map<string, ImportTiming>();
  let invalidLines = 0, duplicates = 0, conflicts = 0;
  const lines = createInterface({ input: createReadStream(filename, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { invalidLines++; continue; }
    if (!validRow(row)) { invalidLines++; continue; }
    if (runId !== undefined && row.runId !== runId) continue;
    const prior = records.get(row.id);
    if (prior) { if (JSON.stringify(prior) === JSON.stringify(row)) duplicates++; else conflicts++; continue; }
    records.set(row.id, row);
  }
  const groups = new Map<string, ImportTiming[]>();
  for (const row of records.values()) {
    const key = `${row.executedStage}:${row.event}`;
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  return {
    version: 1, runId: runId ?? null, records: records.size, observedItems: new Set([...records.values()].map(r => `${r.runId}:${r.propertyId}`)).size,
    invalidLines, duplicates, conflicts, parseClean: invalidLines === 0 && conflicts === 0, sampleAvailable: records.size > 0,
    phases: [...groups.values()].map(rows => ({
      stage: rows[0]!.executedStage, event: rows[0]!.event, samples: rows.length,
      totalMs: sumMs(rows, "durationMs"),
      p50Ms: percentile(rows.map(row => row.durationMs), 0.5), p95Ms: percentile(rows.map(row => row.durationMs), 0.95),
      operationMs: sumMs(rows, "operationDurationMs"),
      checkpointSaveMs: sumMs(rows, "checkpointSaveDurationMs"),
      failuresByKind: Object.fromEntries([...new Set(rows.flatMap(row => row.failureKind ?? []))].map(kind => [kind, rows.filter(row => row.failureKind === kind).length])),
    })).sort((a, b) => b.totalMs - a.totalMs),
  };
}
