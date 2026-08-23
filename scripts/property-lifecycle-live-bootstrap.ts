import { createClient } from "@supabase/supabase-js";

import { createPropertyLifecycleAdapter } from "../src/lib/property-lifecycle/adapters/registry";
import { processListingAssets } from "../src/lib/property-lifecycle/assets/pipeline";
import { PropertyLifecycleRepository } from "../src/lib/property-lifecycle/persistence/repository";
import { runAgencySync } from "../src/lib/property-lifecycle/sync/engine";

/**
 * Live bootstrap against the remote Supabase project that serves Listing Radar.
 *
 * The local-only bootstrap scripts intentionally refuse non-loopback hosts. This
 * entry point keeps that guardrail deliberate rather than removed: the caller must
 * name the exact project ref it intends to write to, and the ref must match the
 * configured Supabase URL. A mismatch aborts before any network work.
 */
function remoteConfiguration(): { url: string; key: string; ref: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurazione Supabase mancante.");

  const argument = process.argv.find((value) => value.startsWith("--confirm-project="));
  const confirmed = argument?.slice("--confirm-project=".length).trim();
  if (!confirmed) {
    throw new Error(
      "Live bootstrap richiede --confirm-project=<ref> per autorizzare scritture remote.",
    );
  }

  const hostname = new URL(url).hostname;
  const ref = hostname.split(".")[0];
  if (ref !== confirmed) {
    throw new Error(
      `Project ref confermato (${confirmed}) diverso da quello configurato (${ref}). Bootstrap interrotto.`,
    );
  }
  return { url, key, ref };
}

function requestedAdapters(): Set<string> | null {
  const argument = process.argv.find((value) => value.startsWith("--adapters="));
  if (!argument) return null;
  const keys = argument
    .slice("--adapters=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

function numericFlag(name: string, fallback: number): number {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!argument) return fallback;
  const value = Number(argument.slice(name.length + 3));
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} non valido.`);
  return value;
}

async function main(): Promise<void> {
  const { url, key, ref } = remoteConfiguration();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const count = async (table: string): Promise<number> => {
    const result = await db.from(table).select("*", { count: "exact", head: true });
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    return result.count ?? 0;
  };

  // Deep bootstrap: the full gallery is fingerprinted, only representatives are kept.
  const maxAssets = numericFlag("max-assets", 24);
  const requestDelayMs = numericFlag("request-delay-ms", 250);
  const timeoutMs = numericFlag("timeout-ms", 20_000);

  const agencies = await db
    .from("agencies")
    .select("slug,adapter_key")
    .eq("enabled", true)
    .order("slug");
  if (agencies.error) throw new Error(agencies.error.message);

  const selected = requestedAdapters();
  const targets = (agencies.data ?? []).filter(
    ({ adapter_key }) => !selected || selected.has(adapter_key),
  );

  const repository = new PropertyLifecycleRepository(db);
  const startedAt = Date.now();
  const results: unknown[] = [];

  console.error(
    `[bootstrap] project=${ref} agenzie=${targets.length} max-assets=${maxAssets} delay=${requestDelayMs}ms`,
  );

  for (const [index, row] of targets.entries()) {
    const adapter = createPropertyLifecycleAdapter(row.adapter_key);
    const agencyStartedAt = Date.now();
    console.error(`[bootstrap] (${index + 1}/${targets.length}) ${row.slug} avvio...`);
    try {
      const result = await runAgencySync({
        adapter,
        repository,
        mode: "BOOTSTRAP",
        assetProcessor: (listing) =>
          processListingAssets(listing, {
            maxAssets,
            requestDelayMs,
            timeoutMs,
            representativeImageCount: 2,
          }),
      });
      const seconds = Math.round((Date.now() - agencyStartedAt) / 1000);
      console.error(`[bootstrap] ${row.slug} completata in ${seconds}s`);
      results.push({ adapterKey: adapter.key, agencySlug: row.slug, status: "OK", seconds, result });
    } catch (error) {
      const seconds = Math.round((Date.now() - agencyStartedAt) / 1000);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bootstrap] ${row.slug} FALLITA dopo ${seconds}s: ${message}`);
      results.push({ adapterKey: adapter.key, agencySlug: row.slug, status: "FAILED", seconds, error: message });
    }
  }

  console.info(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        projectRef: ref,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        options: { maxAssets, requestDelayMs, timeoutMs, representativeImageCount: 2 },
        results,
        persisted: {
          properties: await count("properties"),
          buildings: await count("buildings"),
          agencyListings: await count("agency_listings"),
          publications: await count("publications"),
          locations: await count("locations"),
          snapshots: await count("snapshots"),
          evidence: await count("evidence"),
          events: await count("events"),
          imageFingerprints: await count("image_fingerprints"),
          floorplanFingerprints: await count("floorplan_fingerprints"),
          reviewQueue: await count("review_queue"),
          opportunities: await count("opportunities"),
          syncRuns: await count("sync_runs"),
          adapterHealth: await count("adapter_health"),
          adapterHealthBaselines: await count("adapter_health_baselines"),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
