import type { SupabaseClient } from "@supabase/supabase-js";

import { createPropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/registry";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";
import {
  LifecycleJobQueue,
  type LifecycleJob,
  type LifecycleJobType,
} from "@/lib/property-lifecycle/jobs/queue";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { runAgencySync, type SyncMode } from "@/lib/property-lifecycle/sync/engine";

export interface WorkerDependencies {
  db: SupabaseClient;
  queue?: LifecycleJobQueue;
  adapterFactory?: (adapterKey: string) => PropertyLifecycleAdapter;
}

function fanoutType(jobType: LifecycleJobType): LifecycleJobType {
  switch (jobType) {
    case "SYNC_ALL":
      return "SYNC_AGENCY";
    case "DEEP_SYNC_ALL":
      return "DEEP_SYNC_AGENCY";
    case "BOOTSTRAP_ALL":
      return "BOOTSTRAP_AGENCY";
    default:
      throw new Error(`Job ${jobType} is not a fan-out job.`);
  }
}

function syncMode(jobType: LifecycleJobType): SyncMode {
  switch (jobType) {
    case "SYNC_AGENCY":
      return "SYNC";
    case "DEEP_SYNC_AGENCY":
      return "DEEP_SYNC";
    case "BOOTSTRAP_AGENCY":
      return "BOOTSTRAP";
    default:
      throw new Error(`Job ${jobType} is not an agency sync job.`);
  }
}

async function executeFanout(
  db: SupabaseClient,
  queue: LifecycleJobQueue,
  job: LifecycleJob,
): Promise<void> {
  const { data, error } = await db
    .from("agencies")
    .select("id,slug")
    .eq("enabled", true)
    .order("slug");
  if (error) {
    throw new Error(error.message);
  }

  const childType = fanoutType(job.job_type);
  for (const agency of (data ?? []) as Array<{ id: string; slug: string }>) {
    await queue.enqueue({
      jobType: childType,
      agencyId: agency.id,
      payload: { parentJobId: job.id },
      dedupeKey: `${childType}:${agency.slug}`,
    });
  }
}

async function executeAgencySync(
  db: SupabaseClient,
  job: LifecycleJob,
  adapterFactory: (adapterKey: string) => PropertyLifecycleAdapter,
): Promise<void> {
  if (!job.agency_id) {
    throw new Error(`Job ${job.id} requires agency_id.`);
  }
  const { data, error } = await db
    .from("agencies")
    .select("adapter_key")
    .eq("id", job.agency_id)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const agency = data as { adapter_key: string };
  await runAgencySync({
    adapter: adapterFactory(agency.adapter_key),
    repository: new PropertyLifecycleRepository(db),
    mode: syncMode(job.job_type),
    jobId: job.id,
  });
}

async function executePostExitCheck(
  db: SupabaseClient,
  job: LifecycleJob,
): Promise<void> {
  const agencyListingId = job.payload.agencyListingId;
  const publicationId = job.payload.publicationId;
  if (typeof agencyListingId !== "string") {
    throw new Error(`POST_EXIT_CHECK job ${job.id} requires payload.agencyListingId.`);
  }
  if (publicationId != null && typeof publicationId !== "string") {
    throw new Error(`POST_EXIT_CHECK job ${job.id} has invalid payload.publicationId.`);
  }
  await new PropertyLifecycleRepository(db).runPostExitCheck({
    jobId: job.id,
    agencyListingId,
    publicationId: publicationId ?? null,
  });
}

export async function runLifecycleWorkerOnce(
  workerId: string,
  dependencies: WorkerDependencies,
): Promise<boolean> {
  const queue = dependencies.queue ?? new LifecycleJobQueue(dependencies.db);
  const adapterFactory = dependencies.adapterFactory ?? createPropertyLifecycleAdapter;
  const job = await queue.claim(workerId);
  if (!job) {
    return false;
  }

  try {
    if (["SYNC_ALL", "DEEP_SYNC_ALL", "BOOTSTRAP_ALL"].includes(job.job_type)) {
      await executeFanout(dependencies.db, queue, job);
    } else if (
      ["SYNC_AGENCY", "DEEP_SYNC_AGENCY", "BOOTSTRAP_AGENCY"].includes(job.job_type)
    ) {
      await executeAgencySync(dependencies.db, job, adapterFactory);
    } else if (job.job_type === "POST_EXIT_CHECK") {
      await executePostExitCheck(dependencies.db, job);
    } else {
      throw new Error(`Job type ${job.job_type} is reserved but not implemented in milestone 1.`);
    }
    await queue.complete(job.id, workerId);
    return true;
  } catch (error) {
    await queue.fail(job, workerId, error);
    throw error;
  }
}
