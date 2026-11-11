import {it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";

it("atomically records a manual sale and moves the live archive before the materialized snapshot refreshes",async()=>{
 const db=new PGlite();
 const property="00000000-0000-0000-0000-000000000001",user="00000000-0000-0000-0000-000000000002";
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key);insert into auth.users values('${user}');
   create table properties(id uuid primary key,property_id uuid,row_id text,sale_status text,property_state text,state text,exit_classification text,opportunity_score numeric,latest_asking_price numeric,surface_sqm numeric,last_seen_at timestamptz,sold_at timestamptz,sold_observed_at timestamptz,classified_at timestamptz,exit_confidence numeric,reasons jsonb);
   insert into properties values('${property}','${property}','one','UNKNOWN','ACTIVE_AGENCY','ACTIVE','ACTIVE',75,100000,100,now(),null,null,null,null,'[]');
   create table manual_overrides(id uuid primary key default gen_random_uuid(),target_type text,target_id uuid,override_key text,override_value jsonb,previous_value jsonb,reason text,source text,created_by uuid references auth.users(id),supersedes_id uuid,effective_at timestamptz default now(),created_at timestamptz default now());
   create unique index supersedes_unique on manual_overrides(supersedes_id);
   create table agency_listings(id uuid,agency_id uuid,property_id uuid,state text);insert into agency_listings values(gen_random_uuid(),gen_random_uuid(),'${property}','ACTIVE');
   create table private_publications(property_id uuid,state text);
   create table events(id uuid default gen_random_uuid(),property_id uuid,event_type text,occurred_at timestamptz,confidence numeric,actor_type text,dedupe_key text unique,payload jsonb);
   create view market_observer_graph_property_archive as select property_id,row_id,sale_status,property_state,state,exit_classification,opportunity_score,latest_asking_price,surface_sqm,last_seen_at,sold_at,sold_observed_at,classified_at,exit_confidence,reasons from properties;`);
  await db.exec(await readFile("supabase/migrations/0083_radar_indexed_read_model.sql","utf8"));
  await db.exec(await readFile("supabase/migrations/0087_radar_instant_sale_decisions.sql","utf8"));
  const decide=(status:string)=>db.query("select record_radar_sale_decision($1,$2,$3,$4)",[property,status,"Conferma del proprietario",user]);
  await decide("SOLD_CONFIRMED");
  const row=(await db.query<Record<string,unknown>>("select * from radar_property_live_archive")).rows[0];
  expect(row).toMatchObject({sale_status:"SOLD_CONFIRMED",property_state:"SOLD",state:"CLOSED_SOLD",exit_classification:"SOLD_CONFIRMED",sold_at:null});
  expect(Number(row.opportunity_score)).toBe(0);expect(row.sold_observed_at).toBeTruthy();
  expect((await db.query("select * from radar_property_live_archive where opportunity_score>0 and exit_classification not in ('SOLD_CONFIRMED','SOLD_PROBABLE')")).rows).toHaveLength(0);
  expect((await db.query("select * from radar_property_live_archive where exit_classification='SOLD_CONFIRMED'")).rows).toHaveLength(1);
  expect((await db.query<{s:string}>("select sale_status s from radar_property_read_model")).rows[0].s).toBe("UNKNOWN");
  expect((await db.query<{s:string}>("select state s from agency_listings")).rows[0].s).toBe("ACTIVE");
  await decide("NOT_SOLD_CONFIRMED");
  expect((await db.query("select sale_status,property_state,exit_classification from radar_property_live_archive")).rows[0]).toMatchObject({sale_status:"NOT_SOLD_CONFIRMED",property_state:"ACTIVE_AGENCY",exit_classification:"ACTIVE"});
  expect((await db.query("select * from manual_overrides where supersedes_id is not null")).rows).toHaveLength(1);
  await expect(decide("INVALID")).rejects.toThrow("Unsupported");
  await db.exec("create function fail_event() returns trigger language plpgsql as $$begin raise exception 'forced event failure';end$$;create trigger fail_event before insert on events for each row execute function fail_event()");
  await expect(decide("SOLD_CONFIRMED")).rejects.toThrow("forced event failure");
  expect((await db.query("select * from manual_overrides")).rows).toHaveLength(2);
  expect((await db.query<{s:string}>("select sale_status s from properties")).rows[0].s).toBe("NOT_SOLD_CONFIRMED");
 }finally{await db.close();}
},30000);
