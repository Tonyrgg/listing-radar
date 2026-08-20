import type { SupabaseClient } from "@supabase/supabase-js";

export const LIFECYCLE_JOB_TYPES = [
  "SYNC_AGENCY",
  "SYNC_ALL",
  "DEEP_SYNC_AGENCY",
  "DEEP_SYNC_ALL",
  "BOOTSTRAP_AGENCY",
  "BOOTSTRAP_ALL",
  "POST_EXIT_CHECK",
  "BUILDING_DATA_SYNC",
  "SYNC_PRIVATE_RADAR",
] as const;

export type LifecycleJobType = (typeof LIFECYCLE_JOB_TYPES)[number];
export type LifecycleJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRY"
  | "SUCCEEDED"
  | "FAILED"
  | "DEAD_LETTER"
  | "CANCELLED";

export interface LifecycleJob {
  id: string;
  job_type: LifecycleJobType;
  agency_id: string | null;
  payload: Record<string, unknown>;
  status: LifecycleJobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
  worker_id: string | null;
}

interface QueueError {
  code?: string;
  message: string;
}

function throwQueueError(error: QueueError | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

export class LifecycleJobQueue {
  constructor(private readonly db: SupabaseClient) {}

  async enqueue(input: {
    jobType: LifecycleJobType;
    agencyId?: string | null;
    payload?: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
    runAfter?: string;
    dedupeKey?: string | null;
  }): Promise<LifecycleJob> {
    const { data, error } = await this.db
      .from("lifecycle_jobs")
      .insert({
        job_type: input.jobType,
        agency_id: input.agencyId ?? null,
        payload: input.payload ?? {},
        priority: input.priority ?? 0,
        max_attempts: input.maxAttempts ?? 5,
        run_after: input.runAfter ?? new Date().toISOString(),
        dedupe_key: input.dedupeKey ?? null,
      })
      .select(
        "id,job_type,agency_id,payload,status,priority,attempts,max_attempts,dedupe_key,worker_id",
      )
      .single();

    if (error?.code === "23505" && input.dedupeKey) {
      const existing = await this.db
        .from("lifecycle_jobs")
        .select(
          "id,job_type,agency_id,payload,status,priority,attempts,max_attempts,dedupe_key,worker_id",
        )
        .eq("dedupe_key", input.dedupeKey)
        .in("status", ["QUEUED", "RUNNING", "RETRY"])
        .single();
      throwQueueError(existing.error);
      if (existing.data) {
        return existing.data as LifecycleJob;
      }
    }

    throwQueueError(error);
    if (!data) {
      throw new Error("Enqueue lifecycle job returned no data.");
    }
    return data as LifecycleJob;
  }

  async claim(workerId: string, leaseSeconds = 300): Promise<LifecycleJob | null> {
    const { data, error } = await this.db.rpc("claim_lifecycle_job", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    throwQueueError(error);
    const jobs = (data ?? []) as LifecycleJob[];
    return jobs[0] ?? null;
  }

  async complete(jobId: string, workerId: string): Promise<LifecycleJob> {
    const { data, error } = await this.db.rpc("complete_lifecycle_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
    });
    throwQueueError(error);
    if (!data) {
      throw new Error(`Complete lifecycle job ${jobId} returned no data.`);
    }
    return data as LifecycleJob;
  }

  async fail(
    job: LifecycleJob,
    workerId: string,
    errorValue: unknown,
  ): Promise<void> {
    const deadLetter = job.attempts >= job.max_attempts;
    const retryDelaySeconds = Math.min(900, 15 * 2 ** Math.max(0, job.attempts - 1));
    const { data, error } = await this.db
      .from("lifecycle_jobs")
      .update({
        status: deadLetter ? "DEAD_LETTER" : "RETRY",
        run_after: new Date(Date.now() + retryDelaySeconds * 1_000).toISOString(),
        lease_expires_at: null,
        finished_at: deadLetter ? new Date().toISOString() : null,
        last_error: {
          message: errorValue instanceof Error ? errorValue.message : String(errorValue),
          failedAt: new Date().toISOString(),
        },
      })
      .eq("id", job.id)
      .eq("worker_id", workerId)
      .eq("status", "RUNNING")
      .select("id");
    throwQueueError(error);
    if (!data?.length) {
      throw new Error(`Worker ${workerId} no longer owns lifecycle job ${job.id}.`);
    }
  }
}
