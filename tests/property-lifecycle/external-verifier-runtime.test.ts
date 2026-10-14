import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { runExternalSourceJob } from "@/lib/property-lifecycle/external/runtime";
import type { LifecycleJob } from "@/lib/property-lifecycle/jobs/queue";
import { lifecycleRetryDelayMs } from "@/lib/property-lifecycle/jobs/queue";
import manifest from "../fixtures/property-lifecycle/external/remax/manifest.json";

const agencyId="10000000-0000-0000-0000-000000000001",propertyId="20000000-0000-0000-0000-000000000001",publicationId="30000000-0000-0000-0000-000000000001";
interface Result { data: unknown; error: null }
interface Write { table: string; operation: string; values: Record<string,unknown> }
function database(options: { source?: string; enabled?: boolean; mapping?: string[] } = {}) {
  const source=options.source ?? "REMAX",writes:Write[]=[],calls:Array<{name:string;args:Record<string,unknown>}> = [];
  const config={source_key:source,enabled:options.enabled ?? true,projections_enabled:true,inventory_roots:["https://www.wikicasa.it/vendita-case/bitonto/"],health_baseline:{}};
  class Query implements PromiseLike<Result> {
    operation="select"; values:Record<string,unknown>={};
    constructor(readonly table: string) {}
    select(){return this;} eq(){return this;} order(){return this;} range(){return this;} single(){return this;} maybeSingle(){return this;} neq(){return this;}
    update(values:Record<string,unknown>){this.operation="update";this.values=values;return this;}
    upsert(values:Record<string,unknown>){this.operation="upsert";this.values=values;return this;}
    then<T=Result,U=never>(ok?:((value:Result)=>T|PromiseLike<T>)|null,fail?:((error:unknown)=>U|PromiseLike<U>)|null):PromiseLike<T|U> {
      let data:unknown=null;
      if(this.operation!=="select") writes.push({table:this.table,operation:this.operation,values:this.values});
      else if(this.table==="market_observer_sources")data=config;
      else if(this.table==="market_observer_agency_identities")data=(options.mapping ?? []).map(id=>({agency_id:id,external_agency_id:null,normalized_name:"remax stella polare - bari via caduti del lavoro"}));
      else if(this.table==="publications")data=source==="WIKICASA" ? [] : {id:publicationId,canonical_url:manifest[0].url,external_source_key:null,agency_id:agencyId,agency_listing_id:"known"};
      else if(this.table==="agency_listings")data={property_id:propertyId};
      else if(this.table==="agencies")data={id:agencyId,slug:"known",market_role:"COMPETITOR"};
      return Promise.resolve({data,error:null}).then(ok,fail);
    }
  }
  const db={from:(table:string)=>new Query(table),rpc:async(name:string,args:Record<string,unknown>)=>{
    calls.push({name,args});return {data:name==="start_market_external_source_run" ? "source-run" : {createdProperty:false},error:null};
  }} as unknown as SupabaseClient;
  return {db,writes,calls};
}
function job(source="REMAX"):LifecycleJob { return {id:"known-job",job_type:source==="WIKICASA"?"SYNC_MARKET_SOURCE":"VERIFY_MARKET_PUBLICATION",payload:{source,publicationId},
  agency_id:null,status:"RUNNING",priority:1,attempts:1,max_attempts:3,dedupe_key:null,worker_id:"test-worker"}; }
const response=(html:string,status=200,headers:Record<string,string>={})=>new Response(html,{status,headers:{"content-type":"text/html",...headers}});
async function primaryHtml(){return readFile("tests/fixtures/property-lifecycle/external/remax/crocifisso.html","utf8");}

describe("External verifier runtime with known V2 publications",()=>{
  it("a disabled source drains the job without network or persistence",async()=>{
    const fake=database({enabled:false}),fetcher=vi.fn();
    expect(await runExternalSourceJob(fake.db,job(),fetcher)).toEqual({skipped:"source_disabled"});
    expect(fetcher).not.toHaveBeenCalled();expect(fake.calls.length).toBe(0);expect(fake.writes.length).toBe(0);
  });
  it.each([{mapping:[]},{mapping:["another-agency"]}])("retains primary evidence when agency mapping requires review: $mapping",async({mapping})=>{
    const fake=database({mapping}),fetcher=vi.fn().mockResolvedValue(response(await primaryHtml()));
    expect(await runExternalSourceJob(fake.db,job(),fetcher)).toMatchObject({state:"DEGRADED",review_count:1,absenceEvaluationAllowed:false});
    const claims=fake.calls.find(call=>call.name==="market_external_claims_atomic")!;
    expect(claims.args).toMatchObject({p_property_id:propertyId,p_publication_id:publicationId,p_source_key:"REMAX"});
    expect((claims.args.p_claims as Array<{metadata:Record<string,unknown>}>).every(claim=>claim.metadata.agencyResolution==="REVIEW_REQUIRED")).toBe(true);
    expect(fake.calls.some(call=>call.name==="persist_market_external_observation_atomic")).toBe(false);
    expect(fake.writes.some(write=>write.table==="publications")).toBe(false);
    expect(fake.writes.find(write=>write.table==="market_observer_source_runs")?.values).toMatchObject({state:"DEGRADED",inventory_complete:false,absence_evaluation_allowed:false});
  });
  it("a mapped primary verifier uses the existing relationship and central atomic ingestion",async()=>{
    const fake=database({mapping:[agencyId]});
    const result=await runExternalSourceJob(fake.db,job(),vi.fn().mockResolvedValue(response(await primaryHtml())));
    expect(result).toMatchObject({state:"HEALTHY",detail_fetch_count:1,absenceEvaluationAllowed:false});
    const persist=fake.calls.find(call=>call.name==="persist_market_external_observation_atomic")!;
    expect(persist.args.p_identity_decision).toMatchObject({propertyId,outcome:"AUTO_MATCH"});
    expect(persist.args.p_agency_id).toBe(agencyId);
  });
  it.each([404,410])("HTTP %i preserves only URL-unavailable evidence, never sale or missing",async status=>{
    const fake=database();
    expect(await runExternalSourceJob(fake.db,job(),vi.fn().mockResolvedValue(response("unavailable",status)))).toMatchObject({state:"DEGRADED"});
    const call=fake.calls.find(call=>call.name==="market_external_claims_atomic")!;
    expect(call.args.p_claims).toMatchObject([{kind:"URL_UNAVAILABLE",normalizedValue:{sold:false,inventoryAbsence:false},metadata:{currentPresence:false}}]);
    expect(fake.calls.some(call=>call.name==="persist_market_external_observation_atomic")).toBe(false);
  });
  it("a 500 with long Retry-After stops the inventory detail loop and defers to the leased queue",async()=>{
    const fake=database({source:"WIKICASA"});
    const inventory='<link rel="canonical" href="https://www.wikicasa.it/vendita-case/bitonto/"><main><p data-total-results="2"></p><article><a href="/annuncio/1">one</a></article><article><a href="/annuncio/2">two</a></article></main>';
    const fetcher=vi.fn().mockResolvedValueOnce(response(inventory)).mockResolvedValue(response("busy",500,{"retry-after":"3600"}));
    const error=await runExternalSourceJob(fake.db,job("WIKICASA"),fetcher).catch(error=>error);
    expect(error).toMatchObject({reason:"retry_after_requires_job_retry",retryAfterMs:3600000});
    expect(lifecycleRetryDelayMs(1,error)).toBe(3600000);expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fake.writes.findLast(write=>write.table==="market_observer_source_runs")?.values).toMatchObject({state:"FAILED",absence_evaluation_allowed:false});
  });
});
