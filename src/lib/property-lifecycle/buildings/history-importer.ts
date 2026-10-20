import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AlboHttp,parseAlboDetail} from './albo';
import {readRegistryStreets} from './albo-importer';
import {prepareAlboRecord} from './albo-record';
import {HISTORY_POLICY,historicalInventory,historyItem,resumeHistoricalCheckpoint,validateHistoricalPlan,type HistoricalPlan} from './historical-albo';
import {PUBLIC_RECORD_POLICY as P} from './public-record-policy';
import {recomputeTerritorialGraph} from './graph-recompute';
type Checkpoint={manifest?:string;done?:string[];plan?:HistoricalPlan};
/** Explicit year, one lease, bounded atomic commits. Errors stop this year and the caller. */
export async function importHistoricalYear(db:SupabaseClient,year:number,options:{fetcher?:typeof fetch;delayMs?:number;acceptedManifest?:string;refreshInventory?:boolean;inventoryPlan?:HistoricalPlan;onProgress?:(p:Record<string,unknown>)=>void}={}){
 const token=randomUUID(),claim=await db.rpc('claim_public_record_history',{p_year:year,p_token:token});if(claim.error)throw Error(claim.error.message);
 const run=claim.data as {id:string;checkpoint:Checkpoint};let checkpoint=run.checkpoint??{},metrics:Record<string,unknown>={policy:HISTORY_POLICY.version,year,inventoryComplete:false};
 const commit=async(records:ReturnType<typeof prepareAlboRecord>[]=[],seen:string[]=[],finish=false,error:string|null=null)=>{const r=await db.rpc('commit_public_record_history',{p_run:run.id,p_token:token,p_records:records,p_seen:seen,p_checkpoint:checkpoint,p_metrics:metrics,p_finish:finish,p_error:error});if(r.error)throw Error(r.error.message);return r.data as {inserted:number;updated:number;links:number};};
 try{
  const streets=await readRegistryStreets(db);if(!streets.length)throw Error('Official street registry unavailable');
  const http=new AlboHttp(options.fetcher,options.delayMs),saved=options.inventoryPlan??(!options.refreshInventory?checkpoint.plan:null);
  const inventory=saved?validateHistoricalPlan(saved,year):await historicalInventory(http,year,streets,async p=>{metrics={...metrics,...p,inventoryComplete:false};await commit();options.onProgress?.({year,stage:'inventory',...p});});
  checkpoint={...resumeHistoricalCheckpoint(checkpoint,inventory.manifest,options.acceptedManifest),plan:inventory};const done=new Set(checkpoint.done);
  metrics={...metrics,scanned:inventory.total,pages:inventory.pages,candidates:inventory.candidates.length,fingerprint:inventory.fingerprint,inventoryComplete:true,inventoryObservedAt:inventory.inventoryObservedAt??null,resumedFrozenInventory:!!saved,processed:done.size};
  await commit();
  const prior=new Map<string,{id:string;marker:string|null}>();
  for(let from=0;;from+=500){const r=await db.from('building_practice_records').select('id,source_record_key,metadata').eq('source_key',P.alboSource).order('id').range(from,from+499);if(r.error)throw Error(r.error.message);r.data.forEach(r=>prior.set(r.source_record_key,{id:r.id,marker:r.metadata?.inventoryMarker??null}));if(r.data.length<500)break;}
  let batch:ReturnType<typeof prepareAlboRecord>[]=[],seen:string[]=[],pending:string[]=[],inserted=0,updated=0,details=0;
  const flush=async()=>{const durable=checkpoint;checkpoint={...checkpoint,done:[...done,...pending].sort()};metrics={...metrics,processed:checkpoint.done!.length,detailFetches:details};let r;try{r=await commit(batch,seen);}catch(e){checkpoint=durable;metrics={...metrics,processed:durable.done?.length??0};throw e;}inserted+=r.inserted;updated+=r.updated;pending.forEach(id=>done.add(id));batch=[];seen=[];pending=[];options.onProgress?.({year,stage:'details',processed:done.size,candidates:inventory.candidates.length,inserted,updated});};
  for(const c of inventory.candidates){if(done.has(c.id))continue;const old=prior.get(c.id);
   if(old?.marker===c.marker){seen.push(old.id);}else{
    const detail=parseAlboDetail(await http.get(c.url),c.id);details++;
    batch.push(prepareAlboRecord(historyItem(c,detail.subject),detail,streets,new Date().toISOString()));
   }
   pending.push(c.id);if(pending.length>=HISTORY_POLICY.batchSize)await flush();
  }
  if(pending.length)await flush();
  const graph=await recomputeTerritorialGraph(db,true);metrics={...metrics,graph};await commit([],[],true);
  return {year,scanned:inventory.total,candidates:inventory.candidates.length,processed:done.size,detailFetches:details,inserted,updated,graph};
 }catch(error){const reason=error instanceof Error?error.message:'Historical processing failed';
  // Committed partial batches still receive the conservative projection, even if the source stops.
  try{metrics={...metrics,graph:await recomputeTerritorialGraph(db,true)};}catch{metrics={...metrics,graphPending:true};}
  await commit([],[],false,reason).catch(()=>{});throw error;}
}
