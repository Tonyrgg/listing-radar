import type { SupabaseClient } from "@supabase/supabase-js";
import { hashValue } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { AlboHttp, collectAlboInventory, parseAlboDetail } from "./albo";
import { extractTerritorialReferences, extractDeclaredCadastralReferences, type RegistryStreet } from "./territorial-extraction";
import { PUBLIC_RECORD_POLICY as P, RECORD_TYPES, classifyPublicRecord, territorialSignalType } from "./public-record-policy";

export async function readRegistryStreets(db: SupabaseClient): Promise<RegistryStreet[]> {
  const rows: RegistryStreet[] = [];
  for(let from=0;;from+=500){ const r=await db.from("street_registry_streets").select("id,canonical_name,official_type,official_description,locality,geometry").eq("record_status","active").order("id").range(from,from+499); if(r.error)throw Error(r.error.message);rows.push(...r.data);if(r.data.length<500)return rows; }
}
export async function importAlboRecords(db: SupabaseClient, options: {fetcher?: typeof fetch; dryRun?: boolean; observedAt?: string; delayMs?: number} = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString(), http = new AlboHttp(options.fetcher,options.delayMs);
  let runId: string | null = null;
  if(!options.dryRun){const r=await db.from("building_data_import_runs").insert({source_key:P.alboSource,source_url:P.alboUrl,started_at:observedAt}).select("id").single();if(r.error)throw Error(r.error.message);runId=r.data.id;}
  try {
    const inventory = await collectAlboInventory(http), streets = await readRegistryStreets(db);
    if(!streets.length)throw Error("Official street registry not available; ingestion suspended");
    const prior = await db.from("building_practice_records").select("id,source_record_key,metadata,last_seen_at").eq("source_key",P.alboSource);
    if(prior.error)throw Error(prior.error.message);
    const before = new Map((prior.data??[]).map(r=>[r.source_record_key,r])), records = [], unchanged: string[] = [];
    let details = 0, skipped = 0;
    for (const item of inventory.items) {
      const refs = extractTerritorialReferences(item.subject,streets), classification = classifyPublicRecord(item.subject,item.category);
      const strongType = !["OTHER","ORDINANZA","DELIBERA","DETERMINA"].includes(classification.type);
      if(!refs.length && !strongType){skipped++;continue;}
      const old=before.get(item.id), lastDetail=old?.metadata?.detailObservedAt;
      if(old?.metadata?.inventoryMarker===item.marker && old.metadata?.policyVersion===P.version && lastDetail && Date.parse(observedAt)-Date.parse(lastDetail)<P.deepRotationDays*86400000){unchanged.push(old.id);continue;}
      const detail = parseAlboDetail(await http.get(item.url),item.id); details++;
      const territories=extractTerritorialReferences(detail.subject,streets), type=classifyPublicRecord(detail.subject,item.category);
      const addresses=territories.flatMap(r=>r.civics.map((n,i)=>({displayName:`${r.streetName} ${n}, ${r.locality}`,streetName:r.streetName,streetNumber:n,locality:r.locality,normalizedKey:r.normalizedKeys[i]})).filter(a=>a.normalizedKey));
      const area=/\bMARIOTTO\b/i.test(detail.subject)?"Mariotto":/\bPALOMBAIO\b/i.test(detail.subject)?"Palombaio":territories.length?null:"Bitonto";
      // Generated from administrative fields + recognized streets only. Never store person/company names from free text.
      const title=`${RECORD_TYPES[type.type]} · ${item.act}${territories.length?` · ${[...new Set(territories.map(r=>r.streetName+(r.civicText?` ${r.civicText}`:"")))].join("; ")}`:area?` · ${area}`:""}`;
      const subject=RECORD_TYPES[type.type]+(territories.length?" riferito ai luoghi dichiarati nell’atto.":" con contesto comunale; localizzazione puntuale non verificata.");
      const payload={title,subject,addresses,cadastralReferences:extractDeclaredCadastralReferences(detail.subject),territorialReferences:territories,sourceStatus:detail.status,
        originalMetadataHash:hashValue({item,detail}),documentUrls:detail.documents,documentDate:detail.documentDate,actDate:detail.actDate,
        publicationStart:detail.start??item.start,publicationEnd:detail.end??item.end,office:detail.office,
        classification:type,unitMatch:"REVIEW_REQUIRED"};
      records.push({sourceRecordKey:item.id,title,subject,recordType:type.type,practiceNumber:item.act,year:item.act.match(/^\d{4}/)?.[0]??null,
        sourceUrl:item.url,documentUrl:detail.documents[0]??null,documentUrls:detail.documents,documentDate:detail.documentDate,
        publicationStart:detail.start??item.start,publicationEnd:detail.end??item.end,office:detail.office,sourceStatus:detail.status,
        areaName:area,classificationConfidence:type.confidence,classificationVersion:type.version,signalType:territorialSignalType(type.type),
        territorialReferences:territories,sanitizedPayload:payload,contentHash:hashValue(payload),
        metadata:{policyVersion:P.version,inventoryMarker:item.marker,detailObservedAt:observedAt,originalTitleNotStored:true,pdfDownloaded:false,
          precision:addresses.length?"BUILDING":territories.length?"STREET":"ZONE",unitMatch:"REVIEW_REQUIRED",cadastralIdentity:"NOT_ASSERTED"}});
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
