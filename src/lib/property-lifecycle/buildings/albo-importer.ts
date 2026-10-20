import type { SupabaseClient } from "@supabase/supabase-js";
import {prepareAlboRecord} from "./albo-record";
import { AlboHttp, collectAlboInventory, parseAlboDetail } from "./albo";
import { extractTerritorialReferences, type RegistryStreet } from "./territorial-extraction";
import { PUBLIC_RECORD_POLICY as P, classifyPublicRecord } from "./public-record-policy";
import {extractPropertyFacts} from './property-facts';
import {hashValue} from '../contracts/normalized-listing';
import type {PrimaryFacts} from './facts-primary';

export async function readRegistryStreets(db: SupabaseClient): Promise<RegistryStreet[]> {
  const rows: RegistryStreet[] = [];
  for(let from=0;;from+=500){ const r=await db.from("street_registry_streets").select("id,canonical_name,official_type,official_description,locality,geometry").eq("record_status","active").order("id").range(from,from+499); if(r.error)throw Error(r.error.message);rows.push(...r.data);if(r.data.length<500)return rows; }
}
export async function importAlboRecords(db: SupabaseClient, options: {fetcher?: typeof fetch; dryRun?: boolean; observedAt?: string; delayMs?: number;onPrimaryFacts?:(facts:PrimaryFacts)=>void} = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString(), http = new AlboHttp(options.fetcher,options.delayMs);
  let runId: string | null = null;
  if(!options.dryRun){const r=await db.from("building_data_import_runs").insert({source_key:P.alboSource,source_url:P.alboUrl,started_at:observedAt}).select("id").single();if(r.error)throw Error(r.error.message);runId=r.data.id;}
  try {
    const inventory = await collectAlboInventory(http), streets = await readRegistryStreets(db);
    if(!streets.length)throw Error("Official street registry not available; ingestion suspended");
    const before = new Map<string,{id:string;metadata:Record<string,string>}>(), records = [], unchanged: string[] = [];
    for(let from=0;;from+=500){const prior=await db.from("building_practice_records").select("id,source_record_key,metadata").eq("source_key",P.alboSource).order("id").range(from,from+499);if(prior.error)throw Error(prior.error.message);prior.data.forEach(r=>before.set(r.source_record_key,r));if(prior.data.length<500)break;}
    let details = 0, skipped = 0;
    for (const item of inventory.items) {
      const refs = extractTerritorialReferences(item.subject,streets), classification = classifyPublicRecord(item.subject,item.category);
      const strongType = !["OTHER","ORDINANZA","DELIBERA","DETERMINA"].includes(classification.type);
      if(!refs.length && !strongType){skipped++;continue;}
      const old=before.get(item.id), lastDetail=old?.metadata?.detailObservedAt;
      if(old?.metadata?.inventoryMarker===item.marker && old.metadata?.policyVersion===P.version && lastDetail && Date.parse(observedAt)-Date.parse(lastDetail)<P.deepRotationDays*86400000){unchanged.push(old.id);continue;}
      const detail = parseAlboDetail(await http.get(item.url),item.id); details++;
      options.onPrimaryFacts?.({sourceKey:P.alboSource,sourceRecordKey:item.id,events:extractPropertyFacts(item.id,{text:detail.subject,field:'albo.subject',sourceUrl:item.url,sourceHash:hashValue(detail),observedAt,territorialScopeVerified:extractTerritorialReferences(detail.subject,streets).length>0},detail.documentDate??detail.actDate??item.start)});
      records.push(prepareAlboRecord(item,detail,streets,observedAt));
    }
    let inserted=0,updated=0,links=0;
    if(!options.dryRun){
      for(let i=0;i<records.length;i+=100){const r=await db.rpc("persist_public_records_atomic",{p_run_id:runId,p_source_key:P.alboSource,p_observed_at:observedAt,p_records:records.slice(i,i+100)});if(r.error)throw Error(r.error.message);inserted+=r.data.inserted;updated+=r.data.updated;links+=r.data.links;}
      if(unchanged.length){const r=await db.from("building_practice_records").update({last_seen_at:observedAt}).eq("source_key",P.alboSource).in("id",unchanged);if(r.error)throw Error(r.error.message);}
      const r=await db.from("building_data_import_runs").update({status:"SUCCEEDED",health_state:"HEALTHY",finished_at:new Date().toISOString(),pages:inventory.pages,inventory_complete:true,structure_fingerprint:inventory.fingerprint,
        input_rows:inventory.total,eligible_rows:records.length+unchanged.length,grouped_records:records.length+unchanged.length,inserted_records:inserted,updated_records:updated,building_links:links,
        diagnostics:{detailFetches:details,skippedNonTerritorial:skipped,metadataOnly:true,policyVersion:P.version,removedRecordsNotInferred:true}}).eq("id",runId);if(r.error)throw Error(r.error.message);
    }
    return {runId,dryRun:!!options.dryRun,pages:inventory.pages,inventory:inventory.total,eligible:records.length+unchanged.length,detailFetches:details,skipped,inserted,updated,links,unchanged:unchanged.length,preview:options.dryRun?records:undefined};
  } catch(error) {
    if(runId)await db.from("building_data_import_runs").update({status:"FAILED",health_state:"FAILED",inventory_complete:false,finished_at:new Date().toISOString(),errors:[String(error)]}).eq("id",runId);
    throw error;
  }
}
