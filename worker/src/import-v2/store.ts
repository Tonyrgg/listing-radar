import type { SupabaseClient } from "@supabase/supabase-js";

import { ImportV2Error } from "./errors.js";
import type {
  ImportV2Checkpoint,
  ImportV2Failure,
  ImportV2Plan,
  SourceProperty,
} from "./model.js";
import type { ImportV2Store } from "./ports.js";

type ImportV2ItemRow = {
  id: string;
  job_id: string;
  property_id: string;
  plan_fingerprint: string | null;
  stage: ImportV2Checkpoint["stage"];
  status: "queued" | "running" | "quarantined" | "paused" | "completed";
  plan: ImportV2Plan | null;
  checkpoint: Partial<ImportV2Checkpoint> | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: ImportV2Failure | null;
  updated_at: string;
};

function checkpointFromRow(row: ImportV2ItemRow): ImportV2Checkpoint {
  return {
    itemId: row.id,
    jobId: row.job_id,
    propertyId: row.property_id,
    stage: row.stage,
    plan: row.plan,
    people: row.checkpoint?.people ?? [],
    syncedPeople: row.checkpoint?.syncedPeople ?? [],
    propertyResolution: row.checkpoint?.propertyResolution ?? null,
    crmPropertyId: row.checkpoint?.crmPropertyId ?? null,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}
function checkpointPayload(checkpoint: ImportV2Checkpoint) {
  return {
    people: checkpoint.people,
    syncedPeople: checkpoint.syncedPeople,
    propertyResolution: checkpoint.propertyResolution,
    crmPropertyId: checkpoint.crmPropertyId,
  };
}

export class SupabaseImportV2Store implements ImportV2Store {
  constructor(private readonly client: SupabaseClient) {}

  async loadOrCreate(plan: ImportV2Plan): Promise<ImportV2Checkpoint> {
    const payload = {
      job_id: plan.source.jobId,
      property_id: plan.source.sourcePropertyId,
      plan_fingerprint: plan.fingerprint,
      plan,
      stage: "queued",
      status: "queued",
    };
    const existing = await this.client.from("property_worker_import_v2_items")
      .select("*").eq("property_id", plan.source.sourcePropertyId).maybeSingle();
    if (existing.error) throw new Error(`Lettura checkpoint Import V2 fallita: ${existing.error.message}`);
    if (existing.data) {
      const row = existing.data as ImportV2ItemRow;
      if (row.plan_fingerprint !== plan.fingerprint) {
        throw new ImportV2Error("L'acquisizione è cambiata dopo l'inizio dell'import", "invalid_source", {
          details: { previousFingerprint: row.plan_fingerprint, currentFingerprint: plan.fingerprint },
        });
      }
      return checkpointFromRow(row);
    }
    const created = await this.client.from("property_worker_import_v2_items")
      .insert(payload).select("*").single();
    if (created.error) throw new Error(`Creazione checkpoint Import V2 fallita: ${created.error.message}`);
    return checkpointFromRow(created.data as ImportV2ItemRow);
  }

  async save(checkpoint: ImportV2Checkpoint): Promise<void> {
    const completed = checkpoint.stage === "completed";
    const result = await this.client.from("property_worker_import_v2_items").update({
      stage: checkpoint.stage,
      status: completed ? "completed" : "running",
      checkpoint: checkpointPayload(checkpoint),
      attempts: checkpoint.attempts,
      next_attempt_at: checkpoint.nextAttemptAt,
      last_error: checkpoint.lastError,
      completed_at: completed ? checkpoint.updatedAt : null,
    }).eq("id", checkpoint.itemId);
    if (result.error) throw new Error(`Salvataggio checkpoint Import V2 fallito: ${result.error.message}`);
  }

  async recordEvent(checkpoint: ImportV2Checkpoint, event: string, details: Record<string, unknown> = {}): Promise<void> {
    const result = await this.client.from("property_worker_import_v2_events").insert({
      item_id: checkpoint.itemId,
      job_id: checkpoint.jobId,
      property_id: checkpoint.propertyId,
      stage: checkpoint.stage,
      event_name: event,
      details,
    });
    if (result.error) throw new Error(`Audit Import V2 fallito: ${result.error.message}`);
  }

  async quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure): Promise<void> {
    const result = await this.client.from("property_worker_import_v2_items").update({
      status: "quarantined",
      stage: checkpoint.stage,
      checkpoint: checkpointPayload(checkpoint),
      attempts: checkpoint.attempts,
      last_error: failure,
    }).eq("id", checkpoint.itemId);
    if (result.error) throw new Error(`Accantonamento Import V2 fallito: ${result.error.message}`);
    await this.recordEvent(checkpoint, "quarantined", { failure });
  }

  async pause(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure): Promise<void> {
    const result = await this.client.from("property_worker_import_v2_items").update({
      status: "paused",
      stage: checkpoint.stage,
      checkpoint: checkpointPayload(checkpoint),
      attempts: checkpoint.attempts,
      last_error: failure,
    }).eq("id", checkpoint.itemId);
    if (result.error) throw new Error(`Pausa Import V2 fallita: ${result.error.message}`);
    await this.recordEvent(checkpoint, "paused", { failure });
  }

  async quarantineSource(source: SourceProperty, failure: ImportV2Failure): Promise<void> {
    const result = await this.client.from("property_worker_import_v2_items").upsert({
      job_id: source.jobId,
      property_id: source.sourcePropertyId,
      plan_fingerprint: null,
      plan: null,
      stage: "queued",
      status: "quarantined",
      checkpoint: {},
      attempts: 1,
      last_error: failure,
    }, { onConflict: "property_id" });
    if (result.error) throw new Error(`Accantonamento sorgente Import V2 fallito: ${result.error.message}`);
  }
}
