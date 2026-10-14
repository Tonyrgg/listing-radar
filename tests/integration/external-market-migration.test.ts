import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { historicalEvidence, normalizeExternalFacts, parseExternalHtml, type ExternalFacts } from "@/lib/property-lifecycle/external/adapters";
import real from "../fixtures/property-lifecycle/external/real-retrieval-facts.json";
import remax from "../fixtures/property-lifecycle/external/remax/manifest.json";

describe.sequential("External evidence migrations on actual PostgreSQL", () => {
  let db: PGlite; let agency: string;
  const base = real.facts[0] as ExternalFacts;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key); create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;`);
    for (const file of ["0001_production_schema.sql","0010_acquisition_os.sql","0014_market_observer_reliability.sql",
      "0015_market_observer_intelligence.sql","0016_market_observer_private_projection.sql","0017_resource_compaction.sql",
      "0018_compaction_index_headroom.sql","0019_bounded_identity_fingerprints.sql","0020_fingerprint_update_uniqueness.sql",
      "0021_market_observer_read_indexes.sql","0022_market_observer_semantics.sql","0023_market_observer_projections.sql",
      "0024_external_market_evidence.sql","0025_external_market_projections.sql","0026_external_market_primary_verifier.sql"]) {
      await db.exec((await readFile(`supabase/migrations/${file}`,"utf8")).replace(/create extension if not exists pgcrypto;/g,""));
    }
  }, 30_000);
  afterAll(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.exec("begin");
    agency=(await db.query<{id:string}>(`insert into agencies(slug,name,adapter_key,website_url,inventory_url,market_role)
      values('external-test','External test','external-test','https://agency.test','https://agency.test/inventory','COMPETITOR') returning id`)).rows[0].id;
    await db.exec("update market_observer_sources set enabled=true,projections_enabled=true where source_key in ('WIKICASA','IMMOBILIARE','SEARCH_INDEX')");
  });
  afterEach(async()=>{await db.exec("rollback");});
  async function row(sql:string,params:unknown[]=[]){return (await db.query<Record<string,unknown>>(sql,params)).rows[0];}
  async function observe(overrides:Partial<ExternalFacts>={},propertyId?:string,agencyId=agency){
    const o=normalizeExternalFacts({...base,method:"PRIMARY_HTTP",...overrides});
    const decision=propertyId?{outcome:"AUTO_MATCH",propertyId,score:1,candidates:[]}:{outcome:"NEW_PROPERTY",score:0,candidates:[]};
    return (await row("select persist_market_external_observation_atomic($1,$2,$3,$4,$5,'stable','[]') result",[
      o.source,agencyId,JSON.stringify(o.listing),JSON.stringify(decision),JSON.stringify(o.claims)])).result as {
        propertyId:string;publicationId:string;agencyListingId:string;snapshotId:string;syncRunId:string;createdProperty:boolean};
  }
  it("starts with feature flags off, missing prohibited, and no backfilled agency role",async()=>{
    expect(await row("select enabled,projections_enabled,missing_enabled from market_observer_sources where source_key='CASA'"))
      .toEqual({enabled:false,projections_enabled:false,missing_enabled:false});
    expect((await row("select count(*)::integer n from market_observer_agency_identities")).n).toBe(0);
  });
  it("RE/MAX is a disabled targeted source with no inventory and no missing permission",async()=>{
    expect(await row("select enabled,projections_enabled,missing_enabled,inventory_roots from market_observer_sources where source_key='REMAX'"))
      .toEqual({enabled:false,projections_enabled:false,missing_enabled:false,inventory_roots:[]});
  });
  it("primary RE/MAX evidence enriches an existing Wikicasa property without inventing an acquisition date or relisting",async()=>{
    const first=await observe();
    await db.exec("update market_observer_sources set enabled=true,projections_enabled=true where source_key='REMAX'");
    const o=parseExternalHtml("REMAX",await readFile("tests/fixtures/property-lifecycle/external/remax/crocifisso.html","utf8"),remax[0].url,remax[0].observedAt);
    const result=(await row("select persist_market_external_observation_atomic('REMAX',$1,$2,$3,$4) result",[
      agency,JSON.stringify(o.listing),JSON.stringify({outcome:"AUTO_MATCH",propertyId:first.propertyId,score:1,candidates:[]}),JSON.stringify(o.claims)])).result as {propertyId:string};
    expect(result.propertyId).toBe(first.propertyId);
    expect((await row("select count(*)::integer n from properties")).n).toBe(1);
    expect((await row("select count(*)::integer n from publications")).n).toBe(2);
    expect((await row("select count(*)::integer n from events where event_type in ('PUBLICATION_RELAUNCHED','PRICE_DROP')")).n).toBe(0);
    expect((await row("select estimated_acquisition_at from agency_listings")).estimated_acquisition_at).toBeNull();
    expect((await row("select agent_name from market_observer_intelligence")).agent_name).toBe("Nicola Sicolo");
    await db.query("update agency_listings set state='EXIT_PENDING' where id=$1",[first.agencyListingId]);
    expect((await row("select payload->>'source' source from lifecycle_jobs where job_type='VERIFY_MARKET_PUBLICATION'")).source).toBe("REMAX");
  });
  it("creates only a V2 property and evidence while preserving first_seen and null acquisition",async()=>{
    const first=await observe();
    expect(await row("select first_seen_at,estimated_acquisition_at from agency_listings where id=$1",[first.agencyListingId]))
      .toMatchObject({estimated_acquisition_at:null});
    expect((await row("select count(*)::integer n from properties")).n).toBe(1);
    expect((await row("select earliest_market_evidence_at::text d from market_observer_intelligence")).d).toContain("2026-05-05");
  });
  it("unchanged rerun updates seen without a duplicate snapshot or previous-price claim",async()=>{
    const first=await observe(); const second=await observe({observedAt:"2026-10-15T20:32:28.000Z"});
    expect(second.snapshotId).toBe(first.snapshotId);
    expect((await row("select count(*)::integer n from snapshots")).n).toBe(1);
    expect((await row("select count(*)::integer n from evidence where claim_key='publication.previousAskingPrice'")).n).toBe(1);
    expect((await row("select last_seen_at::text at from publications")).at).toContain("2026-10-15");
  });
  it("parallel Wikicasa and Immobiliare use the same property and do not create a relisting or cross-source drop",async()=>{
    const first=await observe(); const second=await observe({...real.facts[1],method:"PRIMARY_HTTP"} as ExternalFacts,first.propertyId);
    expect(second.propertyId).toBe(first.propertyId);
    expect((await row("select count(*)::integer n from publications")).n).toBe(2);
    expect((await row("select count(*)::integer n from events where event_type in ('PUBLICATION_RELAUNCHED','PRICE_DROP')")).n).toBe(0);
    expect((await row("select source_price_conflict from market_observer_intelligence limit 1")).source_price_conflict).toBe(true);
  });
  it("same-publication price change creates a true price drop",async()=>{
    await observe(); await observe({price:155000,observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select count(*)::integer n from events where event_type='PRICE_DROP'")).n).toBe(1);
  });
  it("portal refresh does not create a price drop",async()=>{
    await observe(); await observe({modifiedLabel:"15/10/2026",observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select count(*)::integer n from events where event_type='PRICE_DROP'")).n).toBe(0);
  });
  it("observation-only flag stores evidence but excludes it from earliest dates and sold classification",async()=>{
    await db.exec("update market_observer_sources set projections_enabled=false where source_key='WIKICASA'");
    await observe({statusLabel:"Venduto"});
    expect((await row("select sale_status from properties")).sale_status).toBe("UNKNOWN");
    expect((await row("select earliest_market_evidence_at::text d from market_observer_intelligence")).d).toContain("2026-10-14");
    expect((await row("select count(*)::integer n from evidence where evidence_kind='SOLD_EXPLICIT'")).n).toBe(1);
  });
  it("enabling projections on next detail interprets the existing evidence without a second property",async()=>{
    await db.exec("update market_observer_sources set projections_enabled=false where source_key='WIKICASA'");
    await observe(); await db.exec("update market_observer_sources set projections_enabled=true where source_key='WIKICASA'");
    await observe({observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select count(*)::integer n from properties")).n).toBe(1);
    expect((await row("select earliest_market_evidence_at::text d from market_observer_intelligence")).d).toContain("2026-05-05");
  });
  it("a light positive inventory fact advances seen but not detail/price dates",async()=>{
    const first=await observe();
    await db.query("select confirm_market_external_presence_atomic('WIKICASA','29812570','stable','2026-10-15T20:32:28Z')");
    expect((await row("select count(*)::integer n from snapshots")).n).toBe(1);
    const dates=await row("select last_seen_at::text seen,external_detail_at::text detail from publications where id=$1",[first.publicationId]);
    expect(Date.parse(String(dates.seen))).toBe(Date.parse("2026-10-15T20:32:28Z"));
    expect(Date.parse(String(dates.detail))).toBe(Date.parse("2026-10-14T20:32:28Z"));
  });
  it("direct primary explicit sold with date contributes sale evidence and actual sold_at",async()=>{
    await observe({...real.facts[6],method:"PRIMARY_HTTP"} as ExternalFacts);
    expect((await row("select sale_status from properties")).sale_status).toBe("SOLD_CONFIRMED");
    expect((await row("select sold_at::text d from market_observer_intelligence")).d).toContain("2025-02-12");
  });
  it("explicit sold without date never becomes a guessed sale date",async()=>{
    await observe({statusLabel:"Venduto"});
    expect(await row("select sold_at from market_observer_intelligence")).toEqual({sold_at:null});
    expect((await row("select sale_status from properties")).sale_status).toBe("SOLD_CONFIRMED");
  });
  it("active on another publication turns conflicting sold evidence into a reviewable probable sale",async()=>{
    const first=await observe(); await observe({...real.facts[1],method:"PRIMARY_HTTP",statusLabel:"Venduto"} as ExternalFacts,first.propertyId);
    expect((await row("select sale_status from properties")).sale_status).toBe("PROBABLE_SOLD");
    expect((await row("select state from agency_listings")).state).toBe("ACTIVE");
  });
  it("index retrieval cannot assert a live publication",async()=>{
    await expect(observe({method:"INDEX_CAPTURE"})).rejects.toThrow("Only direct primary");
  });
  it("older historical evidence improves market age with provenance and keeps conflicting dates",async()=>{
    const first=await observe();
    const c=historicalEvidence({sourceUrl:base.url,captureUrl:"https://archive.example/capture/1",observedAt:base.observedAt,
      claimedDate:"28/04/2026",rawClaim:"Data pubblica 28/04/2026"});
    await db.query("select market_external_claims_atomic($1,$2,null,'SEARCH_INDEX',$3,$4)",[first.propertyId,first.publicationId,JSON.stringify([c]),base.observedAt]);
    await db.query("select refresh_property_lifecycle_intelligence_atomic($1,$2)",[first.propertyId,base.observedAt]);
    const projection=await row("select earliest_market_evidence_at::text d,market_evidence_provenance,publication_date_disagreement from market_observer_intelligence");
    expect(projection.d).toContain("2026-04-28");
    expect(projection.market_evidence_provenance).toMatchObject({source:"SEARCH_INDEX",confidence:0.65});
    expect(projection.publication_date_disagreement).toBe(true);
    expect((await row("select latest_snapshot->>'earliest_market_evidence_at' d from lifecycle_property_hydration(array[$1]::uuid[])",[first.propertyId])).d).toContain("2026-04-28");
  });
  it("previous asking retains unknown price change date in the read model",async()=>{
    await observe();
    expect(await row("select amount,current_amount,change_date,date_precision from market_observer_external_price_evidence where claim_key='publication.previousAskingPrice'"))
      .toEqual({amount:225000,current_amount:195000,change_date:null,date_precision:"UNKNOWN"});
  });
  it("our agency stays in intelligence but cannot generate a competitor acquisition lead",async()=>{
    await db.query("update agencies set market_role='OUR_AGENCY' where id=$1",[agency]);
    const first=await observe();
    expect((await row("select agency_role from market_observer_intelligence")).agency_role).toBe("OUR_AGENCY");
    expect((await row("select score::float,level from opportunities"))).toEqual({score:0,level:"NONE"});
    const opportunity=(await row("select id from opportunities where property_id=$1",[first.propertyId])).id;
    await expect(db.query("select acquisition_link_market_opportunity($1,null)",[opportunity])).rejects.toThrow("No current acquisition opportunity");
  });
  it("retains human sale override despite contradictory external sold claims",async()=>{
    const first=await observe();
    await db.query(`insert into manual_overrides(target_type,target_id,override_key,override_value,reason,source,effective_at)
      values('PROPERTY',$1,'sale_status','"NOT_SOLD_CONFIRMED"','Verificato','USER','2026-10-14T21:00:00Z')`,[first.propertyId]);
    await observe({statusLabel:"Venduto",observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select sale_status from properties")).sale_status).toBe("NOT_SOLD_CONFIRMED");
  });
  it("targeted exit verifier is enqueued only for an enabled source and a known URL",async()=>{
    const first=await observe({...real.facts[1],method:"PRIMARY_HTTP"} as ExternalFacts);
    await db.query("update agency_listings set state='EXIT_PENDING' where id=$1",[first.agencyListingId]);
    expect((await row("select count(*)::integer n from lifecycle_jobs where job_type='VERIFY_MARKET_PUBLICATION'")).n).toBe(1);
    await db.exec("update market_observer_sources set enabled=false where source_key='IMMOBILIARE'");
    await db.query("update agency_listings set state='OFF_MARKET_NO_SALE_EVIDENCE' where id=$1",[first.agencyListingId]);
    expect((await row("select count(*)::integer n from lifecycle_jobs where job_type='VERIFY_MARKET_PUBLICATION'")).n).toBe(1);
  });
  it("agency identity is one-to-one and owned mappings cannot silently merge",async()=>{
    await db.query("insert into market_observer_agency_identities(source_key,external_agency_id,agency_id) values('WIKICASA','123',$1)",[agency]);
    await expect(db.query("insert into market_observer_agency_identities(source_key,external_agency_id,agency_id) values('WIKICASA','123',$1)",[agency])).rejects.toThrow();
  });
  it("prevents external missing even when the legacy agency inventory has the same host",async()=>{
    const first=await observe();
    await db.query("update agencies set inventory_url='https://www.wikicasa.it/vendita-case/bitonto/' where id=$1",[agency]);
    const sync=(await row(`insert into sync_runs(agency_id,adapter_key,status,health_state,inventory_complete,absence_evaluation_allowed,
      started_at,finished_at,inventory_observed_keys) values($1,'external-test','SUCCEEDED','HEALTHY',true,true,'2026-10-16','2026-10-16','{}') returning id`,[agency])).id;
    await db.query("insert into adapter_health(agency_id,sync_run_id,state,diagnostics) values($1,$2,'HEALTHY','{\"sourceComplete\":true,\"baselineReady\":true}')",[agency,sync]);
    await db.query("select apply_missing_observations_atomic($1,$2,'{}','2026-10-16')",[agency,sync]);
    expect((await row("select state from publications where id=$1",[first.publicationId])).state).toBe("ACTIVE");
  });
  it("same portal ID moving agency requires review, not an aggressive merge",async()=>{
    await observe();
    const other=(await row("insert into agencies(slug,name,adapter_key,website_url,inventory_url) values('other','Other','other','https://other.test','https://other.test') returning id")).id as string;
    await expect(observe({observedAt:"2026-10-15T20:32:28.000Z"},undefined,other)).rejects.toThrow("agency change requires review");
  });
  it("published claim plus stable asking never infers an acquisition date",async()=>{
    await observe({previousPrice:null});
    expect((await row("select first_asking_price,latest_asking_price,drop_count,estimated_acquisition_at from market_observer_intelligence")))
      .toEqual({first_asking_price:195000,latest_asking_price:195000,drop_count:0,estimated_acquisition_at:null});
  });
  it("prepares essential agency metrics without equating asking with sale price",async()=>{
    await observe();
    expect(await row("select active_listings::integer,stale_listing_count::integer,sold_observed::integer from market_observer_agency_intelligence where agency_id=$1",[agency]))
      .toEqual({active_listings:1,stale_listing_count:0,sold_observed:0});
  });
  it("requires a real queue lease and serializes jobs for one source",async()=>{
    const a=(await row("insert into lifecycle_jobs(job_type,status,lease_expires_at) values('SYNC_MARKET_SOURCE','RUNNING',now()+interval '5 minutes') returning id")).id;
    const b=(await row("insert into lifecycle_jobs(job_type,status,lease_expires_at) values('VERIFY_MARKET_PUBLICATION','RUNNING',now()+interval '5 minutes') returning id")).id;
    await db.query("select start_market_external_source_run('WIKICASA',$1)",[a]);
    await expect(db.query("select start_market_external_source_run('WIKICASA',$1)",[b])).rejects.toThrow("EXTERNAL_SOURCE_BUSY");
  });
  it("explicit URL unavailability is evidence only, never missing or sold",async()=>{
    await observe();await observe({statusLabel:"Non disponibile",observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select state,missing_healthy_run_count from publications"))).toEqual({state:"ACTIVE",missing_healthy_run_count:0});
    expect((await row("select count(*)::integer n from snapshots")).n).toBe(1);
    expect((await row("select sale_status from properties")).sale_status).toBe("UNKNOWN");
  });
  it("known initial previous asking retains a NULL date rather than insert/observed time",async()=>{
    await observe();
    expect(await row("select earliest_known_asking,earliest_known_asking_at from market_observer_intelligence"))
      .toEqual({earliest_known_asking:225000,earliest_known_asking_at:null});
  });
  it("a sale predating monitoring has no measurable observed DOM",async()=>{
    await observe({...real.facts[6],method:"PRIMARY_HTTP"} as ExternalFacts);
    expect((await row("select observed_dom from market_observer_intelligence")).observed_dom).toBeNull();
  });
  it("repeated sold observation keeps one snapshot and one evidence fact",async()=>{
    await observe({statusLabel:"Venduto"});await observe({statusLabel:"Venduto",observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select count(*)::integer n from snapshots")).n).toBe(1);
    expect((await row("select count(*)::integer n from evidence where claim_key='publication.externalStatus'")).n).toBe(1);
  });
  it("external market opportunity links Acquisition OS idempotently with evidence and version",async()=>{
    const first=await observe(); const op=(await row("select id from opportunities where property_id=$1",[first.propertyId])).id;
    const a=await row("select acquisition_link_market_opportunity($1,null) lead",[op]);
    const b=await row("select acquisition_link_market_opportunity($1,null) lead",[op]);
    expect(a.lead).toBe(b.lead);
    expect((await row("select count(*)::integer n from acquisition_leads")).n).toBe(1);
    expect((await row("select count(*)::integer n from acquisition_signals")).n).toBe(1);
    expect((await row("select count(*)::integer n from acquisition_activities")).n).toBe(1);
    expect((await row("select details from acquisition_signals")).details).toMatchObject({engine:"MARKET_OBSERVER",scoreVersion:"external_market_evidence_v1",sourceAgencyId:agency});
  });
  it("cannot enable portal missing through an accidental feature flag update",async()=>{
    await expect(db.exec("update market_observer_sources set missing_enabled=true where source_key='WIKICASA'")).rejects.toThrow();
  });
  it("authenticated UI cannot write external observations via the service RPC",async()=>{
    await db.exec("set local role authenticated");
    await expect(db.query("select persist_market_external_observation_atomic('WIKICASA',$1,'{}','{}','[]')",[agency]))
      .rejects.toThrow("permission denied");
  });
  it("targeted enrichment preserves inventory ownership of an existing primary publication",async()=>{
    await db.query("update agencies set inventory_url='https://www.wikicasa.it/vendita-case/bitonto/' where id=$1",[agency]);
    const listing=normalizeExternalFacts({...base,method:"PRIMARY_HTTP"}).listing;
    const sync=(await row("insert into sync_runs(agency_id,adapter_key,started_at) values($1,'external-test',$2) returning id",[agency,base.observedAt])).id;
    await db.query("select persist_property_lifecycle_observation_atomic($1,$2,$3,$4,'[]','location',null,null,null)",[
      agency,sync,JSON.stringify(listing),JSON.stringify({outcome:"NEW_PROPERTY",score:0,candidates:[]})]);
    await observe({observedAt:"2026-10-15T20:32:28.000Z"});
    expect((await row("select count(*)::integer n from publications")).n).toBe(1);
    expect((await row("select external_source_key from publications")).external_source_key).toBeNull();
  });
});
