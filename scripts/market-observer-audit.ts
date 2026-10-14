/** Read-only runtime evidence. Never prints credentials or source payloads. */
import { writeFile } from "node:fs/promises";
import { getSupabaseServiceClient } from "../src/lib/supabase/service";

async function main() {
  const db=getSupabaseServiceClient();
  const [agencies,runs,jobs,baseline]=await Promise.all([
    db.from("agencies").select("id,slug,adapter_key,enabled"),
    db.from("sync_runs").select("agency_id,status,health_state,inventory_complete,absence_evaluation_allowed,started_at,finished_at,discovered_count,normalized_count,error_count,diagnostics").order("started_at",{ascending:false}).limit(100),
    db.from("lifecycle_jobs").select("job_type,status,attempts,run_after,lease_expires_at").in("status",["QUEUED","RUNNING","RETRY","DEAD_LETTER"]).limit(100),
    db.from("adapter_health_baselines").select("agency_id,consecutive_healthy_runs,consecutive_failures,rolling_median,last_success_at"),
  ]);
  for(const result of [agencies,runs,jobs,baseline]) if(result.error) throw new Error(result.error.message);
  const report={observedAt:new Date().toISOString(),readOnly:true,
    sources:(agencies.data??[]).map(agency=>{
      const latest=(runs.data??[]).find(run=>run.agency_id===agency.id);
      return {slug:agency.slug,adapter:agency.adapter_key,enabled:agency.enabled,
        health:latest?.health_state??null,status:latest?.status??null,lastRunAt:latest?.started_at??null,
        finishedAt:latest?.finished_at??null,found:latest?.discovered_count??null,processed:latest?.normalized_count??null,
        errors:latest?.error_count??null,inventoryComplete:latest?.inventory_complete??false,
        absenceAllowed:latest?.absence_evaluation_allowed??false,
        baseline:(baseline.data??[]).find(item=>item.agency_id===agency.id)??null};
    }),jobs:jobs.data??[],sampledRunCount:runs.data?.length??0};
  const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice(9);
  if(output) await writeFile(output,JSON.stringify(report,null,2),"utf8");
  console.info(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error("Read-only audit failed: configuration, connectivity or schema unavailable. No data changed.");process.exitCode=1;});
