import type {SupabaseClient} from '@supabase/supabase-js';
import type {IntelligenceRow} from './intelligence';

export const TERRITORY_PROPERTY_FIELDS="property_id,row_id,agency_name,address,locality,zone_name,state,property_state,sale_status,exit_classification,first_seen_at,last_seen_at,earliest_market_evidence_at,latest_asking_price,first_asking_price,reduction_percent,drop_count,sold_at,sold_observed_at,opportunity_score,property_type,surface_sqm,rooms,latitude,longitude,location_precision,publication_count,evidence_count,document_count,publication_sources,attributes,agent_name,earliest_known_asking,earliest_known_asking_at,relaunch_count,public_record_count,building_record_count,specific_record_count,recent_street_count,latest_public_record_type,latest_public_record_date,source_price_conflict";
async function pages(db:SupabaseClient,view:string,fields:string,size:number){
 const rows:Record<string,unknown>[]=[];
 for(let from=0;;from+=size){
  const {data,error}=await db.from(view).select(fields).order('property_id').range(from,from+size-1);
  if(error)throw Error(`Territory read ${view}: ${error.message}`);
  if(!Array.isArray(data))throw Error(`Territory read ${view}: incomplete response`);
  rows.push(...data as unknown as Record<string,unknown>[]);
  if(data.length<size)return rows;
 }
}

/** Read the complete indexed snapshot, never rebuild the graph per page. */
export async function loadTerritoryProperties(db:SupabaseClient):Promise<IntelligenceRow[]>{
 const properties=await pages(db,'radar_property_read_model',TERRITORY_PROPERTY_FIELDS,1000);
 const seen=new Set<unknown>();
 return properties.map(row=>{
  if(!row.property_id||seen.has(row.property_id))throw Error('Territory read: missing or duplicate property identity');
  seen.add(row.property_id);
  const attributes=row.attributes as Record<string,unknown>|undefined;
  return {...row,attributes:{floor:attributes?.floor,features:attributes?.features}} as unknown as IntelligenceRow;
 });
}
