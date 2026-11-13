import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {VistocasaAdapter} from '../src/lib/property-lifecycle/adapters/vistocasa';
import type {InventoryItem} from '../src/lib/property-lifecycle/adapters/types';
import {PropertyLifecycleRepository,type SyncRunCounts} from '../src/lib/property-lifecycle/persistence/repository';

/** Positive detail refresh: includes known historical URLs; never evaluates absence. */
async function main(){
 const apply=process.argv.includes('--apply');
 const confirmed=process.argv.find(v=>v.startsWith('--confirm-project='))?.split('=')[1];
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
 if(!url||!key)throw Error('Supabase configuration required');
 const project=new URL(url).hostname.split('.')[0];
 if(apply&&confirmed!==project)throw Error('Explicit matching --confirm-project required');
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const adapter=new VistocasaAdapter(),repo=new PropertyLifecycleRepository(db);
 const agency=await repo.getAgencyBySlug(adapter.agencySlug);
 const inventory=await adapter.fetchInventory();
 if(!inventory.items.length||inventory.healthState==='FAILED')throw Error('Inventory unavailable; no data changed');
 const known=await db.from('publications').select('source_key,external_id,canonical_url').eq('agency_id',agency.id);
 if(known.error)throw known.error;
 const items=new Map<string,InventoryItem>(inventory.items.map(item=>[item.externalId,item]));
 for(const publication of known.data??[]){
  const current=items.get(publication.external_id);
  items.set(publication.external_id,{sourceKey:publication.source_key,externalId:publication.external_id,url:publication.canonical_url,summary:current?.summary??{}});
 }
 const resume=process.argv.find(v=>v.startsWith('--resume-run='))?.split('=')[1];
 if(resume){
  if(!apply)throw Error('Resume requires --apply');
  const prior=await db.from('sync_runs').select('agency_id,status').eq('id',resume).single();
  if(prior.error||prior.data.agency_id!==agency.id||prior.data.status!=='RUNNING')throw Error('Resume run is not an open run of this agency');
 }
 const syncRunId=apply?resume??await repo.createSyncRun({agencyId:agency.id,adapterKey:adapter.key,mode:'SYNC'}):null;
 const counts:SyncRunCounts={discoveredCount:items.size,normalizedCount:0,inScopeCount:0,excludedCount:0,errorCount:0,missingCount:0,transitionedCount:0};
 const rows:Array<Record<string,unknown>>=[];
 const observed:string[]=[];
 console.log(JSON.stringify({phase:'start',apply,syncRunId,currentInventory:inventory.items.length,knownPublications:known.data.length,total:items.size}));
 for(const item of items.values()){
  try{
   const listing=await adapter.normalize(await adapter.fetchDetail(item));counts.normalizedCount++;
   const detailPin=listing.provenance.publishedMapPin;
   const row:Record<string,unknown>={externalId:item.externalId,url:item.url,inCurrentInventory:inventory.items.some(i=>i.externalId===item.externalId),scope:listing.location.scope,detailPin:Boolean(detailPin),latitude:listing.location.latitude,longitude:listing.location.longitude,precision:listing.location.precision,status:listing.status.value};
   if(listing.location.scope==='IN_SCOPE'){
    counts.inScopeCount++;
    if(apply){
     const saved=await repo.persistObservation(agency.id,syncRunId!,listing,[]);
     row.propertyId=saved.propertyId;row.persisted=!('deferred'in saved&&saved.deferred);
     if('createdPublication'in saved&&saved.createdPublication)counts.transitionedCount++;
     observed.push(listing.source.sourceKey);
    }
   }else counts.excludedCount++;
   rows.push(row);
  }catch(error){counts.errorCount++;rows.push({externalId:item.externalId,url:item.url,error:error instanceof Error?error.message:String(error)});}
  if(rows.length%10===0||rows.length===items.size)console.log(JSON.stringify({phase:'progress',checked:rows.length,total:items.size,errors:counts.errorCount}));
 }
 if(apply){
  await repo.finalizeSyncRun({syncRunId:syncRunId!,status:counts.errorCount?'PARTIAL':'SUCCEEDED',observedSourceKeys:observed,finishedAt:new Date().toISOString(),healthState:counts.errorCount?'DEGRADED':'HEALTHY',inventoryComplete:false,absenceEvaluationAllowed:false,expectedCount:null,counts,structureFingerprint:inventory.structureFingerprint,diagnostics:{positiveMapAudit:true,historicalUrlsIncluded:true,absenceAuthoritative:false}});
  const refreshed=await db.rpc('refresh_radar_read_model');if(refreshed.error)throw refreshed.error;
 }
 const report={generatedAt:new Date().toISOString(),apply,syncRunId,currentInventory:inventory.items.length,knownPublications:known.data.length,counts,detailPins:rows.filter(r=>r.detailPin).length,persisted:rows.filter(r=>r.persisted).length,rows};
 const output=path.resolve('.runtime/vistocasa-map-audit.json');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({phase:'complete',...report,rows:undefined,report:output}));
 if(counts.errorCount)process.exitCode=2;
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
