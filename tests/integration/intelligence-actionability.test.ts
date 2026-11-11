import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {it,expect} from 'vitest';
it('runs projection migration: civic improves actionable signals, sold marks exclude opportunities, manual decisions prevail',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role authenticated;create role service_role;
 create table properties(property_id uuid,opportunity_score numeric,exit_classification text,sale_status text,reasons jsonb,street_name text,street_number text,location_precision text,latitude numeric,longitude numeric,surface_sqm numeric,property_type text,rooms numeric);
 create table agency_listings(id uuid,property_id uuid);create table publications(id uuid,agency_listing_id uuid);
 create table snapshots(id uuid,publication_id uuid,observed_at timestamptz);create table evidence(snapshot_id uuid,claim_key text,confidence numeric);
 create view market_observer_graph_property_archive as select * from properties;
 insert into properties values('00000000-0000-0000-0000-000000000001',30,'ACTIVE','UNKNOWN','[]','Via Roma','12','EXACT_ADDRESS',41,16,80,'Appartamento',3);
 insert into properties values('00000000-0000-0000-0000-000000000002',30,'ACTIVE','UNKNOWN','[]',null,null,'APPROXIMATE_AREA',41,16,null,null,null);
 insert into properties values('00000000-0000-0000-0000-000000000003',0,'ACTIVE','UNKNOWN','[]','Via Roma','12','EXACT_ADDRESS',41,16,80,'Appartamento',3);`);
 await db.exec(await readFile('supabase/migrations/0079_intelligence_actionability_and_sold.sql','utf8'));
 const result=await db.query<{opportunity_score:number,identifiability_bonus:number}>('select opportunity_score,identifiability_bonus from market_observer_graph_property_archive order by property_id');
 expect(result.rows.map(x=>Number(x.opportunity_score))).toEqual([55,30,0]);
 await db.exec(`update properties set sale_status='SOLD_CONFIRMED' where opportunity_score=30;`);
 const sold=await db.query<{exit_classification:string,opportunity_score:number}>('select exit_classification,opportunity_score from market_observer_graph_property_archive where base_opportunity_score=30');
 expect(sold.rows.every(x=>x.exit_classification==='SOLD_CONFIRMED'&&Number(x.opportunity_score)===0)).toBe(true);
 }finally{await db.close()}
},30000);
