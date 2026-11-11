import {createClient}from'@supabase/supabase-js';
import{describe,it,expect}from'vitest';
import{SharedActivityWriteGuard}from'../src/territory/activity-write-guard.js';
const config={url:'http://127.0.0.1:54321',key:'test',workspaceId:'fd2503de-cf17-4ed5-bac1-65a5c6d269ce',ownerId:'be0e3d14-4b90-41b9-83b5-43a683fc2523',profileKind:'live'as const};
const claim={clientTaxCode:'RSSMRA80A01A662A',day:'2026-11-10',operationId:'00000000-0000-4000-8000-000000000001'};
describe('shared activity write guard',()=>{
 it('uses the configured workspace and hashes the customer identity',async()=>{
  let submitted:Record<string,unknown>={};
  const db=createClient(config.url,config.key,{auth:{persistSession:false},global:{fetch:async(input,init)=>{const request=new Request(input,init);submitted=await request.json();return new Response(JSON.stringify({granted:true,submitted:false,proof:null}),{headers:{'content-type':'application/json'}});}}});
  await new SharedActivityWriteGuard(db,config).reserve(claim);
  expect(submitted).toMatchObject({p_workspace_id:config.workspaceId,p_owner_id:config.ownerId,p_action:'reserve',p_day:claim.day});
  expect(submitted.p_client_key).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(submitted)).not.toContain(claim.clientTaxCode);
 });
 it('does not authorise an activity if the shared guard is unavailable or the schema is missing',async()=>{
  for(const code of ['PGRST202','PGRST000']){
   const db=createClient(config.url,config.key,{auth:{persistSession:false},global:{fetch:async()=>new Response(JSON.stringify({code,message:'unavailable'}),{status:400,headers:{'content-type':'application/json'}})}});
   await expect(new SharedActivityWriteGuard(db,config).reserve(claim)).rejects.toThrow();
  }
 });
});
