import type { SupabaseClient } from "@supabase/supabase-js";
import { BuildingIntelligenceImporter, DEFAULT_BUILDING_PRACTICE_SOURCE_KEY, DEFAULT_BUILDING_PRACTICE_SOURCE_URL } from "./importer";
import { importAlboRecords } from "./albo-importer";
import { importBitontoPlanCatalog, BITONTO_PLAN_SOURCE } from "./document-catalog";
import { PUBLIC_RECORD_POLICY as P, PRACTICES_2025,TERRITORY_PROTOCOLS,isPracticeIndexSource } from "./public-record-policy";
import { recomputeTerritorialGraph } from "./graph-recompute";
import { projectPropertyFacts } from "./facts-projection";
import {bindPrimaryFacts,csvPrimaryFacts,type PrimaryFacts} from './facts-primary';
import {reconcilePracticeDocuments} from './practice-documents';
import {readTerritoryProtocolIndex,read2025PracticeIndex} from './protocol-index';

async function due(db: SupabaseClient,key: string,hours: number) {
  const r=await db.from("building_data_import_runs").select("finished_at,diagnostics").eq("source_key",key).eq("run_kind","LIVE").eq("status","SUCCEEDED").order("finished_at",{ascending:false}).limit(1).maybeSingle();
  if(r.error)throw Error(r.error.message);
  return !r.data?.finished_at || (key!==BITONTO_PLAN_SOURCE&&r.data.diagnostics?.policyVersion!==P.version) || Date.now()-Date.parse(r.data.finished_at)>=hours*3600000;
}
async function importCsvSource(db:SupabaseClient,key:string,url:string,fetcher:typeof fetch,onFacts:(facts:PrimaryFacts[])=>void){
  let importRunId:string|undefined;
  try{
    const observedAt=new Date().toISOString();
    const run=await db.from('building_data_import_runs').insert({source_key:key,source_url:url,started_at:observedAt}).select('id').single();
    if(run.error||!run.data?.id)throw Error(run.error?.message??'Source run could not start');
    importRunId=run.data.id;
    let csv:string,etag:string|null=null,pages=1,fingerprint:string|undefined;
    if(key===TERRITORY_PROTOCOLS.key||key===PRACTICES_2025.key){
      const index=await (key===TERRITORY_PROTOCOLS.key?readTerritoryProtocolIndex(fetcher):read2025PracticeIndex(fetcher));csv=index.csv;pages=index.pages;fingerprint=index.structureFingerprint;
    }else{
      const r=await fetcher(url,{signal:AbortSignal.timeout(60000),redirect:"error"});
      if(!r.ok)throw Error(`Municipal dataset HTTP ${r.status}`);
      if(Number(r.headers.get("content-length"))>25*1024*1024)throw Error("Municipal CSV exceeds limit");
      const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.byteLength>25*1024*1024)throw Error("Municipal CSV exceeds limit");
      csv=new TextDecoder().decode(bytes);etag=r.headers.get('etag');
    }
    const practiceIndexOnly = isPracticeIndexSource(key);
    const result=await new BuildingIntelligenceImporter(db).importCsv({importRunId,observedAt,sourceKey:key,sourceUrl:url,csv,sourceEtag:etag,applicationCode:practiceIndexOnly?null:"ape"});
    // Index catalogues have no primary acts or territorial identifiers.
    // Their empty projections also clear text-only inferences from earlier runs.
    onFacts(csvPrimaryFacts(csv,key,url,new Date().toISOString()));
    const status=await db.from("building_data_import_runs").update({health_state:result.status==="SUCCEEDED"?"HEALTHY":"DEGRADED",inventory_complete:result.status==="SUCCEEDED",pages,...(fingerprint?{structure_fingerprint:fingerprint}:{}),
      diagnostics:{coverage:key===TERRITORY_PROTOCOLS.key?"Five exact territorial offices; public protocol metadata only":key===PRACTICES_2025.key?"2025 metadata only; no address/cadastral fields exposed":"2024 declared address/cadastral references",policyVersion:P.version,
        evidenceLevel:practiceIndexOnly?"PRACTICE_INDEX_ONLY":"DECLARED_PRACTICE_FIELDS",
        ...result.dataQuality,duplicateRows:result.duplicateRows,groupedRecords:result.groupedRecords,
        unmatchedRecords:result.unmatchedRecords,buildingLinks:result.buildingLinks}}).eq("id",result.importRunId);
    if(status.error)throw Error(status.error.message);
    return result;
  }catch(e){
    if(importRunId)await db.from("building_data_import_runs").update({status:"FAILED",health_state:"FAILED",inventory_complete:false,finished_at:new Date().toISOString(),errors:[String(e)]}).eq('id',importRunId);
    throw e;
  }
}
/** Existing job, independently due sources; a failed static dataset must not suppress the Albo. */
export async function syncPublicRecordSources(db:SupabaseClient,fetcher:typeof fetch=fetch){
  const results:Record<string,unknown>={},errors:string[]=[];
  const primary:PrimaryFacts[]=[];
  const sources:Array<{key:string;hours:number;run:()=>Promise<unknown>}>= [
    {key:P.alboSource,hours:P.alboIntervalHours,run:async()=>{const facts:PrimaryFacts[]=[];const result=await importAlboRecords(db,{fetcher,onPrimaryFacts:f=>facts.push(f)});primary.push(...facts);return result;}},
    {key:DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,hours:P.staticIntervalHours,run:()=>importCsvSource(db,DEFAULT_BUILDING_PRACTICE_SOURCE_KEY,DEFAULT_BUILDING_PRACTICE_SOURCE_URL,fetcher,fs=>primary.push(...fs))},
    {key:PRACTICES_2025.key,hours:P.staticIntervalHours,run:()=>importCsvSource(db,PRACTICES_2025.key,PRACTICES_2025.url,fetcher,fs=>primary.push(...fs))},
    {key:TERRITORY_PROTOCOLS.key,hours:P.staticIntervalHours,run:()=>importCsvSource(db,TERRITORY_PROTOCOLS.key,TERRITORY_PROTOCOLS.url,fetcher,fs=>primary.push(...fs))},
    {key:BITONTO_PLAN_SOURCE,hours:P.staticIntervalHours,run:()=>importBitontoPlanCatalog(db,fetcher)},
  ];
  for(const s of sources){try{results[s.key]=await due(db,s.key,s.hours)?await s.run():{skipped:"not_due"};}catch(e){errors.push(`${s.key}: ${String(e)}`);}}
  try{results.practiceDocuments=await reconcilePracticeDocuments(db,true);}catch(e){errors.push(`practiceDocuments: ${String(e)}`);}
  // Reconcile derived context even when a source is not due or another source fails.
  try{results.territorialGraph=await recomputeTerritorialGraph(db,true);}catch(e){errors.push(`territorialGraph: ${String(e)}`);}
  try{const r=await projectPropertyFacts(db,true,primary.length?await bindPrimaryFacts(db,primary):undefined);results.propertyFacts={processed:r.processed,events:r.events,review:r.review};}catch(e){errors.push(`propertyFacts: ${String(e)}`);}
  if(errors.length)throw Error(errors.join("; "));
  return results;
}
