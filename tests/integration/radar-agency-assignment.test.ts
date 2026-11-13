import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
it('removes a switched listing and a manually assigned own-agency property immediately from opportunities',async()=>{
 const db=new PGlite();const property='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',own='00000000-0000-4000-8000-000000000003';
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;
 create table auth.users(id uuid);insert into auth.users values('${actor}');
 create table properties(id uuid primary key);insert into properties values('${property}');
 create table agencies(id uuid primary key,name text,market_role text);insert into agencies values('${own}','Our confirmed branch','OUR_AGENCY');
 create table agency_listings(id uuid primary key,property_id uuid,state text);insert into agency_listings values('${property}','${property}','ACTIVE');
 create table manual_overrides(id uuid primary key default gen_random_uuid(),target_type text,target_id uuid,override_key text,override_value jsonb,reason text,source text,created_by uuid,supersedes_id uuid,effective_at timestamptz,created_at timestamptz default now());
 create table events(property_id uuid,event_type text,occurred_at timestamptz,confidence numeric,actor_type text,dedupe_key text,payload jsonb);
 create view radar_property_live_archive as select '${property}'::uuid property_id,'${property}'::uuid agency_listing_id,null::uuid agency_id,'Old agency'::text agency_name,'COMPETITOR'::text agency_role,65::numeric opportunity_score,'UNKNOWN'::text sale_status,'ACTIVE'::text state,'ACTIVE'::text exit_classification;`);
 await db.exec(await readFile('supabase/migrations/0094_radar_live_agency_assignment.sql','utf8'));
 await db.exec(`update agency_listings set state='CLOSED_SWITCHED'`);
 expect((await db.query('select state,exit_classification,opportunity_score from radar_property_live_archive')).rows[0]).toMatchObject({state:'CLOSED_SWITCHED',exit_classification:'AGENCY_CHANGED',opportunity_score:'0'});
 await db.query('select record_radar_own_agency($1,null,$2,$3)',[property,'User confirmed our agency',actor]);
 expect((await db.query('select agency_role,agency_id,opportunity_score,state from radar_property_live_archive')).rows[0]).toMatchObject({agency_role:'OUR_AGENCY',agency_id:own,opportunity_score:'0',state:'ACTIVE'});
 expect((await db.query("select * from radar_property_live_archive where opportunity_score>0")).rows).toHaveLength(0);
 expect((await db.query<{v:{startedAt:null}}>('select override_value v from manual_overrides')).rows[0].v.startedAt).toBeNull();
 expect((await db.query('select * from events')).rows).toHaveLength(1);
 await db.query('select record_radar_own_agency($1,null,$2,$3,false)',[property,'No longer managed by us',actor]);
 expect((await db.query('select agency_role,opportunity_score from radar_property_live_archive')).rows[0]).toMatchObject({agency_role:'UNKNOWN',opportunity_score:'0'});
 await expect(db.query('select record_radar_own_agency($1,current_date+1,$2,$3)',[property,'Invalid date',actor])).rejects.toThrow();
 }finally{await db.close();}
},30000);
