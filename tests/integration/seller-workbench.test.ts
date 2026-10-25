import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ingestSellerSubmission } from '@/lib/seller-intake/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
const owner='10000000-0000-4000-8000-000000000001', other='20000000-0000-4000-8000-000000000002';
const submission={externalId:'test',formVersion:'seller_v1',name:'Persona fittizia',phone:'+390000000000',answers:{situation:'considering_sale',role:'owner',locality:'Bitonto',propertyType:'apartment',timing:'undecided'},callbackRequested:true,whatsappOptIn:false,privacyVersion:'local-test',attribution:{source:'local_test'}};
it('real SQL: intake, replay, privacy, outcomes, suppression and isolated document verification', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated,service_role;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${other}');
      create function public.assert_public_news_candidate(p_id uuid) returns void language sql as $$select null::void$$;
      create table public.public_record_news_feedback(candidate_id uuid,user_id uuid,status text,source_signature text);
      insert into public_record_news_feedback values ('30000000-0000-4000-8000-000000000003','${owner}','INTERESTING','sig');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    await db.exec(await readFile('supabase/migrations/0046_seller_workbench.sql','utf8'));
    const client={rpc:async(name:string,args:Record<string,unknown>)=>{
      expect(name).toBe('receive_seller_submission');
      try { const r=await db.query<{result:{id:string;duplicate:boolean}}>('select public.receive_seller_submission($1::uuid,$2,$3,$4::jsonb) as result',[args.p_owner,args.p_external,args.p_signature,JSON.stringify(args.p_submission)]);return {data:r.rows[0].result,error:null}; }
      catch(error){return {data:null,error};}
    }} as unknown as SupabaseClient;
    const first=await ingestSellerSubmission(client,owner,submission);
    expect(first.duplicate).toBe(false);
    expect(await ingestSellerSubmission(client,owner,submission)).toEqual({...first,duplicate:true});
    await expect(ingestSellerSubmission(client,owner,{...submission,name:'Conflicting body'})).rejects.toThrow();
    const counts=async()=> (await db.query<{n:number}>('select count(*)::int as n from seller_delivery_outbox')).rows[0].n;
    expect(await counts()).toBe(1); // no WhatsApp permission, no job
    const opted=await ingestSellerSubmission(client,owner,{...submission,externalId:'opted',whatsappOptIn:true});
    expect(await counts()).toBe(3);
    await db.exec(`set role anon;`); await expect(db.query('select * from seller_cases')).rejects.toThrow();
    await expect(db.query('select receive_seller_submission($1::uuid,$2,$3,$4::jsonb)',[owner,'bad','a'.repeat(64),'{}'])).rejects.toThrow();
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${other}';`);
    expect((await db.query('select * from seller_cases')).rows).toHaveLength(0);
    expect((await db.query('select * from seller_case_history')).rows).toHaveLength(0);
    expect((await db.query('select * from seller_delivery_outbox')).rows).toHaveLength(0);
    await expect(db.query('select review_seller_case($1,0,\'CLOSED\',\'NONE\',null,\'No access\')',[first.id])).rejects.toThrow();
    await db.exec(`set request.jwt.claim.sub='${owner}';`);
    expect((await db.query('select * from seller_cases')).rows).toHaveLength(2);
    await expect(db.query('update seller_cases set status=\'MANDATE\'')).rejects.toThrow();
    await db.query('select review_seller_case($1,0,\'TO_CALL\',\'CALL\',$2,\'Telefono da verificare\')',[first.id,'2026-10-26T09:00:00Z']);
    await expect(db.query('select review_seller_case($1,0,\'CONTACTED\',\'CALL\',now(),\'Stale\')',[first.id])).rejects.toMatchObject({code:'40001'});
    await db.query('select review_seller_case($1,0,\'DO_NOT_CONTACT\',\'NONE\',null,\'Opposizione registrata\')',[opted.id]);
    await expect(db.query('select review_seller_case($1,1,\'TO_CALL\',\'CALL\',now(),\'Reopen\')',[opted.id])).rejects.toThrow();
    expect((await db.query('select * from seller_delivery_outbox where case_id=$1 and status=\'CANCELLED\'',[opted.id])).rows).toHaveLength(2);
    await expect(db.query('select plan_seller_verification(\'news:30000000-0000-4000-8000-000000000003\',\'changed\',\'Stale proof\',\'{}\')')).rejects.toMatchObject({code:'40001'});
    const plan=async()=> (await db.query<{id:string}>('select plan_seller_verification(\'news:30000000-0000-4000-8000-000000000003\',\'sig\',\'Controllare un cantiere\',\'{}\') as id')).rows[0].id;
    const task=await plan(); expect(await plan()).toBe(task);
    await expect(db.query('select review_seller_case($1,0,\'TO_CALL\',\'CALL\',now(),\'Inferred owner\')',[task])).rejects.toThrow();
    await db.query('select review_seller_case($1,0,\'IN_REVIEW\',\'VERIFY\',now(),\'Civico non risolto\')',[task]);
    await db.query('select review_seller_case($1,1,\'CONTACTED\',\'FOLLOW_UP\',now(),\'Conversazione sintetica registrata\')',[first.id]);
    await db.query('select review_seller_case($1,2,\'APPOINTMENT\',\'VISIT\',now(),\'Appuntamento sintetico concordato\')',[first.id]);
    await db.query('select review_seller_case($1,3,\'VALUATION\',\'FOLLOW_UP\',now(),\'Valutazione sintetica svolta\')',[first.id]);
    await db.query('select review_seller_case($1,4,\'MANDATE\',\'NONE\',null,\'Incarico sintetico registrato\')',[first.id]);
    expect((await db.query<{m:unknown}>('select seller_workbench_metrics() as m')).rows[0].m)
      .toEqual({received:2,verifications:1,contacted:1,appointments:1,valuations:1,mandates:1});
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    expect((await db.query<{m:{received:number}}> ('select seller_workbench_metrics() as m')).rows[0].m.received).toBe(0);
    await db.exec(`set request.jwt.claim.sub='${owner}';`);
    await db.exec('reset role');
    await ingestSellerSubmission(client,owner,{...submission,externalId:'opted',whatsappOptIn:true});
    expect((await db.query<{status:string}>('select status from seller_cases where id=$1',[opted.id])).rows[0].status).toBe('DO_NOT_CONTACT');
    expect((await db.query('select * from seller_case_history where case_id=$1',[first.id])).rows).toHaveLength(6);
    expect((await db.query('select * from seller_delivery_outbox where status=\'SENT\'')).rows).toHaveLength(0);
  } finally {await db.close();}
},30000);
