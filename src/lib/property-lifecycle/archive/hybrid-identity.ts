import type {SupabaseClient} from '@supabase/supabase-js';
import {readArchivedIdentity,type ArchiveSql} from './external-fingerprints';
export type IdentityValue={property_id:string;algorithm:string;fingerprint:string};
export type IdentityValues={images:IdentityValue[];plans:IdentityValue[]};

/** Explicit opt-in only. Failure of either database is not an empty history. */
export function hybridIdentityReader(supabase:SupabaseClient,external:ArchiveSql,source:string){
 return async(ids:string[]):Promise<IdentityValues>=>{
  if(!ids.length)return {images:[],plans:[]};
  const historical=await readArchivedIdentity(external,source,ids);
  async function current(table:string){
   const rows:Record<string,unknown>[]=[];
   for(let from=0;;from+=1000){
    const result=await supabase.from(table).select('id,property_id,algorithm,fingerprint').in('property_id',ids).order('id').range(from,from+999);
    if(result.error||!Array.isArray(result.data))throw Error('Hybrid fingerprint source incomplete');
    rows.push(...result.data);if(result.data.length<1000)return rows;
   }
  }
  const [images,plans]=await Promise.all([current('image_fingerprint_current'),current('floorplan_fingerprints')]);
  function distinct(rows:Record<string,unknown>[]){
   const map=new Map<string,IdentityValue>();
   for(const row of rows){
    if(typeof row.property_id!=='string'||!ids.includes(row.property_id)||typeof row.algorithm!=='string'||typeof row.fingerprint!=='string')throw Error('Invalid hybrid fingerprint identity');
    const value={property_id:row.property_id,algorithm:row.algorithm,fingerprint:row.fingerprint};
    map.set(JSON.stringify([value.property_id,value.algorithm,value.fingerprint]),value);
   }
   return [...map.values()];
  }
  return {images:distinct([...images,...historical]),plans:distinct(plans)};
 };
}
