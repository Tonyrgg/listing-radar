import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.sequential("lossless resource compaction", () => {
  let db:PGlite;
  let pub:string;
  let snapshots:unknown[];
  let fingerprints:unknown[];
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create table auth.users(id uuid primary key);create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;`);
    for(const file of ["0001_production_schema.sql","0010_acquisition_os.sql","0014_market_observer_reliability.sql","0015_market_observer_intelligence.sql","0016_market_observer_private_projection.sql"])
      await db.exec((await readFile(`supabase/migrations/${file}`,"utf8")).replace(/create extension if not exists pgcrypto;/g,""));
    const agency=(await db.query<{id:string}>(`insert into agencies(slug,name,adapter_key,website_url,inventory_url) values('compact','Compact','test','https://test.example','https://test.example/list') returning id`)).rows[0].id;
    const property=(await db.query<{id:string}>("insert into properties default values returning id")).rows[0].id;
    const al=(await db.query<{id:string}>("insert into agency_listings(property_id,agency_id) values($1,$2) returning id",[property,agency])).rows[0].id;
    pub=(await db.query<{id:string}>("insert into publications(agency_listing_id,agency_id,source_key,canonical_url) values($1,$2,'one','https://test.example/one') returning id",[al,agency])).rows[0].id;
    for(let n=0;n<4;n++){
      const sync=(await db.query<{id:string}>("insert into sync_runs(agency_id,adapter_key) values($1,'test') returning id",[agency])).rows[0].id;
      const at=`2026-09-0${n+1}T12:00:00.000Z`;
      const payload={observedAt:at,commercial:{priceAmount:150000,description:"Una descrizione lunga, invariata"},status:{evidence:[{observedAt:at,rawValue:"online"}]},marketStart:{evidence:[{observedAt:at,normalizedValue:null}]},unknown:{value:false,observedAt:"preserve unknown evidence"},assets:[{canonicalUrl:"https://test.example/photo.jpg"}]};
      const snap=(await db.query<{id:string}>("insert into snapshots(publication_id,sync_run_id,observed_at,content_hash,normalized_payload,description,price_amount) values($1,$2,$3,'unchanged',$4,'Una descrizione lunga, invariata',150000) returning id",[pub,sync,at,JSON.stringify(payload)])).rows[0].id;
      await db.query("insert into image_fingerprints(property_id,publication_id,snapshot_id,canonical_url,algorithm,fingerprint,metadata) values($1,$2,$3,'https://test.example/photo.jpg','SOURCE_URL_SHA256','same','{\"camera\":null,\"origin\":\"source\"}')",[property,pub,snap]);
      await db.query("insert into evidence(property_id,publication_id,snapshot_id,sync_run_id,evidence_kind,source_url,extraction_method,claim_key,confidence,observed_at,evidence_hash) values($1,$2,$3,$4,'STATUS','https://test.example/one','TEST','status',1,$5,$6)",[property,pub,snap,sync,at,`evidence-${n}`]);
    }
    snapshots=(await db.query("select to_jsonb(s) row from snapshots s order by id")).rows;
    fingerprints=(await db.query("select to_jsonb(f) row from image_fingerprints f order by id")).rows;
    await db.exec(await readFile("supabase/migrations/0017_resource_compaction.sql","utf8"));
    await db.exec(await readFile("supabase/migrations/0018_compaction_index_headroom.sql","utf8"));
  },30_000);
  afterAll(async()=>{await db?.close();});
  it("preserves every column and ID before and after bounded, repeatable compaction",async()=>{
    expect((await db.query("select to_jsonb(s) row from snapshots s order by id")).rows).toEqual(snapshots);
    expect((await db.query("select to_jsonb(f) row from image_fingerprints f order by id")).rows).toEqual(fingerprints);
    for(let n=0;n<4;n++) await db.query("select compact_snapshot_payloads($1,1)",[pub]);
    await db.query("select compact_image_fingerprints($1,2)",[pub]);
    await db.query("select compact_image_fingerprints($1,2)",[pub]);
    expect((await db.query("select to_jsonb(s) row from snapshots s order by id")).rows).toEqual(snapshots);
    expect((await db.query("select to_jsonb(f) row from image_fingerprints f order by id")).rows).toEqual(fingerprints);
    expect((await db.query("select count(*)::int n from snapshot_payload_versions")).rows[0]).toEqual({n:1});
    expect((await db.query("select to_jsonb(f) row from snapshots s cross join lateral lifecycle_snapshot_fingerprints(s.id) f order by f.id")).rows).toEqual(fingerprints);
    expect((await db.query("select count(*)::int n from image_fingerprint_current")).rows[0]).toEqual({n:0});
    expect((await db.query("select compact_snapshot_payloads($1,1) snapshots,compact_image_fingerprints($1,2) images",[pub])).rows[0]).toEqual({snapshots:0,images:0});
    expect((await db.query("select count(*)::int n from evidence e join snapshots s on s.id=e.snapshot_id")).rows[0]).toEqual({n:4});
  });
  it("retains distinct matching values without shipping repeated observations",async()=>{
    expect((await db.query("select kind,algorithm,fingerprint from lifecycle_identity_fingerprints(null)")).rows)
      .toEqual([{kind:"IMAGE",algorithm:"SOURCE_URL_SHA256",fingerprint:"same"}]);
  });
  it("keeps append-only history and rejects historical duplicate fingerprint inserts",async()=>{
    await expect(db.exec("update snapshot_observations set price_amount=1")).rejects.toThrow("append-only");
    await expect(db.exec("delete from snapshot_observations")).rejects.toThrow("append-only");
    await expect(db.exec("update snapshot_payload_versions set description='Changed'")).rejects.toThrow("append-only");
    await expect(db.exec("delete from image_fingerprint_archive_groups")).rejects.toThrow("append-only");
    await expect(db.exec(`insert into image_fingerprints select * from image_fingerprints limit 1`)).rejects.toThrow("Duplicate historical fingerprint");
  });
  it("preserves price metrics through the rebinding of dependent views",async()=>{
    expect((await db.query("select first_asking_price,latest_asking_price from market_observer_publication_metrics where publication_id=$1",[pub])).rows[0])
      .toEqual({first_asking_price:150000,latest_asking_price:150000});
  });
  it("enforces current fingerprint uniqueness after reclaiming the oversized index",async()=>{
    const sync=(await db.query<{id:string}>("insert into sync_runs(agency_id,adapter_key) select agency_id,'test' from publications where id=$1 returning id",[pub])).rows[0].id;
    const snapshot=(await db.query<{id:string}>("insert into snapshots(publication_id,sync_run_id,observed_at,content_hash,normalized_payload) values($1,$2,now(),'new','{\"observedAt\":null,\"unknown\":true}') returning id",[pub,sync])).rows[0].id;
    const sql="insert into image_fingerprints(property_id,publication_id,snapshot_id,canonical_url,algorithm,fingerprint) select property_id,publication_id,$1,'https://test.example/new.jpg','SHA256','new' from image_fingerprints limit 1";
    await db.query(sql,[snapshot]);
    await expect(db.query(sql,[snapshot])).rejects.toThrow("Duplicate fingerprint observation");
    expect((await db.query("select normalized_payload from snapshots where id=$1",[snapshot])).rows[0])
      .toEqual({normalized_payload:{observedAt:null,unknown:true}});
  });
});
