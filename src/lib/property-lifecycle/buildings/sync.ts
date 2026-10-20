import type { SupabaseClient } from "@supabase/supabase-js";
import { BuildingIntelligenceImporter, DEFAULT_BUILDING_PRACTICE_SOURCE_KEY, DEFAULT_BUILDING_PRACTICE_SOURCE_URL } from "./importer";
import { importAlboRecords } from "./albo-importer";
import { importBitontoPlanCatalog, BITONTO_PLAN_SOURCE } from "./document-catalog";
import { PUBLIC_RECORD_POLICY as P, PRACTICES_2025 } from "./public-record-policy";
import { recomputeTerritorialGraph } from "./graph-recompute";

async function due(db: SupabaseClient,key: string,hours: number) {
  const r=await db.from("building_data_import_runs").select("finished_at").eq("source_key",key).eq("run_kind","LIVE").eq("status","SUCCEEDED").order("finished_at",{ascending:false}).limit(1).maybeSingle();
  if(r.error)throw Error(r.error.message);
  return !r.data?.finished_at || Date.now()-Date.parse(r.data.finished_at)>=hours*3600000;
}
async function importCsvSource(db:SupabaseClient,key:string,url:string,fetcher:typeof fetch){
  try{
    const r=await fetcher(url,{signal:AbortSignal.timeout(60000),redirect:"error"});
    if(!r.ok)throw Error(`Municipal dataset HTTP ${r.status}`);
    if(Number(r.headers.get("content-length"))>25*1024*1024)throw Error("Municipal CSV exceeds limit");
    const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.byteLength>25*1024*1024)throw Error("Municipal CSV exceeds limit");
    const result=await new BuildingIntelligenceImporter(db).importCsv({sourceKey:key,sourceUrl:url,csv:new TextDecoder().decode(bytes),sourceEtag:r.headers.get("etag"),applicationCode:"ape"});
    const status=await db.from("building_data_import_runs").update({health_state:result.status==="SUCCEEDED"?"HEALTHY":"DEGRADED",inventory_complete:result.status==="SUCCEEDED",pages:1,
      diagnostics:{coverage:key===PRACTICES_2025.key?"2025 metadata only; no address/cadastral fields exposed":"2024 declared address/cadastral references",policyVersion:P.version}}).eq("id",result.importRunId);
    if(status.error)throw Error(status.error.message);
    return result;
  }catch(e){
    // Also cover network failures before the CSV importer can create its own run.
    await db.from("building_data_import_runs").insert({source_key:key,source_url:url,status:"FAILED",health_state:"FAILED",inventory_complete:false,finished_at:new Date().toISOString(),errors:[String(e)]});throw e;
  }
}
/** Existing job, independently due sources; a failed static dataset must not suppress the Albo. */
export async function syncPublicRecordSources(db:SupabaseClient,fetcher:typeof fetch=fetch){
  const results:Record<string,unknown>={},errors:string[]=[];
  const sources:Array<{key:string;hours:number;run:()=>Promise<unknown>}>= [
    {key:P.alboSource,hours:P.alboIntervalHours,run:()=>importAlboRecords(db,{fetcher})},
    {key:DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,hours:P.staticIntervalHours,run:()=>importCsvSource(db,DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,DEFAULT_BUILDING_PRACTICE_SOURCE_URL,fetcher)},
    {key:PRACTICES_2025.key,hours:P.staticIntervalHours,run:()=>importCsvSource(db,PRACTICES_2025.key,PRACTICES_2025.url,fetcher)},
    {key:BITONTO_PLAN_SOURCE,hours:P.staticIntervalHours,run:()=>importBitontoPlanCatalog(db,fetcher)},
  ];
  for(const s of sources){try{results[s.key]=await due(db,s.key,s.hours)?await s.run():{skipped:"not_due"};}catch(e){errors.push(`${s.key}: ${String(e)}`);}}
  // Reconcile derived context even when a source is not due or another source fails.
  try{results.territorialGraph=await recomputeTerritorialGraph(db,true);}catch(e){errors.push(`territorialGraph: ${String(e)}`);}
  if(errors.length)throw Error(errors.join("; "));
  return results;
}
