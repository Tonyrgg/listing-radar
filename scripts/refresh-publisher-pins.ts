import {installMaintenanceObservationRetry} from './maintenance-observation-rpc';
import {mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createPropertyLifecycleAdapter} from '../src/lib/property-lifecycle/adapters/registry';
import {PropertyLifecycleRepository,type SyncRunCounts} from '../src/lib/property-lifecycle/persistence/repository';
import {pinAddressKey} from '../src/lib/property-lifecycle/persistence/pin-address';
async function main(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;if(!url||!key)throw Error('Missing configuration');
 const apply=process.argv.includes('--apply');if(apply&&!process.argv.includes(`--confirm-project=${new URL(url).hostname.split('.')[0]}`))throw Error('Target confirmation required');
 const db=createClient(url,key,{auth:{persistSession:false}});if(apply&&process.argv.includes('--long-timeout'))installMaintenanceObservationRetry(db);const repo=new PropertyLifecycleRepository(db);const results=[];let lastRequest=0;
 for(const adapterKey of ['vistocasa','futura'].filter(k=>!process.argv.some(a=>a.startsWith('--agency='))||process.argv.includes(`--agency=${k}`))){
 const adapter=createPropertyLifecycleAdapter(adapterKey),agency=await repo.getAgencyBySlug(adapter.agencySlug),inventory=await adapter.fetchInventory();if(inventory.healthState==='FAILED')throw Error(`${adapterKey} inventory failed`);
 const selectedItems=inventory.items.filter(i=>!process.argv.some(a=>a.startsWith('--only-id='))||process.argv.includes(`--only-id=${i.externalId}`));
const run=apply?await repo.createSyncRun({agencyId:agency.id,adapterKey,mode:'SYNC'}):null;
 const counts:SyncRunCounts={discoveredCount:selectedItems.length,normalizedCount:0,inScopeCount:0,excludedCount:0,errorCount:0,missingCount:0,transitionedCount:0};const observed=[];const rows=[];
 for(const item of selectedItems){try{
 const listing=await adapter.normalize(await adapter.fetchDetail(item));counts.normalizedCount++;
 if(listing.location.scope!=='IN_SCOPE'){counts.excludedCount++;continue;}counts.inScopeCount++;
 const lat=listing.location.latitude,lon=listing.location.longitude;
 if(apply&&listing.provenance.publishedMapPin&&lat!==null&&lon!==null){const pin_key=pinAddressKey(lat,lon),existing=await db.from('publisher_pin_address_cache').select('pin_key').eq('pin_key',pin_key).maybeSingle();if(existing.error)throw existing.error;
 if(!existing.data){await new Promise(r=>setTimeout(r,Math.max(0,1100-(Date.now()-lastRequest))));lastRequest=Date.now();const endpoint=new URL(process.env.PUBLISHER_PIN_GEOCODER_URL??'https://nominatim.openstreetmap.org/reverse');endpoint.search=new URLSearchParams({lat:String(lat),lon:String(lon),format:'jsonv2',zoom:'18',addressdetails:'1'}).toString();const response=await fetch(endpoint,{headers:{'User-Agent':'ListingRadar/2.0 personal one-time publisher-pin verification (+https://listing-radar-mu.vercel.app)'},signal:AbortSignal.timeout(12000)});if(response.status===429||response.status===403)throw Error('Geocoder refused: stop lookup');if(!response.ok)throw Error(`Geocoder HTTP ${response.status}`);const raw=await response.json();const payload={address:raw.address??{},lat:raw.lat,lon:raw.lon,osm_type:raw.osm_type,osm_id:raw.osm_id,licence:raw.licence};const saved=await db.from('publisher_pin_address_cache').upsert({pin_key,payload},{onConflict:'pin_key'});if(saved.error)throw saved.error;}}
 if(apply){const saved=await repo.persistObservation(agency.id,run!,listing,[]);rows.push({id:item.externalId,propertyId:saved.propertyId,pin:listing.provenance.publishedMapPin,sourceUrl:item.url});}observed.push(item.sourceKey);
 }catch(e){counts.errorCount++;rows.push({id:item.externalId,error:e instanceof Error?e.message:String(e)});console.log(JSON.stringify({agency:adapterKey,id:item.externalId,error:e instanceof Error?e.message:String(e)}));if(String(e).includes('Geocoder refused'))throw e;}
 if((counts.normalizedCount+counts.errorCount)%10===0)console.log(JSON.stringify({agency:adapterKey,counts}));}
 if(apply){await repo.finalizeSyncRun({syncRunId:run!,status:counts.errorCount?'PARTIAL':'SUCCEEDED',observedSourceKeys:observed,finishedAt:new Date().toISOString(),healthState:counts.errorCount?'DEGRADED':'HEALTHY',inventoryComplete:false,absenceEvaluationAllowed:false,expectedCount:null,counts,structureFingerprint:inventory.structureFingerprint,diagnostics:{positivePublisherPinRefresh:true,absenceAuthoritative:false}});}
 results.push({agency:adapterKey,run,counts,rows});await mkdir('.runtime/pin-fix',{recursive:true});await writeFile(process.argv.find(a=>a.startsWith('--report='))?.slice(9)??'.runtime/pin-fix/refresh-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({agency:adapterKey,complete:true,counts}));
 }
 if(apply){const r=await db.rpc('refresh_radar_read_model');if(r.error)throw r.error;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
