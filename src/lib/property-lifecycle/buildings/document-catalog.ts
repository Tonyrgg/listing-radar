import { load } from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashValue } from "@/lib/property-lifecycle/contracts/normalized-listing";

export const BITONTO_PLAN_CATALOG="https://www.comune.bitonto.ba.it/it/page/sit-sue-e-prg";
export const BITONTO_PLAN_SOURCE="comune-bitonto-prg-catalog";
export function parseBitontoPlanCatalog(html:string) {
  const $=load(html), documents=new Map<string,{url:string;title:string;area:string}>();
  for(const a of $('a[href]').toArray()){
    const url=$(a).attr('href')??'',title=$(a).text().replace(/\s+/g,' ').trim();
    if(!url.includes('/sit-sue-e-prg/')||!url.endsWith('.pdf'))continue;
    const parsed=new URL(url);
    if(parsed.protocol!=="https:" || parsed.hostname!=="municipium-images-production.s3-eu-west-1.amazonaws.com")throw Error("Unexpected municipal document host");
    if(!title)throw Error("Missing municipal document title");
    documents.set(url,{url,title,area:/palombaio/i.test(title)?"Palombaio":/mariotto/i.test(title)?"Mariotto":"Bitonto"});
  }
  if(documents.size<18 || documents.size>40)throw Error("Municipal catalog structure/count changed");
  return [...documents.values()];
}

/** Metadata only, original URLs; no PDF download or automatic property-unit association. */
export async function importBitontoPlanCatalog(db:SupabaseClient,fetcher:typeof fetch=fetch) {
  const observedAt=new Date().toISOString();
  const run=await db.from("building_data_import_runs").insert({source_key:BITONTO_PLAN_SOURCE,source_url:BITONTO_PLAN_CATALOG,started_at:observedAt}).select("id").single();
  if(run.error)throw Error(run.error.message);
  const id=run.data.id;
  try{
    const response=await fetcher(BITONTO_PLAN_CATALOG,{signal:AbortSignal.timeout(20000),redirect:"error"});
    if(!response.ok)throw Error(`Municipal catalog HTTP ${response.status}`);
    const html=await response.text();if(Buffer.byteLength(html)>500000)throw Error("Municipal catalog too large");
    const docs=parseBitontoPlanCatalog(html),pageHash=hashValue(html);
    const prior=await db.from("building_practice_records").select("id,source_record_key,content_hash,first_seen_at").eq("source_key",BITONTO_PLAN_SOURCE);
    if(prior.error)throw Error(prior.error.message);
    const before=new Map((prior.data??[]).map(r=>[r.source_record_key,r]));
    let inserted=0,updated=0;
    for(const doc of docs){
      const key=hashValue(doc.url),payload={title:doc.title,documentUrl:doc.url,areaName:doc.area,recordType:"URBAN_PLAN",catalogType:/dpp-/i.test(doc.url)?"DPP":"PRG",documentKind:/tav-/i.test(doc.url)?"TAVOLA":"DOCUMENTO"},hash=hashValue(payload),old=before.get(key);
      const saved=await db.from("building_practice_records").upsert({source_key:BITONTO_PLAN_SOURCE,source_record_key:key,
        application_code:"public-document-catalog",intervention_type:"OTHER",title:doc.title,record_type:"URBAN_PLAN",
        source_url:BITONTO_PLAN_CATALOG,document_url:doc.url,area_name:doc.area,content_hash:hash,sanitized_payload:payload,
        first_seen_at:old?.first_seen_at??observedAt,last_seen_at:observedAt,
        metadata:{policyVersion:"municipal_catalog_v2",sourcePageHash:pageHash,catalogType:payload.catalogType,documentKind:payload.documentKind,scope:"AREA",confidence:0.95,unitMatch:"NOT_ASSERTED",dates:"NOT_DECLARED"},
      },{onConflict:"source_key,source_record_key"}).select("id").single();
      if(saved.error)throw Error(saved.error.message);
      if(!old || old.content_hash!==hash){
        const proof=await db.from("building_practice_observations").upsert({practice_record_id:saved.data.id,import_run_id:id,content_hash:hash,sanitized_payload:payload,observed_at:observedAt},{onConflict:"practice_record_id,content_hash",ignoreDuplicates:true});
        if(proof.error)throw Error(proof.error.message);
        if(old)updated++;else inserted++;
      }
    }
    const done=await db.from("building_data_import_runs").update({status:"SUCCEEDED",health_state:"HEALTHY",pages:1,inventory_complete:true,structure_fingerprint:hashValue({count:docs.length,host:"municipium-images-production.s3-eu-west-1.amazonaws.com"}),diagnostics:{metadataOnly:true,pdfDownloads:0,coverage:"Official catalog, not normative property geometry"},finished_at:new Date().toISOString(),input_rows:docs.length,eligible_rows:docs.length,grouped_records:docs.length,inserted_records:inserted,updated_records:updated}).eq("id",id);
    if(done.error)throw Error(done.error.message);
    return {count:docs.length,inserted,updated};
  }catch(e){
    await db.from("building_data_import_runs").update({status:"FAILED",finished_at:new Date().toISOString(),errors:[String(e)]}).eq("id",id);throw e;
  }
}
