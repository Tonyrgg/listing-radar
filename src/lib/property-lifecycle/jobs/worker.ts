import type { SupabaseClient } from "@supabase/supabase-js";

import { createPropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/registry";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";
import {
  BuildingIntelligenceImporter,
  DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,
  DEFAULT_BUILDING_PRACTICE_SOURCE_URL,
} from "@/lib/property-lifecycle/buildings/importer";
import {
  LifecycleJobQueue,
  type LifecycleJob,
  type LifecycleJobType,
} from "@/lib/property-lifecycle/jobs/queue";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { PrivateRadarBridge } from "@/lib/property-lifecycle/private-radar/bridge";
import {
  processListingAssets,
  type AssetProcessingResult,
} from "@/lib/property-lifecycle/assets/pipeline";
import type { NormalizedListingV2 } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { runAgencySync, type SyncMode } from "@/lib/property-lifecycle/sync/engine";

export type LifecycleAssetProcessor = (
  listing: NormalizedListingV2,
  jobType: LifecycleJobType,
) => Promise<AssetProcessingResult>;

export interface WorkerDependencies {
  db: SupabaseClient;
  queue?: LifecycleJobQueue;
  adapterFactory?: (adapterKey: string) => PropertyLifecycleAdapter;
  fetcher?: typeof fetch;
  assetProcessor?: LifecycleAssetProcessor;
}

/**
 * The sync engine only reaches for assets in DEEP_SYNC and BOOTSTRAP mode, so a
 * fast sync never pays this cost. Without a processor here those two modes ran
 * with the pipeline default and the scheduled deep sync persisted publications
 * with no image fingerprint, so image evidence stopped accumulating after
 * Day Zero. LIFECYCLE_DEEP_MAX_ASSETS bounds the gallery walk per run.
 */
function deepSyncMaxAssets(): number {
  const configured = Number(process.env.LIFECYCLE_DEEP_MAX_ASSETS);
  return Number.isInteger(configured) && configured > 0 && configured <= 24
    ? configured
    : 24;
}

const defaultAssetProcessor: LifecycleAssetProcessor = (listing) =>
  processListingAssets(listing, {
    maxAssets: deepSyncMaxAssets(),
    requestDelayMs: 250,
    timeoutMs: 20_000,
    representativeImageCount: 2,
  });

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
  if (childType === "BOOTSTRAP_AGENCY" && job.payload.approved !== true) {
    throw new Error(
      "BOOTSTRAP_ALL requires payload.approved=true after dry-run validation.",
    );
  }
  for (const agency of (data ?? []) as Array<{ id: string; slug: string }>) {
    await queue.enqueue({
      jobType: childType,
      agencyId: agency.id,
      payload: {
        parentJobId: job.id,
        ...(childType === "BOOTSTRAP_AGENCY" ? { approved: true } : {}),
      },
      dedupeKey: `${childType}:${agency.slug}`,
    });
  }
}

async function executeAgencySync(
  db: SupabaseClient,
  job: LifecycleJob,
  adapterFactory: (adapterKey: string) => PropertyLifecycleAdapter,
  assetProcessor: LifecycleAssetProcessor,
): Promise<void> {
  if (!job.agency_id) {
    throw new Error(`Job ${job.id} requires agency_id.`);
  }
  if (job.job_type === "BOOTSTRAP_AGENCY" && job.payload.approved !== true) {
    throw new Error(
      "BOOTSTRAP_AGENCY requires payload.approved=true after dry-run validation.",
    );
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
    assetProcessor: (listing) => assetProcessor(listing, job.job_type),
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

function buildingSource(job: LifecycleJob): { sourceKey: string; sourceUrl: string } {
  const sourceKey =
    typeof job.payload.sourceKey === "string" && job.payload.sourceKey.trim()
      ? job.payload.sourceKey.trim()
      : DEFAULT_BUILDING_PRACTICE_SOURCE_KEY;
  const sourceUrl =
    typeof job.payload.sourceUrl === "string" && job.payload.sourceUrl.trim()
      ? job.payload.sourceUrl.trim()
      : DEFAULT_BUILDING_PRACTICE_SOURCE_URL;
  const parsed = new URL(sourceUrl);
  const allowedHosts = new Set([
    "www.opendata.maggioli.cloud",
    "dati.puglia.it",
    "opendata.comune.bitonto.ba.it",
  ]);
  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
    throw new Error(
      "BUILDING_DATA_SYNC source must be an approved HTTPS public-data host.",
    );
  }
  return { sourceKey, sourceUrl };
}

async function executeBuildingDataSync(
  db: SupabaseClient,
  job: LifecycleJob,
  fetcher: typeof fetch,
): Promise<void> {
  const { sourceKey, sourceUrl } = buildingSource(job);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetcher(sourceUrl, {
      signal: controller.signal,
      headers: {
        "user-agent": "ListingRadarLifecycle/2.0 (+building intelligence)",
        accept: "text/csv,text/plain;q=0.9",
      },
    });
    if (!response.ok) {
      throw new Error(
        "BUILDING_DATA_SYNC source returned HTTP " + response.status + ".",
      );
    }
    const maximumBytes = 25 * 1024 * 1024;
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new Error("BUILDING_DATA_SYNC source exceeds the 25 MB limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error("BUILDING_DATA_SYNC response exceeds the 25 MB limit.");
    }
    await new BuildingIntelligenceImporter(db).importCsv({
      sourceKey,
      sourceUrl,
      csv: new TextDecoder("utf-8").decode(bytes),
      sourceEtag: response.headers.get("etag"),
      sourceLastModified: response.headers.get("last-modified"),
      applicationCode:
        typeof job.payload.applicationCode === "string"
          ? job.payload.applicationCode
          : "ape",
    });
  } finally {
    clearTimeout(timeout);
  }
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
      await executeAgencySync(
        dependencies.db,
        job,
        adapterFactory,
        dependencies.assetProcessor ?? defaultAssetProcessor,
      );
    } else if (job.job_type === "POST_EXIT_CHECK") {
      await executePostExitCheck(dependencies.db, job);
    } else if (job.job_type === "BUILDING_DATA_SYNC") {
      await executeBuildingDataSync(
        dependencies.db,
        job,
        dependencies.fetcher ?? fetch,
      );
    } else if (job.job_type === "SYNC_PRIVATE_RADAR") {
      await new PrivateRadarBridge(dependencies.db).sync();
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
