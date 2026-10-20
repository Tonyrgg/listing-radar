import type {SupabaseClient} from '@supabase/supabase-js';
import {streetRepresentativePoint,type StreetLineGeometry} from '@/lib/street-registry/metrics';
export interface Activity {version:string;score:number;breakdown:Record<string,number>;reasons:Record<string,number>}
export interface BuildingContext {building_id:string;display_name:string;street_id:string|null;street_name:string|null;canonical_street:string|null;civic:string|null;civic_variants:string[];locality:string|null;latitude:number|null;longitude:number|null;precision_type:string;canonical_civic:string|null;known_properties:number;active_properties:number;historical_properties:number;sold_observed:number;publications:number;agencies:string[];public_record_count:number;recent30:number;recent90:number;last_activity:string|null;categories_by_record:Record<string,string>;declared_cadastral_references:unknown[];activity:Activity;territorial_resolution:Record<string,unknown>;duplicate_candidates?:Array<{building_id:string;candidate_id:string;classification:string}>}
export interface StreetContext {street_id:string;canonical_name:string;locality:string|null;known_properties:number;active_properties:number;historical_properties:number;sold_observed:number;agencies:string[];known_buildings:number;public_record_count:number;recent30:number;recent90:number;last_activity:string|null;categories_by_record:Record<string,string>;activity:Activity}
export interface TerritorialEvent {event_id:string;event_at:string;event_kind:string;title:string;relation_scope:'BUILDING'|'STREET';date_precision:string;source_url:string|null;record_id:string|null;property_id:string|null;priceFrom?:number|null;priceTo?:number|null}
export interface BuildingMapPoint {id:string;title:string;latitude:number;longitude:number;precision_type:string;street_id:string|null;known_properties:number;active_properties:number;public_record_count:number;recent30:number;recent90:number;last_activity:string|null;activity:Activity;categories:string[]}
export const activityLabel=(score:number)=>score>=50?'Alta':score>=25?'Moderata':score>0?'Limitata':'Nessuna recente';
async function mapRows<T>(db:SupabaseClient,table:string,fields:string,key:string,activeOnly=false,recentOnly=false){
 const rows:T[]=[];for(let from=0;;from+=500){let q=db.from(table).select(fields).order(key).range(from,from+499);if(activeOnly)q=q.eq('record_status','active').not('geometry','is',null);if(recentOnly)q=q.gt('recent90',0);const r=await q;if(r.error)throw Error(r.error.message);rows.push(...r.data as T[]);if(r.data.length<500)return rows;}
}
export async function readGraphContext(db:SupabaseClient,scope:'BUILDING'|'STREET',id:string,page=1){
 const table=scope==='BUILDING'?'market_observer_graph_building_context':'market_observer_graph_street_context',key=scope==='BUILDING'?'building_id':'street_id';
 const [context,events,duplicates]=await Promise.all([db.from(table).select('*').eq(key,id).maybeSingle(),db.rpc('read_territorial_timeline',{p_scope:scope,p_id:id,p_limit:31,p_offset:(page-1)*30}),scope==='BUILDING'?db.from('market_observer_building_duplicate_candidates').select('building_id,candidate_id,classification').or(`building_id.eq.${id},candidate_id.eq.${id}`):Promise.resolve({data:[],error:null})]);
 if(context.error)throw Error(context.error.message);if(events.error)throw Error(events.error.message);
 if(duplicates.error)throw Error(duplicates.error.message);
 const timeline=(events.data as TerritorialEvent[]).slice(0,30),priceIds=timeline.filter(e=>['PRICE_DROP','PRICE_INCREASE','PRICE_CHANGE'].includes(e.event_kind)&&e.event_id.startsWith('event:')).map(e=>e.event_id.slice(6));
 if(priceIds.length){const prices=await db.from('events').select('id,payload').in('id',priceIds);if(prices.error)throw Error(prices.error.message);const byId=new Map(prices.data.map(e=>[e.id,e.payload]));for(const e of timeline){const p=byId.get(e.event_id.slice(6));if(p){e.priceFrom=typeof p.oldPrice==='number'?p.oldPrice:null;e.priceTo=typeof p.newPrice==='number'?p.newPrice:null;}}}
 return {context:context.data?{...context.data,...(scope==='BUILDING'?{duplicate_candidates:duplicates.data}:{})} as BuildingContext|StreetContext:null,events:timeline,hasNext:events.data.length>30};
}
export async function readBuildingMap(db:SupabaseClient){
 const [bs,ss]=await Promise.all([mapRows<BuildingContext>(db,'market_observer_graph_building_context','*','building_id'),mapRows<{id:string;geometry:StreetLineGeometry|null}>(db,'street_registry_streets','id,geometry','id',true)]);
 const streetPoints=new Map(ss.map(s=>[s.id,streetRepresentativePoint(s.geometry)]));
 const points:BuildingMapPoint[]=[];
 for(const b of bs){const exact=b.latitude!=null&&b.longitude!=null;const p=exact?{latitude:b.latitude!,longitude:b.longitude!}:b.street_id?streetPoints.get(b.street_id):null;
  if(!p||p.latitude<40.8||p.latitude>41.3||p.longitude<16.2||p.longitude>16.9)continue;
  points.push({id:b.building_id,title:b.display_name,latitude:p.latitude,longitude:p.longitude,precision_type:exact?b.precision_type:'STREET',street_id:b.street_id,known_properties:b.known_properties,active_properties:b.active_properties,public_record_count:b.public_record_count,recent30:b.recent30,recent90:b.recent90,last_activity:b.last_activity,activity:b.activity,categories:[...new Set(Object.values(b.categories_by_record))]});}
 const recent=await mapRows<{street_id:string;recent90:number}>(db,'market_observer_graph_street_context','street_id,recent90','street_id',false,true);
 return {points,total:bs.length,located:points.length,summaries:Object.fromEntries(bs.map(b=>[b.building_id,{known:b.known_properties,active:b.active_properties,score:b.activity.score}])),recentStreets:recent.filter(s=>s.recent90>0).map(s=>s.street_id)};
}
