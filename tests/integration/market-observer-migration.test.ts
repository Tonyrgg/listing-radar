import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeIconacasaDetail } from "@/lib/property-lifecycle/adapters/iconacasa";
import { rehashNormalizedListing, type NormalizedListingV2 } from "@/lib/property-lifecycle/contracts/normalized-listing";

// Execute actual consolidated schema and migrations on PostgreSQL, without Docker or production credentials.
describe.sequential("Market Observer migrations and atomic lifecycle", () => {
  let db: PGlite;
  let agency: string;
  let template: NormalizedListingV2;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql immutable as $$
        select sha256(convert_to($1,'UTF8')) $$;`);
    for (const file of ["0001_production_schema.sql", "0010_acquisition_os.sql", "0014_market_observer_reliability.sql", "0015_market_observer_intelligence.sql", "0016_market_observer_private_projection.sql", "0017_resource_compaction.sql", "0018_compaction_index_headroom.sql", "0019_bounded_identity_fingerprints.sql", "0020_fingerprint_update_uniqueness.sql", "0021_market_observer_read_indexes.sql", "0022_market_observer_semantics.sql", "0023_market_observer_projections.sql", "0024_external_market_evidence.sql", "0025_external_market_projections.sql", "0026_external_market_primary_verifier.sql"]) {
      const sql = await readFile(`supabase/migrations/${file}`, "utf8");
      await db.exec(sql.replace(/create extension if not exists pgcrypto;/g, ""));
    }
    const html = await readFile("tests/fixtures/property-lifecycle/iconacasa-active-detail.html", "utf8");
    template = normalizeIconacasaDetail({
      item: { sourceKey: "one", externalId: "one", url: "https://www.iconacasa.com/property/45212-bitonto", summary: {} },
      observedAt: "2026-09-01T12:00:00.000Z",
      response: { body: html, headers: new Headers(), ok: true, status: 200, url: "https://www.iconacasa.com/property/45212-bitonto" },
    });
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    const row = await db.query<{ id: string }>(`insert into agencies(slug,name,adapter_key,website_url,inventory_url)
      values('test-agency','Test Agency','test','https://agency.test','https://agency.test/inventory') returning id`);
    agency = row.rows[0].id;
  });
  afterEach(async () => { await db.exec("rollback"); });

  async function run(at: string, healthy = true) {
    const r = await db.query<{ id: string }>(`insert into sync_runs(agency_id,adapter_key,started_at)
      values($1,'test',$2) returning id`, [agency, at]);
    const id = r.rows[0].id;
    await db.query(`insert into adapter_health(agency_id,sync_run_id,state,checked_at,diagnostics)
      values($1,$2,$3,$4,'{"sourceComplete":true,"baselineReady":true}')`, [agency,id,healthy ? "HEALTHY" : "FAILED",at]);
    return id;
  }
  async function observe(options: { at?: string; key?: string; price?: number; host?: string; status?: "SOLD"|"ACTIVE"|"UNKNOWN"|"REMOVED"|"NEGOTIATION"; confidence?:number; propertyId?: string; published?: string; modified?: string; soldAt?:string; decision?: Record<string,unknown> } = {}) {
    const at = options.at ?? "2026-09-01T12:00:00.000Z";
    const key = options.key ?? "one";
    const listing = rehashNormalizedListing(template, (input) => ({ ...input, observedAt: at,
      source: { ...input.source, sourceKey: key, externalId: key, canonicalUrl: `https://${options.host ?? "agency.test"}/property/${key}`,
        portalPublishedAt: options.published ?? null, portalModifiedAt: options.modified ?? null, soldAt:options.soldAt??null },
      commercial: { ...input.commercial, priceAmount: options.price ?? 150000 },
      status: { ...input.status, value: options.status ?? "ACTIVE", confidence: options.confidence ?? 1 },
    }));
    const sync = await run(at);
    const identity = options.propertyId ? { outcome: "AUTO_MATCH", propertyId: options.propertyId, score: 1, candidates: [] }
      : { outcome: "NEW_PROPERTY", score: 0, candidates: [] };
    const result = await db.query<{ result: { propertyId: string; publicationId: string; agencyListingId: string; snapshotId: string } }>(
      `select persist_property_lifecycle_observation_atomic($1,$2,$3::jsonb,$4::jsonb,'[]','location',null,null,null) result`,
      [agency,sync,JSON.stringify(listing),JSON.stringify(options.decision ?? identity)]);
    return { ...result.rows[0].result, sync, listing };
  }
  async function scalar(sql: string, params: unknown[] = []) { return (await db.query<Record<string, unknown>>(sql,params)).rows[0]; }
  async function miss(at: string, keys: string[] = [], healthy = true) {
    const sync=await run(at,healthy);
    await db.query("update sync_runs set status=$2,health_state=$3,inventory_complete=$4,absence_evaluation_allowed=$4,inventory_observed_keys=$5,finished_at=$6 where id=$1",
      [sync,healthy?'SUCCEEDED':'FAILED',healthy?'HEALTHY':'FAILED',healthy,keys,at]);
    await db.query("select apply_missing_observations_atomic($1,$2,$3,$4)",[agency,sync,keys,at]);
    return sync;
  }

  it.each([
    ["CLOSED_TO_PRIVATE", "HOT", 100],
    ["OFF_MARKET_NO_SALE_EVIDENCE", "HIGH", 85],
    ["EXIT_PENDING", "INTERESTING", 50],
    ["CLOSED_SWITCHED", "INTERESTING", 55],
  ])("scores %s with the central SQL rules", async (state, level, score) => {
    expect((await scalar("select market_observer_assess_opportunity('UNKNOWN',$1,null,0,0,0) assessment",[state])).assessment)
      .toMatchObject({level,score});
  });
  it("suppresses confirmed sales and does not invent an exit without agency history", async () => {
    expect((await scalar("select market_observer_assess_opportunity('SOLD_CONFIRMED','CLOSED_SOLD',500,4,3,30) assessment")).assessment)
      .toMatchObject({score:0,level:"NONE",reasons:["sold_confirmed"]});
    expect((await scalar("select market_observer_assess_opportunity('UNKNOWN',null,null,0,0,0) assessment")).assessment)
      .toMatchObject({score:0,level:"NONE",reasons:["no_current_opportunity_signal"]});
    expect((await scalar("select market_observer_assess_opportunity('UNKNOWN',null,180,2,1,0) assessment")).assessment)
      .toMatchObject({score:40,components:{observed_age:25,price_drops:10,relistings:5}});
  });
  it("uses configured weights without changing code and clamps the opportunity score", async () => {
    await db.exec(`update market_observer_config set weights=weights||'{"age":60,"dropEach":20,"dropCap":60}'::jsonb`);
    expect((await scalar("select market_observer_assess_opportunity('UNKNOWN','ACTIVE',180,2,1,0) assessment")).assessment)
      .toMatchObject({score:100,components:{observed_age:60,price_drops:40,relistings:5}});
  });
  it("preserves mirrored price histories without multiplying opportunity score", async () => {
    const first=await observe();
    await observe({key:"mirror",host:"portal.test",propertyId:first.propertyId});
    await observe({at:"2026-09-02T12:00:00.000Z",price:135000});
    await observe({at:"2026-09-02T12:00:00.000Z",key:"mirror",host:"portal.test",propertyId:first.propertyId,price:135000});
    expect((await scalar("select count(*)::integer n from events where event_type='PRICE_DROP'")).n).toBe(2);
    expect((await scalar("select evidence_summary->>'priceDropCount' drops from opportunities where property_id=$1",[first.propertyId])).drops).toBe("1");
  });
  it("creates a new property/publication with evidence, then records unchanged positive observations without duplicate versions", async () => {
    const first=await observe();
    const second=await observe({at:"2026-09-02T12:00:00.000Z"});
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(await scalar("select count(*)::integer n from snapshots")).toEqual({n:1});
    expect(await scalar("select count(*)::integer n from publication_observation_receipts")).toEqual({n:2});
    expect((await scalar("select last_seen_at::text t from publications")).t).toContain("2026-09-02");
    expect((await scalar("select count(*)::integer n from evidence")).n).toBeGreaterThan(0);
  });
  it("deduplicates replay of an unchanged observation in the same run", async () => {
    await observe();
    const second=await observe({at:"2026-09-02T12:00:00.000Z"});
    await db.query(`select persist_property_lifecycle_observation_atomic($1,$2,$3::jsonb,'{}','[]','location',null,null,null)`,
      [agency,second.sync,JSON.stringify(second.listing)]);
    expect((await scalar("select observation_commit_count n from sync_runs where id=$1",[second.sync])).n).toBe(1);
  });
  it("records price drops at observation time and keeps first price even when no drop exists", async () => {
    const first=await observe();
    await observe({at:"2026-09-02T12:00:00.000Z",price:135000});
    const prices=await scalar("select first_asking_price,latest_asking_price,reduction_percent::float,drop_count from market_observer_publication_metrics where publication_id=$1",[first.publicationId]);
    expect(prices).toEqual({first_asking_price:150000,latest_asking_price:135000,reduction_percent:10,drop_count:1});
    expect((await scalar("select occurred_at::text t from events where event_type='PRICE_DROP'")).t).toContain("2026-09-02");
  });
  it("does not treat source refresh as a price change or a new market start", async () => {
    await observe({published:"2026-08-01T00:00:00.000Z",modified:"2026-08-20T00:00:00.000Z"});
    await observe({at:"2026-09-02T12:00:00.000Z",published:"2026-08-01T00:00:00.000Z",modified:"2026-09-02T00:00:00.000Z"});
    expect((await scalar("select count(*)::integer n from events where event_type='PRICE_DROP'")).n).toBe(0);
    expect((await scalar("select count(*)::integer n from events where event_type='PUBLICATION_REFRESHED'")).n).toBe(1);
    expect((await scalar("select portal_published_at::text t from publications")).t).toContain("2026-08-01");
    expect(await scalar("select estimated_acquisition_at,acquisition_confidence from agency_listings")).toEqual({estimated_acquisition_at:null,acquisition_confidence:null});
  });
  it("ignores failed inventory, freezes absence, and requires grace time as well as healthy scans", async () => {
    await observe();
    await miss("2026-09-02T12:00:00Z",[],false);
    expect((await scalar("select state from publications")).state).toBe("ACTIVE");
    await miss("2026-09-03T12:00:00Z");
    await miss("2026-09-03T13:00:00Z");
    expect((await scalar("select state from publications")).state).toBe("MISSING_PENDING");
    await miss("2026-09-04T12:00:00Z");
    expect((await scalar("select state from publications")).state).toBe("REMOVED");
    expect((await scalar("select state from agency_listings")).state).toBe("EXIT_PENDING");
  });
  it("refuses stale post-exit conclusions and confirms unknown exit only after a fresh healthy scan", async () => {
    const first=await observe();
    await miss("2026-09-02T12:00:00Z"); await miss("2026-09-03T12:00:00Z");
    const job=await scalar("select id from lifecycle_jobs where job_type='POST_EXIT_CHECK'");
    await db.exec("savepoint expected_failure");
    await expect(db.query("select run_post_exit_check_atomic($1,$2,null,'2026-09-06T12:00:00Z')",[job.id,first.agencyListingId])).rejects.toThrow("POST_EXIT_FRESH_HEALTHY_SCAN_REQUIRED");
    await db.exec("rollback to savepoint expected_failure");
    const fresh=await miss("2026-09-06T12:00:00Z");
    await db.query("update sync_runs set status='SUCCEEDED',health_state='HEALTHY',inventory_complete=true,absence_evaluation_allowed=true,finished_at='2026-09-06T12:01:00Z' where id=$1",[fresh]);
    await db.query("select run_post_exit_check_atomic($1,$2,null,'2026-09-06T12:02:00Z')",[job.id,first.agencyListingId]);
    expect((await scalar("select state from agency_listings")).state).toBe("OFF_MARKET_NO_SALE_EVIDENCE");
    expect((await scalar("select sale_status from properties")).sale_status).toBe("UNKNOWN");
  });
  it("retains market presence when another portal is active, without falsely counting a parallel publication as a relist", async () => {
    const first=await observe();
    await observe({key:"two",host:"portal.test",propertyId:first.propertyId});
    await miss("2026-09-02T12:00:00Z",["two"]); await miss("2026-09-03T12:00:00Z",["two"]);
    expect((await scalar("select state from agency_listings")).state).toBe("ACTIVE");
    expect((await scalar("select relaunch_count from properties")).relaunch_count).toBe(0);
  });
  it("relisting keeps the property and earliest public evidence", async () => {
    const first=await observe({published:"2026-07-01T00:00:00.000Z"});
    await miss("2026-09-02T12:00:00Z"); await miss("2026-09-03T12:00:00Z");
    const second=await observe({key:"new-id",at:"2026-09-04T12:00:00.000Z",propertyId:first.propertyId,published:"2026-09-04T00:00:00.000Z"});
    expect(second.propertyId).toBe(first.propertyId);
    expect((await scalar("select relaunch_count from properties")).relaunch_count).toBe(1);
    expect((await scalar("select earliest_market_evidence_at::text t from market_observer_agency_listing_intelligence")).t).toContain("2026-07-01");
  });
  it("uses all current publications for sale assessment, independent of processing order", async () => {
    const first=await observe({status:"SOLD"});
    expect((await scalar("select sale_status from properties")).sale_status).toBe("SOLD_CONFIRMED");
    await observe({key:"two",host:"portal.test",propertyId:first.propertyId});
    expect((await scalar("select sale_status from properties")).sale_status).toBe("PROBABLE_SOLD");
    await observe({at:"2026-09-02T12:00:00.000Z",status:"SOLD"});
    expect((await scalar("select sale_status from properties")).sale_status).toBe("PROBABLE_SOLD");
  });
  it("links an opportunity once and preserves the operator's lead status and next action", async () => {
    const first=await observe();
    await observe({at:"2026-09-02T12:00:00.000Z",price:135000});
    const op=await scalar("select id from opportunities where property_id=$1",[first.propertyId]);
    const linked=await scalar("select acquisition_link_market_opportunity($1) lead",[op.id]);
    await db.query("update acquisition_leads set status='FOLLOW_UP',next_action_note='Operatore' where id=$1",[linked.lead]);
    const again=await scalar("select acquisition_link_market_opportunity($1) lead",[op.id]);
    expect(again).toEqual(linked);
    expect((await scalar("select count(*)::integer n from acquisition_signals")).n).toBe(1);
    expect(await scalar("select status,next_action_note from acquisition_leads")).toEqual({status:"FOLLOW_UP",next_action_note:"Operatore"});
  });
  it("preserves a Wikicasa publication date older than our first observation, without assigning mandate dates", async () => {
    await observe({host:"www.wikicasa.it",published:"2026-06-15T00:00:00.000Z"});
    expect((await scalar("select first_seen_at::text t from publications")).t).toContain("2026-09-01");
    expect((await scalar("select earliest_market_evidence_at::text t from market_observer_agency_listing_intelligence")).t).toContain("2026-06-15");
    expect((await scalar("select estimated_acquisition_at from agency_listings")).estimated_acquisition_at).toBeNull();
  });
  it("keeps repeated disappearances and reappearances as separate lifecycle events", async () => {
    await observe();
    await miss("2026-09-02T12:00:00Z"); await miss("2026-09-03T12:00:00Z");
    await observe({at:"2026-09-04T12:00:00.000Z"});
    await miss("2026-09-05T12:00:00Z"); await miss("2026-09-06T12:00:00Z");
    await observe({at:"2026-09-07T12:00:00.000Z"});
    expect((await scalar("select count(*)::integer n from events where event_type='PUBLICATION_REAPPEARED'")).n).toBe(2);
    expect((await scalar("select count(*)::integer n from events where event_type='PUBLICATION_REMOVED'")).n).toBe(2);
  });
  it("recognizes an evidenced agency change while retaining property age and active presence", async () => {
    const first=await observe({published:"2026-06-01T00:00:00.000Z"});
    await miss("2026-09-02T12:00:00Z"); await miss("2026-09-03T12:00:00Z");
    const secondAgency=await scalar(`insert into agencies(slug,name,adapter_key,website_url,inventory_url)
      values('second','Second','second','https://second.test','https://second.test/list') returning id`);
    agency=secondAgency.id as string;
    await observe({at:"2026-09-04T12:00:00.000Z",key:"second",host:"second.test",propertyId:first.propertyId});
    expect((await scalar("select state from agency_listings where id=$1",[first.agencyListingId])).state).toBe("CLOSED_SWITCHED");
    expect((await scalar("select property_state from properties")).property_state).toBe("ACTIVE_AGENCY");
    const rows=await db.query<{ exit_classification:string; earliest_market_evidence_at:string }>("select exit_classification,earliest_market_evidence_at::text from market_observer_agency_listing_intelligence");
    expect(rows.rows.map(row=>row.exit_classification)).toContain("AGENCY_CHANGED");
    expect(rows.rows.every(row=>row.earliest_market_evidence_at.includes("2026-06-01"))).toBe(true);
  });
  it("does not merge an uncertain property match", async () => {
    const first=await observe();
    await observe({key:"uncertain",decision:{outcome:"REVIEW_REQUIRED",propertyId:null,score:0.7,margin:0.02,
      candidates:[{propertyId:first.propertyId,rank:1,score:0.7,features:{},contradictions:[]}]}});
    expect((await scalar("select count(*)::integer n from properties")).n).toBe(2);
    expect((await scalar("select count(*)::integer n from review_queue where review_type='IDENTITY'")).n).toBe(1);
  });
  it("preserves human-confirmed agency and sale outcomes when the source contradicts them", async () => {
    const first=await observe();
    await db.query(`insert into manual_overrides(target_type,target_id,override_key,override_value,reason,source,effective_at)
      values('AGENCY_LISTING',$1,'state','"CLOSED_WITHDRAWN"','Verified by operator','USER','2026-09-01T12:00:00Z')`,[first.agencyListingId]);
    await db.query(`insert into manual_overrides(target_type,target_id,override_key,override_value,reason,source,effective_at)
      values('PROPERTY',$1,'sale_status','"NOT_SOLD_CONFIRMED"','Verified by operator','USER','2026-09-01T12:00:00Z')`,[first.propertyId]);
    await observe({at:"2026-09-02T12:00:00.000Z",status:"SOLD"});
    expect((await scalar("select state from agency_listings")).state).toBe("CLOSED_WITHDRAWN");
    expect((await scalar("select sale_status from properties")).sale_status).toBe("NOT_SOLD_CONFIRMED");
  });
  it("renews only the current owner's live lease", async () => {
    const job=await scalar(`insert into lifecycle_jobs(job_type,agency_id,status,worker_id,lease_expires_at)
      values('SYNC_AGENCY',$1,'RUNNING','owner',now()+interval '2 minutes') returning id`,[agency]);
    expect((await scalar("select renew_lifecycle_job($1,'other') renewed",[job.id])).renewed).toBe(false);
    expect((await scalar("select renew_lifecycle_job($1,'owner') renewed",[job.id])).renewed).toBe(true);
  });
  it("isolates absence evaluation and external IDs by source, even when portal and agency IDs coincide", async () => {
    const first=await observe();
    const portal=await observe({host:"www.wikicasa.it",propertyId:first.propertyId});
    expect(portal.publicationId).not.toBe(first.publicationId);
    await miss("2026-09-02T12:00:00Z"); await miss("2026-09-03T12:00:00Z");
    expect((await scalar("select state from publications where id=$1",[portal.publicationId])).state).toBe("ACTIVE");
    expect((await scalar("select state from agency_listings")).state).toBe("ACTIVE");
  });
  it("resets absence from positive catalog presence without manufacturing a detail observation", async () => {
    const first=await observe();
    await miss("2026-09-02T12:00:00Z");
    await miss("2026-09-03T12:00:00Z",["one"]);
    expect((await scalar("select state,missing_healthy_run_count from publications")).state).toBe("ACTIVE");
    expect((await scalar("select missing_healthy_run_count n from publications")).n).toBe(0);
    expect((await scalar("select count(*)::integer n from snapshots")).n).toBe(1);
    const hydration=await scalar("select latest_snapshot->>'observed_at' t from lifecycle_property_hydration(array[$1]::uuid[])",[first.propertyId]);
    expect(hydration.t).toContain("2026-09-01");
    await miss("2026-09-04T12:00:00Z");
    expect((await scalar("select state from publications")).state).toBe("MISSING_PENDING");
  });
  it("includes private-only V2 properties in Intelligence without creating a separate archive", async () => {
    const property=await scalar(`insert into properties(canonical_attributes,first_seen_at)
      values('{"address":"Via privata 1","locality":"Bitonto"}','2026-06-01T12:00:00Z') returning id`);
    const legacy=await scalar(`insert into listings(source,url,title,seller_type) values('wikicasa','https://www.wikicasa.it/annuncio/1','Fixture private','private') returning id`);
    await db.query(`insert into private_publications(legacy_listing_id,property_id,source,source_listing_id,canonical_url,identity_outcome,title,
      price_amount,first_public_evidence_at,first_seen_at,last_seen_at,content_hash)
      values($1,$2,'wikicasa','1','https://www.wikicasa.it/annuncio/1','NEW_PROPERTY','Via privata 1',120000,
      '2026-05-01T12:00:00Z','2026-06-01T12:00:00Z','2026-09-01T12:00:00Z','hash')`,[legacy.id,property.id]);
    await db.query("select recompute_market_observer_intelligence(array[$1]::uuid[],'2026-09-02T12:00:00Z')",[property.id]);
    const intelligence=await scalar("select agency_listing_id,agency_name,exit_classification,first_asking_price,latest_asking_price from market_observer_intelligence where property_id=$1",[property.id]);
    expect(intelligence).toEqual({agency_listing_id:null,agency_name:"Pubblicazione privata",exit_classification:"ACTIVE",first_asking_price:120000,latest_asking_price:120000});
  });
  it("does not promote low-confidence source sale claims to confirmed sales",async()=>{
    await observe({status:"SOLD",confidence:0.5});
    expect((await scalar("select sale_status from properties")).sale_status).toBe("PROBABLE_SOLD");
    expect((await scalar("select count(*)::integer n from review_queue where review_type='LIFECYCLE'")).n).toBe(1);
  });
  it("records explicit source removal and schedules verification without calling it a sale",async()=>{
    await observe();
    await observe({at:"2026-09-02T12:00:00.000Z",status:"REMOVED"});
    expect((await scalar("select state from publications")).state).toBe("REMOVED");
    expect((await scalar("select state from agency_listings")).state).toBe("EXIT_PENDING");
    expect((await scalar("select sale_status from properties")).sale_status).toBe("UNKNOWN");
    expect((await scalar("select count(*)::integer n from lifecycle_jobs where job_type='POST_EXIT_CHECK'")).n).toBe(1);
  });
  it.each(["RUNNING","FAILED","PARTIAL"])("never commits absence from a %s scan, even with a healthy-looking adapter row",async(status)=>{
    await observe();const sync=await run("2026-09-02T12:00:00Z");
    await db.query("update sync_runs set status=$2,health_state='HEALTHY',inventory_complete=true,absence_evaluation_allowed=true,inventory_observed_keys='{}',finished_at='2026-09-02T12:00:00Z' where id=$1",[sync,status]);
    await db.query("select apply_missing_observations_atomic($1,$2,'{}','2026-09-02T12:00:00Z')",[agency,sync]);
    expect((await scalar("select state,missing_healthy_run_count n from publications"))).toEqual({state:"ACTIVE",n:0});
  });
  it("rejects invented missing keys and incomplete inventory despite successful status",async()=>{
    await observe();const sync=await run("2026-09-02T12:00:00Z");
    await db.query("update sync_runs set status='SUCCEEDED',health_state='HEALTHY',inventory_complete=true,absence_evaluation_allowed=true,inventory_observed_keys=array['one'],finished_at='2026-09-02T12:00:00Z' where id=$1",[sync]);
    await db.query("select apply_missing_observations_atomic($1,$2,'{}','2026-09-02T12:00:00Z')",[agency,sync]);
    expect((await scalar("select state from publications")).state).toBe("ACTIVE");
    await db.query("update sync_runs set inventory_complete=false,absence_evaluation_allowed=false where id=$1",[sync]);
    await db.query("select apply_missing_observations_atomic($1,$2,array['one'],'2026-09-02T12:00:00Z')",[agency,sync]);
    expect((await scalar("select count(*)::integer n from missing_observation_commits")).n).toBe(0);
  });
  it("does not allow a late old inventory to undo a later positive observation",async()=>{
    await observe();const old=await run("2026-09-02T12:00:00Z");
    await observe({at:"2026-09-03T12:00:00.000Z"});
    await db.query("update sync_runs set status='SUCCEEDED',health_state='HEALTHY',inventory_complete=true,absence_evaluation_allowed=true,inventory_observed_keys='{}',finished_at='2026-09-04T12:00:00Z' where id=$1",[old]);
    await db.query("select apply_missing_observations_atomic($1,$2,'{}','2026-09-04T12:00:00Z')",[agency,old]);
    expect((await scalar("select state,missing_healthy_run_count n from publications"))).toEqual({state:"ACTIVE",n:0});
  });
  it("does not rewind price or last_seen with a delayed detail observation",async()=>{
    await observe({at:"2026-09-03T12:00:00.000Z",price:140000});
    await db.exec("savepoint stale");
    await expect(observe({at:"2026-09-02T12:00:00.000Z",price:150000})).rejects.toThrow("OBSERVATION_PRECEDES_LAST_SEEN");
    await db.exec("rollback to savepoint stale");
    expect((await scalar("select latest_asking_price from market_observer_publication_metrics")).latest_asking_price).toBe(140000);
  });
  it("does not turn simultaneous same-host prices into relaunches or reductions",async()=>{
    const first=await observe({price:180000});
    await observe({key:"parallel",at:"2026-09-03T12:00:00.000Z",propertyId:first.propertyId,price:160000});
    expect((await scalar("select relaunch_count from properties")).relaunch_count).toBe(0);
    expect((await scalar("select count(*)::integer n from events where event_type in ('PRICE_DROP','PUBLICATION_RELAUNCHED')")).n).toBe(0);
    expect((await scalar("select source_price_conflict,price_confidence::float from market_observer_agency_price_metrics"))).toEqual({source_price_conflict:true,price_confidence:0.65});
  });
  it("keeps a deterministic source price even if a mirror is processed later",async()=>{
    const first=await observe({price:180000});
    await observe({key:"mirror",host:"portal.test",at:"2026-09-03T12:00:00.000Z",propertyId:first.propertyId,price:160000});
    expect((await scalar("select latest_asking_price,first_asking_price,drop_count from market_observer_intelligence"))).toEqual({latest_asking_price:180000,first_asking_price:180000,drop_count:0});
  });
  it("counts each genuine re-entry once and preserves the prior commercial episode",async()=>{
    const first=await observe();await miss("2026-09-02T12:00:00Z");await miss("2026-09-03T12:00:00Z");
    await miss("2026-09-06T12:00:00Z");
    const job=await scalar("select id from lifecycle_jobs where job_type='POST_EXIT_CHECK' order by created_at limit 1");
    await db.query("select run_post_exit_check_atomic($1,$2,null,'2026-09-06T12:00:01Z')",[job.id,first.agencyListingId]);
    await observe({at:"2026-09-07T12:00:00.000Z"});await observe({at:"2026-09-08T12:00:00.000Z"});
    expect((await scalar("select relaunch_count from properties")).relaunch_count).toBe(1);
    expect((await scalar("select count(*)::integer n from events where event_type='AGENCY_LISTING_REACTIVATED'")).n).toBe(1);
    expect((await scalar("select payload->>'previousState' s,payload->>'previousExitConfirmedAt' t from events where event_type='AGENCY_LISTING_REACTIVATED'"))).toMatchObject({s:"OFF_MARKET_NO_SALE_EVIDENCE",t:expect.stringContaining("2026-09-06")});
    expect((await scalar("select state,exit_confirmed_at from agency_listings"))).toEqual({state:"ACTIVE",exit_confirmed_at:null});
  });
  it("a brief pending absence is a reappearance, not a completed relisting",async()=>{
    await observe();await miss("2026-09-02T12:00:00Z");await observe({at:"2026-09-02T14:00:00.000Z"});
    expect((await scalar("select relaunch_count from properties")).relaunch_count).toBe(0);
  });
  it("requires the follow-up scan to start after the due time, not merely finish afterwards",async()=>{
    const first=await observe();await miss("2026-09-02T12:00:00Z");await miss("2026-09-03T12:00:00Z");
    const sync=await run("2026-09-05T11:00:00Z");
    await db.query("update sync_runs set status='SUCCEEDED',health_state='HEALTHY',inventory_complete=true,absence_evaluation_allowed=true,inventory_observed_keys='{}',finished_at='2026-09-05T13:00:00Z' where id=$1",[sync]);
    const job=await scalar("select id from lifecycle_jobs where job_type='POST_EXIT_CHECK'");
    await db.exec("savepoint no_fresh");
    await expect(db.query("select run_post_exit_check_atomic($1,$2,null,'2026-09-05T14:00:00Z')",[job.id,first.agencyListingId])).rejects.toThrow("POST_EXIT_FRESH_HEALTHY_SCAN_REQUIRED");
    await db.exec("rollback to savepoint no_fresh");
    expect((await scalar("select state from agency_listings")).state).toBe("EXIT_PENDING");
  });
  it("finds sold evidence on the other publication of the same agency listing",async()=>{
    const first=await observe();await miss("2026-09-02T12:00:00Z");await miss("2026-09-03T12:00:00Z");
    await observe({key:"sale",host:"portal.test",propertyId:first.propertyId,at:"2026-09-04T12:00:00.000Z",status:"SOLD"});
    const job=await scalar("select id from lifecycle_jobs where job_type='POST_EXIT_CHECK'");
    expect((await scalar("select run_post_exit_check_atomic($1,$2,$3,'2026-09-06T12:00:00Z') outcome",[job.id,first.agencyListingId,first.publicationId])).outcome).toBe("CLOSED_SOLD");
    expect((await scalar("select sale_status from properties")).sale_status).toBe("SOLD_CONFIRMED");
  });
  it("keeps sold_at unknown unless the source explicitly declares a sale date",async()=>{
    await observe({status:"SOLD"});
    expect((await scalar("select sold_at,sold_observed_at::text from market_observer_intelligence"))).toEqual({sold_at:null,sold_observed_at:expect.stringContaining("2026-09-01")});
    await observe({at:"2026-09-02T12:00:00.000Z",status:"SOLD",soldAt:"2026-08-30T12:00:00.000Z"});
    expect((await scalar("select sold_at::text from market_observer_intelligence")).sold_at).toContain("2026-08-30");
  });
  it("records classifier version, current evidence and provenance without changing classification time on unchanged observations",async()=>{
    await observe();const first=await scalar("select market_exit_classified_at::text t from agency_listings");
    await observe({at:"2026-09-02T12:00:00.000Z"});
    const metadata=await scalar("select market_exit_classified_at::text t,market_exit_classifier_version v,cardinality(market_exit_evidence_ids) n,market_exit_reasons reasons,market_exit_provenance provenance from agency_listings");
    expect(metadata).toMatchObject({t:first.t,v:3,n:expect.any(Number),reasons:["positive_publication"]});
    expect(Number(metadata.n)).toBeGreaterThan(0);
    expect(metadata.provenance).toMatchObject({publications:[{state:"ACTIVE"}]});
  });
  it("refreshes an existing Acquisition signal without duplicating activities or changing the operator's action",async()=>{
    const first=await observe();await observe({at:"2026-09-02T12:00:00.000Z",price:140000});
    const op=await scalar("select id from opportunities");const lead=await scalar("select acquisition_link_market_opportunity($1) id",[op.id]);
    await db.query("update acquisition_leads set next_action_note='Richiamare venerdì' where id=$1",[lead.id]);
    await observe({at:"2026-09-03T12:00:00.000Z",price:130000});
    await db.query("select acquisition_link_market_opportunity($1)",[op.id]);
    expect((await scalar("select count(*)::integer n from acquisition_signals")).n).toBe(1);
    expect((await scalar("select count(*)::integer n from acquisition_activities")).n).toBe(1);
    expect((await scalar("select details->'score' score from acquisition_signals"))).toEqual(await scalar("select to_jsonb(score) score from opportunities where property_id=$1",[first.propertyId]));
    expect((await scalar("select next_action_note from acquisition_leads")).next_action_note).toBe("Richiamare venerdì");
  });
  it("cannot let an old unknown exit promote the property when a new agency is active",async()=>{
    const first=await observe();await miss("2026-09-02T12:00:00Z");await miss("2026-09-03T12:00:00Z");
    await db.query("update agency_listings set state='OFF_MARKET_NO_SALE_EVIDENCE' where id=$1",[first.agencyListingId]);
    const other=await scalar("insert into agencies(slug,name,adapter_key,website_url,inventory_url) values('other','Other','other','https://other.test','https://other.test/list') returning id");
    agency=String(other.id);await observe({propertyId:first.propertyId,key:"other",host:"other.test",at:"2026-09-04T12:00:00.000Z"});
    expect((await scalar("select score::float from opportunities where property_id=$1",[first.propertyId])).score).toBe(0);
    expect((await scalar("select state from agency_listings where id=$1",[first.agencyListingId])).state).toBe("CLOSED_SWITCHED");
  });
  it("reactivates a switched relationship and preserves the ended episode in the timeline",async()=>{
    const first=await observe();await db.query("update agency_listings set state='CLOSED_SWITCHED',closed_at='2026-09-02T12:00:00Z' where id=$1",[first.agencyListingId]);
    await db.query("update publications set state='REMOVED',removed_at='2026-09-02T12:00:00Z' where id=$1",[first.publicationId]);
    await observe({at:"2026-09-04T12:00:00.000Z"});
    expect((await scalar("select state,market_exit_classification from agency_listings"))).toEqual({state:"ACTIVE",market_exit_classification:"RELISTED"});
    expect((await scalar("select payload->>'previousState' state from events where event_type='AGENCY_LISTING_REACTIVATED'")).state).toBe("CLOSED_SWITCHED");
  });
  it("treats a newly recognized sold graphic as significant even if the source content hash is unchanged",async()=>{
    const first=await observe({status:"UNKNOWN"});const sync=await run("2026-09-02T12:00:00Z");
    const listing=rehashNormalizedListing(first.listing,input=>({...input,observedAt:"2026-09-02T12:00:00.000Z"}));
    const assets=[{canonicalUrl:listing.assets[0].canonicalUrl,classification:"SOLD_GRAPHIC",sha256:"a".repeat(64)}];
    await db.query("select persist_property_lifecycle_observation_atomic($1,$2,$3,'{}',$4,'location',null,null,null)",[agency,sync,JSON.stringify(listing),JSON.stringify(assets)]);
    expect((await scalar("select count(*)::integer n from snapshots")).n).toBe(2);
    expect((await scalar("select sale_status from properties")).sale_status).toBe("SOLD_CONFIRMED");
    const next=await run("2026-09-03T12:00:00Z");
    await db.query("select persist_property_lifecycle_observation_atomic($1,$2,$3,'{}',$4,'location',null,null,null)",[agency,next,JSON.stringify({...listing,observedAt:"2026-09-03T12:00:00.000Z"}),JSON.stringify(assets)]);
    expect((await scalar("select count(*)::integer n from snapshots")).n).toBe(2);
  });
  it.each(["2026-12-01T00:00:00.000Z","2026-02-31T00:00:00.000Z"])("rejects a future or invalid declared sale date: %s",async(soldAt)=>{
    await observe({status:"SOLD",soldAt});
    expect((await scalar("select sold_at from market_observer_intelligence")).sold_at).toBeNull();
    expect((await scalar("select count(*)::integer n from evidence where claim_key='publication.soldAt'")).n).toBe(0);
  });
  it("retains an explicit human exit classification and never derives expiry from age",async()=>{
    const first=await observe({published:"2020-01-01T00:00:00.000Z"});
    expect((await scalar("select market_exit_classification c from agency_listings")).c).toBe("ACTIVE");
    await db.query(`insert into manual_overrides(target_type,target_id,override_key,override_value,reason,source,effective_at)
      values('AGENCY_LISTING',$1,'exit_classification','"WITHDRAWN"','Proprietario verificato','USER','2026-09-01T13:00:00Z')`,[first.agencyListingId]);
    await observe({at:"2026-09-02T12:00:00.000Z",status:"SOLD"});
    expect((await scalar("select market_exit_classification c,market_exit_confidence::float confidence from agency_listings"))).toEqual({c:"WITHDRAWN",confidence:1});
  });
  it("does not change a publication hash solely because new optional evidence fields are empty",()=>{
    const absent=rehashNormalizedListing(template,input=>({...input,source:{...input.source,soldAt:undefined},location:{...input.location,zoneName:undefined}}));
    const empty=rehashNormalizedListing(template,input=>({...input,source:{...input.source,soldAt:null},location:{...input.location,zoneName:null}}));
    expect(empty.contentHash).toBe(absent.contentHash);
  });
});
