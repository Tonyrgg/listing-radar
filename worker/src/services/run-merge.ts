import type { JobRow, PropertyRow, WorkerRepository } from "./repository.js";
import { propertyRunEngine } from "./run-ledger.js";

export function mergedRunIds(job: JobRow): string[] {
  const ids = job.acquisition?.mergedRunIds;
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== job.id))] : [];
}

export function validateRunMerge(jobs: JobRow[]): void {
  const key = (job: JobRow) => [job.municipality, job.street].map((s) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase()).join("|");
  if (jobs.length < 2 || jobs.some((job) => job.status !== "completed" || propertyRunEngine(job) !== "lavorazione" || !job.street || key(job) !== key(jobs[0]!))) {
    throw new Error("Puoi unire solo lavorazioni concluse della stessa via e dello stesso comune.");
  }
}

/** A unified archive view: original jobs, checkpoints and overlapping attempts
 * remain stored intact. Prefer a verified result for the same cadastral unit. */
export function mergeRunGraphs(graphs: Array<Awaited<ReturnType<WorkerRepository["loadGraph"]>>>) {
  const properties = new Map<string, PropertyRow>();
  const rank = (p: PropertyRow) => ["completed", "synced", "dry_run"].includes(p.processing_status) ? 2 : p.crm_record_id ? 1 : 0;
  for (const graph of graphs) for (const property of graph.properties) {
    const key = property.cadastral_key || property.id;
    const previous = properties.get(key);
    if (!previous || rank(property) > rank(previous)) properties.set(key, property);
  }
  const propertyIds = new Set([...properties.values()].map((p) => p.id));
  const ownerships = graphs.flatMap((g) => g.ownerships).filter((o) => propertyIds.has(o.property_id));
  const personIds = new Set(ownerships.map((o) => o.person_id));
  return { properties: [...properties.values()], ownerships, people: graphs.flatMap((g) => g.people).filter((p) => personIds.has(p.id)) };
}
