import { createClient } from "@supabase/supabase-js";

import { createPropertyLifecycleAdapter } from "../src/lib/property-lifecycle/adapters/registry";
import { runBootstrapDryRun } from "../src/lib/property-lifecycle/bootstrap/dry-run";
import { PropertyLifecycleRepository } from "../src/lib/property-lifecycle/persistence/repository";

function localSupabaseConfiguration(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(
      "Bootstrap dry run refuses non-local Supabase host " + parsed.hostname + ".",
    );
  }
  return { url, serviceRoleKey };
}

function requestedAdapter(): string | null {
  const argument = process.argv.find((value) => value.startsWith("--adapter="));
  return argument?.slice("--adapter=".length).trim() || null;
}

async function main(): Promise<void> {
  const { url, serviceRoleKey } = localSupabaseConfiguration();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let query = db
    .from("agencies")
    .select("adapter_key")
    .eq("enabled", true)
    .order("slug");
  const adapterKey = requestedAdapter();
  if (adapterKey) {
    query = query.eq("adapter_key", adapterKey);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  const adapterKeys = (data ?? []).map(
    (agency: { adapter_key: string }) => agency.adapter_key,
  );
  if (adapterKeys.length === 0) {
    throw new Error(
      adapterKey
        ? "No enabled local agency uses adapter " + adapterKey + "."
        : "No enabled local agencies are configured.",
    );
  }

  const repository = new PropertyLifecycleRepository(db);
  const report = await runBootstrapDryRun({
    adapters: adapterKeys.map(createPropertyLifecycleAdapter),
    existingState: await repository.loadBootstrapState(),
  });
  console.info(JSON.stringify(report, null, 2));
  if (report.sourceFailures.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
