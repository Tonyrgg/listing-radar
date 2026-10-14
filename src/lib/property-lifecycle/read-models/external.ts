import type { SupabaseClient } from "@supabase/supabase-js";
export interface ExternalSourceStatus { key: string; enabled: boolean; projectionsEnabled: boolean; state: string | null;
  finishedAt: string | null; inventoryComplete: boolean; baselineReady: boolean; discovered: number; details: number;
  diagnostics: Record<string, unknown> }
export async function readExternalSourceStatus(db: SupabaseClient): Promise<ExternalSourceStatus[]> {
  const config = await db.from("market_observer_sources").select("source_key,enabled,projections_enabled").order("source_key");
  if (config.error) throw new Error(config.error.message);
  return await Promise.all((config.data ?? []).map(async source => {
    const latest = await db.from("market_observer_source_runs").select("state,finished_at,inventory_complete,baseline_ready,discovered_count,detail_fetch_count,diagnostics")
      .eq("source_key",source.source_key).order("started_at",{ascending:false}).limit(1).maybeSingle();
    if(latest.error) throw new Error(latest.error.message);
    return { key:source.source_key,enabled:source.enabled,projectionsEnabled:source.projections_enabled,state:latest.data?.state ?? null,
      finishedAt:latest.data?.finished_at ?? null,inventoryComplete:latest.data?.inventory_complete ?? false,
      baselineReady:latest.data?.baseline_ready ?? false,discovered:latest.data?.discovered_count ?? 0,
      details:latest.data?.detail_fetch_count ?? 0,diagnostics:latest.data?.diagnostics ?? {} };
  }));
}
