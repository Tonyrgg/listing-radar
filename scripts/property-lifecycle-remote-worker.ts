import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { LifecycleJobQueue, type LifecycleJobType } from "../src/lib/property-lifecycle/jobs/queue";
import { runLifecycleWorkerOnce } from "../src/lib/property-lifecycle/jobs/worker";

/**
 * Remote scheduler and queue drainer for the Property Lifecycle jobs.
 *
 * The local worker script refuses non-loopback hosts on purpose. This entry point
 * keeps that refusal deliberate: the caller names the project ref it intends to
 * operate on and the ref must match the configured Supabase URL.
 *
 *   --enqueue=SYNC_ALL          queue a job and exit
 *   --drain                     claim and execute ready jobs until a bound is hit
 *   --max-seconds=N             wall-clock bound for the drain (default 3000)
 *   --max-jobs=N                job-count bound for the drain (default 200)
 */
function remoteConfiguration(): { url: string; key: string; ref: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurazione Supabase mancante.");

  const argument = process.argv.find((value) => value.startsWith("--confirm-project="));
  const confirmed = argument?.slice("--confirm-project=".length).trim();
  if (!confirmed) {
    throw new Error("Richiesto --confirm-project=<ref> per operare sul database remoto.");
  }
  const ref = new URL(url).hostname.split(".")[0];
  if (ref !== confirmed) {
    throw new Error(
      `Project ref confermato (${confirmed}) diverso da quello configurato (${ref}). Interrotto.`,
    );
  }
  return { url, key, ref };
}

function flag(name: string): string | null {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3).trim() : null;
}

function numericFlag(name: string, fallback: number): number {
  const raw = flag(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} non valido.`);
  return value;
}

/**
 * A slot key keeps repeated scheduler invocations from stacking duplicate work:
 * the queue rejects a second active job with the same dedupe key.
 */
function slotKey(jobType: LifecycleJobType): string {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (jobType === "SYNC_ALL") {
    return `scheduler:${jobType}:${day}:h${String(now.getUTCHours()).padStart(2, "0")}`;
  }
  return `scheduler:${jobType}:${day}`;
}

/**
 * A full deep sync walks every gallery in the market and does not fit a single
 * scheduled run, so the deep pass rotates: one agency per day, ordered by slug,
 * which gives every agency a deep sync roughly once a week.
 */
async function rotatedAgency(db: SupabaseClient): Promise<{ id: string; slug: string }> {
  const { data, error } = await db
    .from("agencies")
    .select("id,slug")
    .eq("enabled", true)
    .order("slug");
  if (error) throw new Error(error.message);
  const agencies = (data ?? []) as { id: string; slug: string }[];
  if (agencies.length === 0) throw new Error("Nessuna agenzia abilitata.");
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  return agencies[dayNumber % agencies.length];
}

async function enqueue(db: SupabaseClient, jobType: LifecycleJobType): Promise<void> {
  const queue = new LifecycleJobQueue(db);
  const rotate = process.argv.includes("--agency-rotation");
  const agency = rotate ? await rotatedAgency(db) : null;
  const job = await queue.enqueue({
    jobType,
    agencyId: agency?.id ?? null,
    priority: jobType === "SYNC_ALL" ? 10 : 5,
    dedupeKey: agency ? `${slotKey(jobType)}:${agency.slug}` : slotKey(jobType),
  });
  console.info(
    JSON.stringify({
      action: "enqueue",
      jobType,
      agencySlug: agency?.slug ?? null,
      jobId: job.id,
      status: job.status,
    }),
  );
}

async function drain(db: SupabaseClient): Promise<void> {
  const maxSeconds = numericFlag("max-seconds", 3_000);
  const maxJobs = numericFlag("max-jobs", 200);
  const deadline = Date.now() + maxSeconds * 1_000;
  const workerId = `remote-${process.pid}-${randomUUID().slice(0, 8)}`;

  let executed = 0;
  let failed = 0;
  while (executed < maxJobs && Date.now() < deadline) {
    let didWork: boolean;
    try {
      didWork = await runLifecycleWorkerOnce(workerId, { db });
    } catch (error) {
      // The queue already recorded the retry/dead-letter transition for this job.
      failed += 1;
      console.error(`[drain] job fallito: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!didWork) break;
    executed += 1;
    console.error(`[drain] job ${executed} completato`);
  }
  console.info(
    JSON.stringify({ action: "drain", workerId, executed, failed, exhausted: executed >= maxJobs }),
  );
}

async function main(): Promise<void> {
  const { url, key, ref } = remoteConfiguration();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const jobType = flag("enqueue") as LifecycleJobType | null;
  const wantsDrain = process.argv.includes("--drain");
  if (!jobType && !wantsDrain) {
    throw new Error("Specificare --enqueue=<JOB_TYPE> e/o --drain.");
  }

  console.error(`[remote-worker] project=${ref}`);
  if (jobType) await enqueue(db, jobType);
  if (wantsDrain) await drain(db);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
