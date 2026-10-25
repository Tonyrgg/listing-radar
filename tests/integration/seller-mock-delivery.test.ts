import {it,expect} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {sellerDb,inbound,login,owner,syntheticSubmission} from '../helpers/seller-db';
import {dispatchLocalMock} from '@/lib/seller-intake/mock-dispatcher';
it('mock persistente: lease, replay, perdita risposta, retry, chiusure e revoca senza messaggi',async()=>{
 const db=await sellerDb(['0050_seller_mock_delivery.sql']);
 const client={rpc:async(name:string,a:Record<string,unknown>)=>{
  const specs:Record<string,[string,unknown[]]>={
   claim_seller_mock_delivery:['select claim_seller_mock_delivery($1) v',[a.p_owner]],
   fail_seller_mock_delivery:['select fail_seller_mock_delivery($1,$2) v',[a.p_id,a.p_token]],
   deliver_seller_mock:['select deliver_seller_mock($1,$2) v',[a.p_id,a.p_token]],
  };
  try{const [sql,args]=specs[name];return {data:(await db.query<{v:unknown}>(sql,args)).rows[0].v,error:null};}catch(error){return {data:null,error};}
 }} as unknown as SupabaseClient;
 const claim=async()=>(await db.query<{v:{id:string;token:string}|null}>('select claim_seller_mock_delivery($1) v',[owner])).rows[0].v;
 try{
  const first=await inbound(db,'first');
  expect((await db.query('select * from seller_delivery_outbox')).rows).toHaveLength(1);
  expect(await dispatchLocalMock(client,owner,{mode:'local_mock'})).toEqual({state:'idle'});
  await db.query('select enable_seller_mock_deliveries($1)',[owner]);
  const a=await claim();expect(a).not.toBeNull();expect(await claim()).toBeNull();
  await db.query('select fail_seller_mock_delivery($1,$2)',[a!.id,a!.token]);
  expect((await db.query('select * from seller_cases where id=$1',[first])).rows).toHaveLength(1);
  await db.exec("update seller_delivery_outbox set next_attempt_at=now()-interval '1 second'");
  await expect(dispatchLocalMock(client,owner,{mode:'local_mock',simulateLostResponse:true})).rejects.toThrow('RESPONSE_LOSS');
  expect((await db.query('select * from seller_mock_receipts')).rows).toHaveLength(1);
  expect(await dispatchLocalMock(client,owner,{mode:'local_mock'})).toEqual({state:'idle'});
  const closed=await inbound(db,'closed');await db.query('select enable_seller_mock_deliveries($1)',[owner]);
  const old=await claim();await login(db);
  await db.query("select review_seller_case($1,0,'DO_NOT_CONTACT','NONE',null,'Opposizione sintetica')",[closed]);
  await db.exec('reset role');
  await expect(db.query('select deliver_seller_mock($1,$2)',[old!.id,old!.token])).rejects.toMatchObject({code:'40001'});
  expect((await db.query('select * from seller_mock_receipts')).rows).toHaveLength(1);
  const opted={...syntheticSubmission,externalId:'opted',whatsappOptIn:true};
  const optedId=(await db.query<{v:{id:string}}>('select receive_seller_submission($1,$2,$3,$4::jsonb) v',[owner,'local_test:opted','a'.repeat(64),JSON.stringify(opted)])).rows[0].v.id;
  await login(db);
  await db.query("select suppress_seller_channel($1,'WHATSAPP','Revoca sintetica del solo canale')",[optedId]);
  await expect(db.query('select enable_seller_mock_deliveries($1)',[owner])).rejects.toThrow();
  await db.exec('reset role');
  await db.query('select enable_seller_mock_deliveries($1)',[owner]);
  expect((await db.query<{status:string}>("select status from seller_delivery_outbox where case_id=$1 and channel='WHATSAPP'",[optedId])).rows[0].status).toBe('CANCELLED');
  const limited=await inbound(db,'limit');await db.query('select enable_seller_mock_deliveries($1)',[owner]);
  // Finish unrelated operator job, then exhaust exactly three attempts on the remaining job.
  for(let i=0;i<4;i++){
   const job=await claim();if(!job)break;
   const caseId=(await db.query<{case_id:string}>('select case_id from seller_delivery_outbox where id=$1',[job.id])).rows[0].case_id;
   if(caseId!==limited)await db.query('select deliver_seller_mock($1,$2)',[job.id,job.token]);
   else await db.query('select fail_seller_mock_delivery($1,$2)',[job.id,job.token]);
   await db.exec("update seller_delivery_outbox set next_attempt_at=now()-interval '1 second' where status='RETRY'");
  }
  expect((await db.query<{status:string;attempts:number}>('select status,attempts from seller_delivery_outbox where case_id=$1',[limited])).rows[0]).toEqual({status:'FAILED',attempts:3});
  expect(await claim()).toBeNull();
 }finally{await db.close();}
},30000);
