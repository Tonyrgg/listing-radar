import type {SupabaseClient} from '@supabase/supabase-js';
import type {IntelligenceRow} from './intelligence';

export const TERRITORY_PROPERTY_FIELDS="property_id,row_id,agency_name,address,locality,zone_name,state,property_state,sale_status,exit_classification,first_seen_at,last_seen_at,earliest_market_evidence_at,latest_asking_price,first_asking_price,reduction_percent,drop_count,sold_at,sold_observed_at,opportunity_score,property_type,surface_sqm,rooms,latitude,longitude,location_precision,publication_count,evidence_count,document_count,publication_sources,attributes,agent_name,earliest_known_asking,earliest_known_asking_at,relaunch_count,public_record_count,building_record_count,specific_record_count,recent_street_count,latest_public_record_type,latest_public_record_date,source_price_conflict";
const graphFields='property_id,building_record_count,specific_record_count,recent_street_count';
const documentFields='property_id,public_record_count,latest_public_record_type,latest_public_record_date';
const contextFields=new Set([...graphFields.split(','),...documentFields.split(',')].filter(f=>f!=='property_id'));
const propertyFields=TERRITORY_PROPERTY_FIELDS.split(',').filter(f=>!contextFields.has(f)).join(',');

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

/** Keep the expensive graph aggregation outside each property page. Small
 * property pages leave headroom under the API timeout on the Free instance.
 * An incomplete branch rejects the whole read; never cache a partial archive. */
export async function loadTerritoryProperties(db:SupabaseClient):Promise<IntelligenceRow[]>{
 const [properties,graph,documents]=await Promise.all([
  pages(db,'market_observer_property_archive',propertyFields,64),
  pages(db,'market_observer_graph_property_context',graphFields,1000),
  pages(db,'market_observer_property_public_record_summary',documentFields,1000),
 ]);
 const graphs=new Map(graph.map(row=>[row.property_id,row]));
 const docs=new Map(documents.map(row=>[row.property_id,row]));
 const seen=new Set<unknown>();
 return properties.map(row=>{
  if(!row.property_id||seen.has(row.property_id))throw Error('Territory read: missing or duplicate property identity');
  seen.add(row.property_id);
  const g=graphs.get(row.property_id),d=docs.get(row.property_id);
  if(!g)throw Error('Territory read: property context changed during loading');
  const attributes=row.attributes as Record<string,unknown>|undefined;
  return {...row,...g,public_record_count:d?.public_record_count??0,
   latest_public_record_type:d?.latest_public_record_type??null,latest_public_record_date:d?.latest_public_record_date??null,
   attributes:{floor:attributes?.floor,features:attributes?.features}} as unknown as IntelligenceRow;
 });
}
