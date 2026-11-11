import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
it('keeps a complete indexed snapshot, refreshes dirty data and preserves the last good snapshot on refresh failure',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table properties(property_id uuid,row_id text,opportunity_score numeric,last_seen_at timestamptz,exit_classification text,latest_asking_price numeric,surface_sqm numeric);
 insert into properties values('00000000-0000-0000-0000-000000000001','one',30,now(),'ACTIVE',100000,100);
 create view market_observer_graph_property_archive as select * from properties;`);
 await db.exec(await readFile('supabase/migrations/0083_radar_indexed_read_model.sql','utf8'));
 expect((await db.query<{p:number}>('select unit_asking_price p from radar_property_read_model')).rows[0].p).toBe('1000.0000000000000000');
 await db.exec('update properties set opportunity_score=55');
 expect(Number((await db.query<{s:number}>('select opportunity_score s from radar_property_read_model')).rows[0].s)).toBe(30);
 expect((await db.query<{ok:boolean}>('select refresh_radar_read_model() ok')).rows[0].ok).toBe(true);
 expect(Number((await db.query<{s:number}>('select opportunity_score s from radar_property_read_model')).rows[0].s)).toBe(55);
 await db.exec("insert into properties select * from properties");
 expect((await db.query<{ok:boolean}>('select refresh_radar_read_model() ok')).rows[0].ok).toBe(false);
 expect((await db.query('select * from radar_property_read_model')).rows).toHaveLength(1);
 expect((await db.query<{e:string}>('select last_error e from radar_read_model_state')).rows[0].e).toBeTruthy();
 }finally{await db.close();}
},30000);
