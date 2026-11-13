import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
it('uses a March publication despite September monitoring, scopes evidence to its agency and never falls back to observation',async()=>{
 const db=new PGlite();
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',pub='00000000-0000-4000-8000-000000000003';
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table evidence(id uuid primary key,publication_id uuid,source_url text,claim_key text,extraction_method text,normalized_value jsonb);
 create table agency_listings(id uuid primary key,estimated_acquisition_at timestamptz,acquisition_evidence_id uuid,first_seen_at timestamptz);
 insert into agency_listings values('${a}',null,null,'2026-09-01'),('${b}',null,null,'2026-09-01');
 create table publications(id uuid primary key,agency_listing_id uuid,portal_published_at timestamptz,canonical_url text);
 insert into publications values('${pub}','${a}','2026-03-01','https://agency-a.test/ad');
 create table manual_overrides(id uuid,target_type text,target_id uuid,override_key text,override_value jsonb,effective_at timestamptz,created_at timestamptz,supersedes_id uuid);
 create view radar_property_live_archive as select id property_id,id agency_listing_id,null::timestamptz sold_at,null::timestamptz sold_observed_at,'ACTIVE'::text state,now() last_seen_at from agency_listings;`);
 await db.exec(await readFile('supabase/migrations/0095_documented_agency_tenure.sql','utf8'));
 const rows=(await db.query<{id:string;start:string|null;days_with_agency:number|null;agency_start_source:string}>('select property_id id,agency_started_at::date::text start,days_with_agency,agency_start_source from radar_property_live_archive order by property_id')).rows;
 expect(rows[0].start).toBe('2026-03-01');expect(rows[0].days_with_agency).toBeGreaterThan(200);expect(rows[1].start).toBeNull();expect(rows[1].days_with_agency).toBeNull();
 await db.exec(`insert into evidence values(gen_random_uuid(),'${pub}','https://agency-a.test/ad','publication.photoBatchDate','PHOTO_DATE','{"lowerBound":"2025-01-01"}');`);
 expect((await db.query<{d:string}>('select agency_started_at::date::text d from radar_agency_tenure where agency_listing_id=$1',[a])).rows[0].d).toBe('2026-03-01');
 await db.exec(`insert into evidence values(gen_random_uuid(),'${pub}','https://agency-a.test/ad','publication.datePublished','JSON_LD','{"lowerBound":"2026-02-01","upperBound":"2026-02-01T23:59:59Z"}');`);
 expect((await db.query<{d:string}>('select agency_started_at::date::text d from radar_agency_tenure where agency_listing_id=$1',[a])).rows[0].d).toBe('2026-02-01');
 expect((await db.query<{d:string|null}>('select agency_started_at::date::text d from radar_agency_tenure where agency_listing_id=$1',[b])).rows[0].d).toBeNull();
 await db.exec(await readFile('supabase/migrations/0096_index_documented_agency_dates.sql','utf8'));
 expect((await db.query<{d:string}>('select agency_started_at::date::text d from radar_agency_tenure where agency_listing_id=$1',[a])).rows[0].d).toBe('2026-02-01');
 await db.exec(`insert into evidence values(gen_random_uuid(),'${pub}','https://web.archive.org/web/20250101/https://agency-a.test/ad','publication.archivedPresence','WAYBACK_VERIFIED_PRESENCE','{"lowerBound":"2025-01-01T12:00:00Z"}');`);
 await db.exec('create table radar_read_model_state(singleton boolean,source_revision bigint);insert into radar_read_model_state values(true,1);');
 await db.exec(await readFile('supabase/migrations/0097_archived_agency_presence.sql','utf8'));
 expect((await db.query<{d:string;source:string}>('select agency_started_at::date::text d,agency_start_source source from radar_agency_tenure where agency_listing_id=$1',[a])).rows[0]).toEqual({d:'2025-01-01',source:'WAYBACK_VERIFIED_PRESENCE'});
 expect((await db.query<{d:string|null}>('select agency_started_at::date::text d from radar_agency_tenure where agency_listing_id=$1',[b])).rows[0].d).toBeNull();
 }finally{await db.close();}
},30000);
