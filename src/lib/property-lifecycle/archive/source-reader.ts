import type {SupabaseClient}from'@supabase/supabase-js';
import {validateArchiveGroup,type ArchiveGroup}from'./external-fingerprints';
export function pendingArchiveReader(db:SupabaseClient){
 const components=new Map<string,unknown>();
 return async(after:string)=>{
  const result=await db.from('image_fingerprint_archive_groups').select('*').gt('id',after).order('id').limit(250);
  if(result.error||!Array.isArray(result.data))throw Error('Pending archive unavailable');
  const refs=[...new Set(result.data.flatMap(r=>Object.values(r.component_refs?.payload??{}).map(String)))].filter(id=>!components.has(id));
  for(let start=0;start<refs.length;start+=400){const values=await db.from('snapshot_components').select('id,value').in('id',refs.slice(start,start+400));if(values.error)throw Error('Archive dictionary unavailable');for(const r of values.data??[])components.set(String(r.id),r.value);}
  return result.data.map(r=>{
   const row:ArchiveGroup={id:String(r.id),property_id:r.property_id,publication_id:r.publication_id,row_data:r.row_data,observations:r.observations};
   if(r.component_refs){
    row.row_data=Object.fromEntries(Object.entries(r.component_refs.payload).map(([key,id])=>{if(!components.has(String(id)))throw Error('Archive component missing');return[key,components.get(String(id))];}));
    if(!Array.isArray(r.observation_ids)||r.observation_ids.length!==r.observation_snapshots?.length||r.observation_ids.length!==r.observation_times?.length)throw Error('Archive observations incomplete');
    row.observations=r.observation_ids.map((id:string,i:number)=>({id,snapshot_id:r.observation_snapshots[i],created_at:r.observation_times[i]}));
   }return validateArchiveGroup(row);
  });
 };
}
