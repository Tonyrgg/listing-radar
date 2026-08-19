import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { runLifecycleWorkerOnce } from "../src/lib/property-lifecycle/jobs/worker";

function localSupabaseConfiguration(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(`Milestone 1 worker refuses non-local Supabase host ${parsed.hostname}.`);
  }
  return { url, serviceRoleKey };
}

async function main(): Promise<void> {
  const { url, serviceRoleKey } = localSupabaseConfiguration();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const workerId = `local-${process.pid}-${randomUUID().slice(0, 8)}`;
  const didWork = await runLifecycleWorkerOnce(workerId, { db });
  console.info(didWork ? "Lifecycle worker completed one job." : "No lifecycle job was ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
