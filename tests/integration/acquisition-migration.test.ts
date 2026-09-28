import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const prerequisites = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key);
  create table public.clients(id uuid primary key default gen_random_uuid());
  create table public.locations(id uuid primary key default gen_random_uuid(),raw_text text,locality text);
  create table public.buildings(id uuid primary key default gen_random_uuid(),display_name text);
  create table public.properties(id uuid primary key default gen_random_uuid(),
    primary_location_id uuid,building_id uuid);
  create table public.property_requests(id uuid primary key default gen_random_uuid());
  create table public.events(id uuid primary key default gen_random_uuid(),
    property_id uuid not null,event_type text not null,occurred_at timestamptz not null,
    actor_type text,dedupe_key text unique,payload jsonb);
  create table public.private_publications(id uuid primary key default gen_random_uuid(),
    property_id uuid not null,state text not null,price_amount numeric,
    first_seen_at timestamptz not null,last_seen_at timestamptz not null);
  create function public.set_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end $$;
`;

describe("acquisition migration on PostgreSQL", () => {
  it("preserves buyers and deduplicates private market signals by property", async () => {
    const db = new PGlite();
    try {
      await db.exec(prerequisites);
      const request = await db.query<{ id: string }>("insert into property_requests default values returning id");
      const sql = await readFile(resolve(process.cwd(), "supabase/migrations/0010_acquisition_os.sql"), "utf8");
      await db.exec(sql);
      await db.exec("set role authenticated");
      try {
        const readable = await db.query<{ n: string }>(
          "select count(*)::text as n from acquisition_leads");
        expect(readable.rows[0].n).toBe("0");
        const queue = await db.query<{ n: string }>(
          "select count(*)::text as n from acquisition_today_queue");
        expect(queue.rows[0].n).toBe("0");
        await expect(db.query("select acquisition_kpis(now())")).rejects.toThrow();
        await expect(db.query(`insert into acquisition_leads(address,source_type)
          values('Via prova','smart_zone')`)).rejects.toThrow();
      } finally {
        await db.exec("reset role");
      }
      const buyer = await db.query<{ needs_to_sell_first: string }>(
        "select needs_to_sell_first from property_requests where id=$1", [request.rows[0].id]);
      expect(buyer.rows[0].needs_to_sell_first).toBe("unknown");

      const property = await db.query<{ id: string }>("insert into properties default values returning id");
      const propertyId = property.rows[0].id;
      const publication = await db.query<{ id: string }>(`
        insert into private_publications(property_id,state,price_amount,first_seen_at,last_seen_at)
        values($1,'ACTIVE',150000,'2026-09-28T08:00:00Z','2026-09-28T08:00:00Z') returning id`,[propertyId]);
      const initial = await db.query<{ lead_count: string; signal_count: string }>(`
        select (select count(*) from acquisition_leads where property_id=$1)::text as lead_count,
        (select count(*) from acquisition_signals where property_id=$1)::text as signal_count`,[propertyId]);
      expect(initial.rows[0]).toMatchObject({lead_count:"1",signal_count:"1"});

      await db.query(`update private_publications set price_amount=140000,
        last_seen_at='2026-09-29T08:00:00Z' where id=$1`,[publication.rows[0].id]);
      const afterCut = await db.query<{ lead_count: string; signal_count: string }>(`
        select (select count(*) from acquisition_leads where property_id=$1)::text as lead_count,
        (select count(*) from acquisition_signals where property_id=$1)::text as signal_count`,[propertyId]);
      expect(afterCut.rows[0]).toMatchObject({lead_count:"1",signal_count:"2"});
      const beforeReplay = await db.query<{ n: string }>(
        "select count(*)::text as n from acquisition_activities where lead_id=$1 and activity_type='system_signal'",
        [(await db.query<{ id: string }>("select id from acquisition_leads where property_id=$1",[propertyId])).rows[0].id]);
      const replayId = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0].id;
      const leadForReplay = (await db.query<{ id: string }>(
        "select id from acquisition_leads where property_id=$1",[propertyId])).rows[0].id;
      await db.query(`insert into acquisition_signals(lead_id,property_id,source_type,signal_type,dedupe_key)
        values($1,$2,'fsbo_radar','private_price_drop',$3)`, [leadForReplay,propertyId,`event:${replayId}`]);
      await db.query(`insert into events(id,property_id,event_type,occurred_at,actor_type,dedupe_key)
        values($1,$2,'PRIVATE_PRICE_DROP',now(),'SYSTEM',$3)`, [replayId,propertyId,`replay:${replayId}`]);
      const afterReplay = await db.query<{ n: string }>(
        "select count(*)::text as n from acquisition_activities where lead_id=$1 and activity_type='system_signal'",
        [leadForReplay]);
      expect(afterReplay.rows[0].n).toBe(beforeReplay.rows[0].n);
      await db.query("update private_publications set price_amount=140000 where id=$1",[publication.rows[0].id]);
      const samePrice = await db.query<{ n: string }>(
        "select count(*)::text as n from acquisition_signals where property_id=$1",[propertyId]);
      expect(samePrice.rows[0].n).toBe("3");

      const lead = await db.query<{ id: string }>(
        "select id from acquisition_leads where property_id=$1",[propertyId]);
      await expect(db.query(`insert into acquisition_leads(property_id,address,source_type)
        values($1,'Via prova','fsbo_radar')`,[propertyId])).rejects.toThrow();
      await db.query(`insert into acquisition_activities(lead_id,activity_type,outcome)
        values($1,'phone_call','conversation')`,[lead.rows[0].id]);
      await db.query(`update acquisition_leads set status='FOLLOW_UP',next_action_type='phone_call',
        next_action_at='2026-09-30T08:00:00Z' where id=$1`,[lead.rows[0].id]);
      const appointment = await db.query<{ id: string }>(`insert into acquisition_appointments(lead_id,scheduled_at)
        values($1,'2026-10-01T08:00:00Z') returning id`,[lead.rows[0].id]);
      await expect(db.query(`insert into acquisition_appointments(lead_id,scheduled_at)
        values($1,'2026-10-02T08:00:00Z')`,[lead.rows[0].id])).rejects.toThrow();
      await db.query("update acquisition_leads set status='ACQUISITION_BOOKED' where id=$1",[lead.rows[0].id]);
      await db.query(`update acquisition_appointments set outcome='mandate',completed_at='2026-10-01T09:00:00Z'
        where id=$1`,[appointment.rows[0].id]);
      await db.query("update acquisition_leads set status='WON' where id=$1",[lead.rows[0].id]);
      const won = await db.query<{ status: string; mandates: string }>(`
        select l.status,(select count(*)::text from acquisition_appointments where outcome='mandate') as mandates
        from acquisition_leads l where l.id=$1`,[lead.rows[0].id]);
      expect(won.rows[0]).toMatchObject({status:"WON",mandates:"1"});
      await db.query(`update private_publications set price_amount=130000,
        last_seen_at='2026-10-02T08:00:00Z' where id=$1`,[publication.rows[0].id]);
      const afterWon = await db.query<{ lead_count: string; signal_count: string }>(`
        select (select count(*) from acquisition_leads where property_id=$1)::text as lead_count,
        (select count(*) from acquisition_signals where property_id=$1)::text as signal_count`,[propertyId]);
      expect(afterWon.rows[0]).toMatchObject({lead_count:"1",signal_count:"4"});
      await db.query("update property_requests set needs_to_sell_first='yes',property_to_sell_id=$1 where id=$2",
        [propertyId,request.rows[0].id]);
      await db.query("update acquisition_leads set request_id=$1,next_action_type='phone_call',next_action_at='2026-09-30T08:00:00Z' where id=$2",
        [request.rows[0].id,lead.rows[0].id]);
      const linked = await db.query<{ needs_to_sell_first: string; request_id: string }>(`
        select r.needs_to_sell_first,l.request_id from acquisition_leads l
        join property_requests r on r.id=l.request_id where l.id=$1`,[lead.rows[0].id]);
      expect(linked.rows[0]).toMatchObject({needs_to_sell_first:"yes",request_id:request.rows[0].id});
      const secondRequest = await db.query<{ id: string }>(
        "insert into property_requests default values returning id");
      await db.query(`insert into acquisition_lead_requests(lead_id,request_id) values($1,$2),($1,$3)
        on conflict do nothing`,[lead.rows[0].id,request.rows[0].id,secondRequest.rows[0].id]);
      const linkedRequests = await db.query<{ n: string }>(
        "select count(*)::text as n from acquisition_lead_requests where lead_id=$1",[lead.rows[0].id]);
      expect(linkedRequests.rows[0].n).toBe("2");

      const agencyProperty = await db.query<{ id: string }>("insert into properties default values returning id");
      await db.query(`insert into events(property_id,event_type,occurred_at,actor_type,dedupe_key,payload)
        values($1,'PRICE_DROP',now(),'SYSTEM','agency-only-price-drop','{}')`,[agencyProperty.rows[0].id]);
      const agencyLeads = await db.query<{ n: string }>(
        "select count(*)::text as n from acquisition_leads where property_id=$1",[agencyProperty.rows[0].id]);
      expect(agencyLeads.rows[0].n).toBe("0");

      const location = await db.query<{ id: string }>(
        "insert into locations(raw_text,locality) values('Via test, Palombaio','Palombaio') returning id");
      const localProperty = await db.query<{ id: string }>(
        "insert into properties(primary_location_id) values($1) returning id",[location.rows[0].id]);
      await db.query(`insert into private_publications(property_id,state,price_amount,first_seen_at,last_seen_at)
        values($1,'ACTIVE',90000,now(),now())`,[localProperty.rows[0].id]);
      const localLead = await db.query<{ locality: string; address: string }>(
        "select locality,address from acquisition_leads where property_id=$1",[localProperty.rows[0].id]);
      expect(localLead.rows[0]).toMatchObject({locality:"Palombaio",address:"Via test, Palombaio"});

      await db.exec(`insert into acquisition_leads(address,source_type,status,priority,next_action_at)
        select 'Follow-up ' || n,'smart_zone','FOLLOW_UP','B',now() - interval '1 day'
        from generate_series(1,60) n`);
      const booked = await db.query<{ id: string }>(`insert into acquisition_leads
        (address,source_type,status,priority,next_action_at)
        values('Appuntamento prioritario','smart_zone','ACQUISITION_BOOKED','C',now()) returning id`);
      const firstPage = await db.query<{ id: string; queue_rank: number }>(`
        select id,queue_rank from acquisition_today_queue
        order by queue_rank,next_action_at nulls last,id limit 50`);
      const secondPage = await db.query<{ id: string }>(`
        select id from acquisition_today_queue
        order by queue_rank,next_action_at nulls last,id limit 50 offset 50`);
      expect(firstPage.rows).toHaveLength(50);
      expect(firstPage.rows[0]).toMatchObject({id:booked.rows[0].id,queue_rank:0});
      expect(secondPage.rows.length).toBeGreaterThan(0);
      expect(new Set([...firstPage.rows,...secondPage.rows].map(row=>row.id)).size)
        .toBe(firstPage.rows.length+secondPage.rows.length);

      await db.query(`insert into acquisition_signals(lead_id,source_type,signal_type)
        select $1,'smart_zone','street_observation' from generate_series(1,1001)`, [booked.rows[0].id]);
      const kpi = await db.query<{ snapshot: {
        metrics: {new_signals: number; mandates: number};
        sources: {name: string; count: number}[];
      } }>("select acquisition_kpis('2020-01-01T00:00:00Z') as snapshot");
      expect(kpi.rows[0].snapshot.metrics.new_signals).toBeGreaterThan(1000);
      expect(kpi.rows[0].snapshot.metrics.mandates).toBe(1);
      expect(kpi.rows[0].snapshot.sources.find(x=>x.name === "smart_zone")?.count).toBe(1001);
    } finally {
      await db.close();
    }
  });
});
