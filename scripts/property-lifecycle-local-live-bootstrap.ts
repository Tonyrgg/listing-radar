import { createClient } from "@supabase/supabase-js";

import { createPropertyLifecycleAdapter } from "../src/lib/property-lifecycle/adapters/registry";
import { processListingAssets } from "../src/lib/property-lifecycle/assets/pipeline";
import { PropertyLifecycleRepository } from "../src/lib/property-lifecycle/persistence/repository";
import { runAgencySync } from "../src/lib/property-lifecycle/sync/engine";

function localConfiguration(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurazione Supabase mancante.");
  if (!["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname)) {
    throw new Error("Local live bootstrap refuses non-local Supabase.");
  }
  return { url, key };
}

async function main(): Promise<void> {
  const { url, key } = localConfiguration();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const count = async (table: string): Promise<number> => {
    const result = await db.from(table).select("*", { count: "exact", head: true });
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  };
  const agencies = await db.from("agencies").select("adapter_key").eq("enabled", true).order("slug");
  if (agencies.error) throw new Error(agencies.error.message);
  const adapterArgument = process.argv.find((argument) => argument.startsWith("--adapters="));
  const selectedAdapters = adapterArgument
    ? new Set(
        adapterArgument
          .slice("--adapters=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      )
    : null;
  const repository = new PropertyLifecycleRepository(db);
  const results = [];
  for (const row of (agencies.data ?? []).filter(
    ({ adapter_key }) => !selectedAdapters || selectedAdapters.has(adapter_key),
  )) {
    const adapter = createPropertyLifecycleAdapter(row.adapter_key);
    results.push({
      adapterKey: adapter.key,
      agencySlug: adapter.agencySlug,
      result: await runAgencySync({
        adapter,
        repository,
        mode: "BOOTSTRAP",
        assetProcessor: (listing) => processListingAssets(listing, {
          maxAssets: 1,
          requestDelayMs: 100,
          timeoutMs: 15_000,
          representativeImageCount: 1,
        }),
      }),
    });
  }
  console.info(JSON.stringify({
    generatedAt: new Date().toISOString(),
    localOnly: true,
    results,
    persisted: {
      properties: await count("properties"),
      agencyListings: await count("agency_listings"),
      publications: await count("publications"),
      snapshots: await count("snapshots"),
      identityReviews: await count("review_queue"),
      events: await count("events"),
      opportunities: await count("opportunities"),
    },
  }));
}

void main();
