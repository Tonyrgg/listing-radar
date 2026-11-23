import type { SupabaseClient } from "@supabase/supabase-js";

export type ManualOpenTabsSummary = {
  agencyId: string;
  agencyName: string;
  finishedAt: string;
  created: number;
  updated: number;
  unchanged: number;
  review: number;
  errors: number;
};

export async function readManualOpenTabsSummaries(db: SupabaseClient): Promise<ManualOpenTabsSummary[] | null> {
  const { data, error } = await db.from("sync_runs")
    .select("agency_id,finished_at,error_count,diagnostics,agencies(name)")
    .eq("structure_fingerprint", "manual-open-tabs")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(100);
  if (error) return null;

  const latest = new Map<string, { key: string; summary: ManualOpenTabsSummary }>();
  for (const row of data ?? []) {
    if (!row.finished_at) continue;
    const diagnostics = row.diagnostics ?? {};
    const agency = Array.isArray(row.agencies) ? row.agencies[0] : row.agencies;
    const session = typeof diagnostics.acquisitionId === "string" ? diagnostics.acquisitionId : row.finished_at;
    const previous = latest.get(row.agency_id);
    if (previous && previous.key !== session) continue;
    const summary = previous?.summary ?? {
      agencyId: row.agency_id, agencyName: agency?.name ?? "Agenzia", finishedAt: row.finished_at, created: 0, updated: 0, unchanged: 0, review: 0, errors: 0,
    };
    summary.created += Number(diagnostics.created) || 0;
    summary.updated += Number(diagnostics.updated) || 0;
    summary.unchanged += Number(diagnostics.unchanged) || 0;
    summary.review += Number(diagnostics.review) || 0;
    summary.errors += row.error_count ?? 0;
    if (!previous) latest.set(row.agency_id, { key: session, summary });
  }
  return [...latest.values()].map(row => row.summary);
}
