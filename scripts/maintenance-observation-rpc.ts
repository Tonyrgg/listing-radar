import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
/** Explicit maintenance only: repeat the same atomic RPC after transaction cancellation. */
export function installMaintenanceObservationRetry(db:SupabaseClient){
 const rpc=db.rpc.bind(db);
 db.rpc=((name:string,args?:Record<string,unknown>)=>{
  const request=rpc(name,args);if(name!=='persist_property_lifecycle_observation_atomic')return request;
  return Promise.resolve(request).then(result=>{
   if(result.error?.code!=='57014')return result;
   const quote=(v:unknown,json=false)=>v==null?'null':"'"+(json?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
   const parts=['p_agency_id','p_sync_run_id','p_listing','p_identity_decision','p_processed_assets','p_location_normalized_key','p_building','p_media_market_start','p_failure_point'].map(k=>quote(args?.[k],['p_listing','p_identity_decision','p_processed_assets','p_building','p_media_market_start'].includes(k)));
   writeFileSync('.runtime/pin-fix/timeout-observation.sql',`begin;set local statement_timeout='55s';drop table if exists pg_temp.maintenance_observation_result;create temp table maintenance_observation_result on commit preserve rows as select public.persist_property_lifecycle_observation_atomic(${parts.join(',')}) as result;commit;select result from maintenance_observation_result;`);
   try{const output=execFileSync('powershell.exe',['-NoProfile','-Command','& npx.cmd supabase db query --linked --project-ref eqqmglsxwbsihrlecnun --file .runtime/pin-fix/timeout-observation.sql'],{encoding:'utf8',windowsHide:true,timeout:75000,maxBuffer:1024*1024});const parsed=JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1));if(parsed.rows?.[0]?.result)return{data:parsed.rows[0].result,error:null};if(parsed.error)console.warn('Maintenance retry: '+parsed.error.message);}catch(error){console.warn('Maintenance retry failed: '+(error instanceof Error?error.message:'unknown error'));}
   return result;
  });
 }) as typeof db.rpc;
}
