import { loadConfig } from "../src/config.js";
import { WorkerRepository } from "../src/services/repository.js";

const jobId = process.argv[2]?.trim();
if (!jobId) throw new Error("Uso: npm run import-v2:observe-job -- <job-id>");

const config = loadConfig();
const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const [job, graph, importItemsResult] = await Promise.all([
  repository.getJob(jobId),
  repository.loadGraph(jobId),
  repository.client.from("property_worker_import_v2_items")
    .select("stage,status,updated_at,last_error")
    .eq("job_id", jobId)
    .order("updated_at", { ascending: false }),
]);
if (importItemsResult.error) throw new Error(`Lettura checkpoint Import V2 fallita: ${importItemsResult.error.message}`);
const importItems = importItemsResult.data ?? [];
const importErrors = Object.values(importItems.reduce<Record<string, { kind: string; stage: string; message: string; count: number }>>((groups, item) => {
  const failure = item.last_error as { kind?: unknown; stage?: unknown; message?: unknown } | null;
  if (!failure?.message) return groups;
  const key = `${String(failure.kind ?? "unknown")}|${String(failure.stage ?? item.stage)}|${String(failure.message)}`;
  groups[key] ??= { kind: String(failure.kind ?? "unknown"), stage: String(failure.stage ?? item.stage), message: String(failure.message), count: 0 };
  groups[key].count += 1;
  return groups;
}, {}));

function counts(values: string[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((candidate) => candidate === value).length]));
}

const propertyStages = graph.properties.map((property) => {
  const flow = property.raw_payload?.property_flow;
  return typeof flow === "object" && flow && "stage" in flow ? String(flow.stage) : "none";
});
const activityStates = graph.properties.map((property) => {
  const activity = property.raw_payload?.worker_activity;
  return typeof activity === "object" && activity && "state" in activity ? String(activity.state) : "none";
});

process.stdout.write(JSON.stringify({
  job: {
    id: job.id,
    status: job.status,
    currentStep: job.current_step,
    lastCompletedStep: job.last_completed_step,
    updatedAt: job.updated_at,
    error: job.error_message,
  },
  properties: {
    total: graph.properties.length,
    withCrmId: graph.properties.filter((property) => property.crm_record_id).length,
    processing: counts(graph.properties.map((property) => property.processing_status)),
    stages: counts(propertyStages),
    activities: counts(activityStates),
  },
  people: {
    total: graph.people.length,
    withCrmId: graph.people.filter((person) => person.crm_record_id).length,
    processing: counts(graph.people.map((person) => person.processing_status)),
  },
  ownerships: {
    total: graph.ownerships.length,
    processing: counts(graph.ownerships.map((ownership) => ownership.processing_status)),
  },
  importV2: {
    total: importItems.length,
    status: counts(importItems.map((item) => String(item.status))),
    stages: counts(importItems.map((item) => String(item.stage))),
    latestUpdate: importItems[0]?.updated_at ?? null,
    latestError: importItems.find((item) => item.last_error)?.last_error ?? null,
    errors: importErrors.sort((left, right) => right.count - left.count),
  },
}, null, 2));
