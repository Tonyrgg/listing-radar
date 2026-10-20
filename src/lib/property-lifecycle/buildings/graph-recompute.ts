import type {SupabaseClient} from '@supabase/supabase-js';
import {resolveLocation,resolveRecord,type GraphRecord,type LocationInput} from './territorial-graph';
import type {RegistryStreet} from './territorial-extraction';
async function all<T>(db:SupabaseClient,table:string,fields:string){const out:T[]=[];for(let from=0;;from+=500){const r=await db.from(table).select(fields).order('id').range(from,from+499);if(r.error)throw Error(`${table}: ${r.error.message}`);out.push(...r.data as T[]);if(r.data.length<500)return out;}}
/** No source fetch, property creation, merge, coordinate update or history rewrite. */
export async function recomputeTerritorialGraph(db:SupabaseClient,apply=false){
 const [streets,locations,buildings,records]=await Promise.all([
  all<RegistryStreet&{record_status:string}>(db,'street_registry_streets','id,canonical_name,official_type,official_description,locality,record_status'),
  all<LocationInput>(db,'locations','id,municipality,locality,street_name,street_number,scope_state'),
  all<{id:string;location_id:string|null}>(db,'buildings','id,location_id'),
  all<GraphRecord>(db,'market_observer_public_records','id,source_key,record_type,content_hash,area_name,addresses,territorial_references,cadastral_references,building_ids'),
 ]);
 const official=streets.filter(s=>s.record_status==='active'),resolvedLocations=locations.map(l=>resolveLocation(l,official));
 const resolvedRecords=records.map(r=>resolveRecord(r,official,buildings,resolvedLocations));
 const causes:Record<string,number>={};resolvedRecords.forEach(r=>{if(r.unmatchedCause)causes[r.unmatchedCause]=(causes[r.unmatchedCause]??0)+1;});
 let links=0;if(apply){
  for(let i=0;i<resolvedLocations.length;i+=100){const r=await db.rpc('recompute_territorial_graph',{p_locations:resolvedLocations.slice(i,i+100),p_records:[]});if(r.error)throw Error(r.error.message);}
  for(let i=0;i<resolvedRecords.length;i+=100){const r=await db.rpc('recompute_territorial_graph',{p_locations:[],p_records:resolvedRecords.slice(i,i+100)});if(r.error)throw Error(r.error.message);links+=r.data.newBuildingLinks;}
 }
 return {applied:apply,locations:resolvedLocations.length,resolvedLocations:resolvedLocations.filter(l=>l.status==='RESOLVED').length,records:resolvedRecords.length,newBuildingLinks:links,unmatchedCauses:causes};
}
