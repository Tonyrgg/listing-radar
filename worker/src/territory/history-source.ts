import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AcquiredGraph } from "../services/acquisition-queue.js";
import type { JobRow, PropertyRow, PersonRow, ImportV2ItemRow } from "../services/repository.js";

export type HistoryJob = { job: JobRow; graph: AcquiredGraph; items: Array<ImportV2ItemRow & { completed_at?: string | null; updated_at?: string }>; ignoredBusinessRows: number[] };
export type HistorySnapshot = { version: 1; readOnly: true; exportedAt: string; source: string; jobs: HistoryJob[]; skippedJobIds: string[] };

/** Defence at HTTP level: even an accidental repository write cannot reach the source. */
export function historyReadOnlyFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!["GET", "HEAD"].includes(method)) throw new Error("Lo storico ammette soltanto letture GET/HEAD");
    return fetcher(input, init);
  };
}
export function historyClient(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: historyReadOnlyFetch() } });
}
export async function historyRows<T>(client: SupabaseClient, table: string, scope?: { field: string; value: string | string[] }): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    let query = client.from(table).select("*").order("id").range(start, start + 499);
    if (scope) query = Array.isArray(scope.value) ? query.in(scope.field, scope.value) : query.eq(scope.field, scope.value);
    const result = await query;
    if (result.error) throw new Error(`Lettura storico ${table} non riuscita (${result.error.code ?? "errore remoto"})`);
    rows.push(...result.data as T[]);
    if (result.data.length < 500) break;
  }
  return rows;
}
export async function exportHistory(client: SupabaseClient, source: string): Promise<HistorySnapshot> {
  const initial = await historyRows<JobRow>(client, "property_worker_jobs");
  const snapshot: HistorySnapshot = { version: 1, readOnly: true, source, exportedAt: new Date().toISOString(), jobs: [], skippedJobIds: [] };
  for (const job of initial) {
    if (["running", "processing", "in_progress"].includes(job.status)) { snapshot.skippedJobIds.push(job.id); continue; }
    const scope = { field: "job_id", value: job.id };
    const [properties, people, items, steps] = await Promise.all([
      historyRows<PropertyRow>(client, "property_worker_properties", scope),
      historyRows<PersonRow>(client, "property_worker_people", scope),
      historyRows<HistoryJob["items"][number]>(client, "property_worker_import_v2_items", scope),
      historyRows<{ step_name: string; output_data: Record<string, unknown> | null }>(client, "property_worker_steps", scope),
    ]);
    const ownerships: AcquiredGraph["ownerships"] = [];
    for (let start = 0; start < properties.length; start += 100) ownerships.push(...await historyRows<AcquiredGraph["ownerships"][number]>(client, "property_worker_ownerships", { field: "property_id", value: properties.slice(start, start + 100).map(p => p.id) }));
    const ignoredBusinessRows = steps.filter(s => s.step_name === "owners_extracted").flatMap(s => Array.isArray(s.output_data?.ignoredBusinesses) ? s.output_data.ignoredBusinesses.flatMap((row: unknown) => {
      const index = Number((row as { rowIndex?: number } | null)?.rowIndex);
      return Number.isInteger(index) ? [index] : [];
    }) : []);
    snapshot.jobs.push({ job, graph: { properties, people, ownerships }, items, ignoredBusinessRows });
  }
  // Do not adopt rows from a job changing while its graph is being read.
  const final = new Map((await historyRows<JobRow>(client, "property_worker_jobs")).map(job => [job.id, job]));
  snapshot.jobs = snapshot.jobs.filter(({ job }) => {
    const current = final.get(job.id);
    const unchanged = current && current.updated_at === job.updated_at && current.status === job.status;
    if (!unchanged) snapshot.skippedJobIds.push(job.id);
    return unchanged;
  });
  return snapshot;
}

/** A stable read of one daily acquisition; never resumes or writes its job. */
export async function exportAcquisition(client: SupabaseClient, source: string, jobId: string): Promise<HistorySnapshot> {
  const job = (await historyRows<JobRow>(client, "property_worker_jobs", { field: "id", value: jobId }))[0];
  const snapshot: HistorySnapshot = { version: 1, readOnly: true, source, exportedAt: new Date().toISOString(), jobs: [], skippedJobIds: [] };
  if (!job || ["ready", "running", "processing", "in_progress"].includes(job.status)) { snapshot.skippedJobIds.push(jobId); return snapshot; }
  const scope = { field: "job_id", value: jobId };
  const [properties, people, items, steps] = await Promise.all([
    historyRows<PropertyRow>(client, "property_worker_properties", scope),
    historyRows<PersonRow>(client, "property_worker_people", scope),
    historyRows<HistoryJob["items"][number]>(client, "property_worker_import_v2_items", scope),
    historyRows<{ step_name: string; output_data: Record<string, unknown> | null }>(client, "property_worker_steps", scope),
  ]);
  const ownerships: AcquiredGraph["ownerships"] = [];
  for (let offset = 0; offset < properties.length; offset += 100) ownerships.push(...await historyRows<AcquiredGraph["ownerships"][number]>(client, "property_worker_ownerships", { field: "property_id", value: properties.slice(offset, offset + 100).map(p => p.id) }));
  const current = (await historyRows<JobRow>(client, "property_worker_jobs", { field: "id", value: jobId }))[0];
  if (!current || current.updated_at !== job.updated_at || current.status !== job.status) { snapshot.skippedJobIds.push(jobId); return snapshot; }
  const ignoredBusinessRows = steps.filter(s => s.step_name === "owners_extracted").flatMap(s => Array.isArray(s.output_data?.ignoredBusinesses) ? s.output_data.ignoredBusinesses.flatMap((row: unknown) => {
    const index = Number((row as { rowIndex?: number } | null)?.rowIndex); return Number.isInteger(index) ? [index] : [];
  }) : []);
  if (properties.length || job.acquisition?.acquisitionCheckpoint) snapshot.jobs.push({ job, graph: { properties, people, ownerships }, items, ignoredBusinessRows });
  return snapshot;
}
