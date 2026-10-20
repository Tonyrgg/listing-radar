import type { SupabaseClient } from "@supabase/supabase-js";
import type { LifecyclePropertyDetail } from "@/lib/property-lifecycle/read-models/types";
import { canonicalBuildingAddress } from "./address";
import { RECORD_TYPES } from "./public-record-policy";
import type { TerritorialReference } from "./territorial-extraction";
import { streetRepresentativePoint,type StreetLineGeometry } from "@/lib/street-registry/metrics";
import {parseCivics} from './territorial-graph';

export interface PublicRecord {
  id: string; source_key: string; title: string; record_type: string;
  practice_number: string | null; protocol_number: string | null; practice_year: string | null;
  practice_status: string | null; practice_date: string | null; published_at: string | null;
  document_date: string | null; source_url: string | null; document_url: string | null;
  first_seen_at: string; last_seen_at: string; content_hash: string;
  area_name: string | null; address_text: string; building_ids: string[];
  addresses: Array<{ displayName: string; streetName: string; streetNumber: string }>;
  cadastral_references: Array<{ sheet: string | null; parcel: string | null; subaltern: string | null }>;
  metadata: Record<string, unknown>;
  subject?: string | null; publication_start?: string | null; publication_end?: string | null;
  office?: string | null; document_urls?: string[]; territorial_references?: TerritorialReference[];
  classification_confidence?: number | null; classification_version?: string | null; source_status?: string | null;
  record_date?: string | null; record_year?: string | null;
  resolved_references?:Array<{streetId:string|null;streetName:string;locality:string;civicText:string|null;civics:string[];civicState:string}>|null;
  unmatched_cause?:string|null;territorial_policy_version?:string|null;
  relation_scope?: "BUILDING" | "STREET" | "AREA"; match_confidence?: number;
}
export interface RecordFilters { query?: string; civic?: string; year?: string; type?: string; source?: string; zone?: string; page?: number; streetId?: string }
const clean=(s:string)=>s.replace(/[%_\\,()]/g, "").trim().slice(0,120);
export async function readPublicRecords(db: SupabaseClient, filters: RecordFilters={}) {
  let q=db.from("market_observer_graph_public_records").select("*");
  if(filters.streetId){const links=await db.from("market_observer_graph_record_streets").select("record_id").eq("street_id",filters.streetId);if(links.error)throw Error(links.error.message);const ids=links.data.map(l=>l.record_id);if(!ids.length)return {records:[],hasNext:false};q=q.in("id",ids);}
  if(filters.query?.trim()) {
    const text=clean(filters.query);
    if(text) q=q.or(`title.ilike.%${text}%,subject.ilike.%${text}%,address_text.ilike.%${text}%,practice_number.ilike.%${text}%`);
  }
  if(filters.year && /^\d{4}$/.test(filters.year))q=q.eq("record_year",filters.year);
  if(filters.civic?.trim()){const parsed=parseCivics(clean(filters.civic));if(parsed.state!=='EXPLICIT'||parsed.values.length!==1)return {records:[],hasNext:false};q=q.contains("civic_numbers",[parsed.values[0]]);}
  if(filters.type)q=q.eq("record_type",filters.type.slice(0,50));
  if(filters.source)q=q.eq("source_key",filters.source.slice(0,100));
  if(filters.zone?.trim()){
    const zone=clean(filters.zone);if(zone)q=q.or(`area_name.ilike.%${zone}%,address_text.ilike.%${zone}%`);
  }
  const page=Math.max(1,Math.floor(filters.page??1));
  const r=await q.order("record_date",{ascending:false,nullsFirst:false}).order("id").range((page-1)*30,page*30);
  if(r.error)throw Error(r.error.message);
  const rows=(r.data??[]) as PublicRecord[];
  return {records:rows.slice(0,30),hasNext:rows.length>30};
}

/** Building context is not a property-unit match. No street-only or personal-name association. */
export async function readPropertyPublicRecords(db:SupabaseClient, detail:LifecyclePropertyDetail):Promise<PublicRecord[]> {
  let buildingId=detail.building?.id;
  const l=detail.location;
  if(!buildingId && l?.streetName && l.streetNumber){
    const address=canonicalBuildingAddress({scope:"IN_SCOPE",precision:"EXACT_ADDRESS",municipality:l.municipality,
      locality:l.locality,streetName:l.streetName,streetNumber:l.streetNumber});
    if(address){const r=await db.from("buildings").select("id").eq("normalized_key",address.normalizedKey).maybeSingle();
      if(r.error)throw Error(r.error.message); buildingId=r.data?.id;}
  }
  if(!buildingId)return [];
  const links=await db.from("building_practice_buildings").select("practice_record_id").eq("building_id",buildingId).eq("is_current",true);
  if(links.error)throw Error(links.error.message);
  const ids=(links.data??[]).map(r=>r.practice_record_id);
  if(!ids.length)return [];
  const r=await db.from("market_observer_public_records").select("*").in("id",ids).order("practice_date",{ascending:false,nullsFirst:false});
  if(r.error)throw Error(r.error.message);return (r.data??[]) as PublicRecord[];
}

export const PUBLIC_RECORD_LABELS: Record<string,string>={
  ...RECORD_TYPES,
  SCIA:"SCIA",CILA:"CILA",SANATORIA:"Sanatoria",CONDONO:"Condono",AGIBILITA:"Agibilità",
  PERMESSO_COSTRUIRE:"Permesso di costruire",URBAN_PLAN:"Piano e cartografia",OTHER:"Altra pratica pubblica",
};

/** Contextual records remain separate from civic/building links. No unit claim. */
export async function readPropertyTerritorialContext(db:SupabaseClient,detail:LifecyclePropertyDetail){
  const summary=await db.from('market_observer_graph_property_context').select('*').eq('property_id',detail.property.id).maybeSingle();if(summary.error)throw Error(summary.error.message);
  const buildingIds:string[]=summary.data?.context_building_ids??[];
  const links=buildingIds.length?await db.from('building_practice_buildings').select('practice_record_id').in('building_id',buildingIds).eq('is_current',true):{data:[],error:null};if(links.error)throw Error(links.error.message);
  const recordIds=[...new Set(links.data.map(l=>l.practice_record_id))];
  const building=recordIds.length?await db.from('market_observer_graph_public_records').select('*').in('id',recordIds).order('record_date',{ascending:false,nullsFirst:false}):{data:[],error:null};if(building.error)throw Error(building.error.message);
  const records=building.data as PublicRecord[];
  const ids=new Set(records.map(r=>r.id));
  const streetId:string|null=summary.data?.context_street_id??null,locality=detail.location?.locality??"Bitonto";
  let contextual:PublicRecord[]=[];
  if(streetId){
    const refs=await db.from("market_observer_graph_record_streets").select("record_id").eq("street_id",streetId);if(refs.error)throw Error(refs.error.message);
    const others=[...new Set(refs.data?.map(r=>r.record_id)??[])].filter(id=>!ids.has(id));
    if(others.length){const r=await db.from("market_observer_graph_public_records").select("*").in("id",others).order("record_date",{ascending:false,nullsFirst:false}).limit(50);if(r.error)throw Error(r.error.message);contextual=r.data as PublicRecord[];}}
  const area=await db.from("market_observer_public_records").select("*").eq("area_name",locality).eq("record_type","URBAN_PLAN").order("title");if(area.error)throw Error(area.error.message);
  return {specific:[] as PublicRecord[],buildingIds,streetId,recentStreet:summary.data?.recent_street_count??0,building:records.map(r=>({...r,relation_scope:"BUILDING" as const})),street:contextual.map(r=>({...r,relation_scope:"STREET" as const})),area:(area.data as PublicRecord[]).map(r=>({...r,relation_scope:"AREA" as const}))};
}

export interface PublicRecordMapPoint { id:string;recordId:string;title:string;category:string;latitude:number;longitude:number;precision:"STREET"|"BUILDING";streetName:string;streetId?:string;buildingId?:string;buildingIds?:string[];recordDate?:string|null;sourceStatus?:string|null }
export async function readPublicRecordMap(db:SupabaseClient){
  const points:PublicRecordMapPoint[]=[],links: Array<{record_id:string;street_id:string;canonical_name:string;geometry:unknown}>=[];
  for(let from=0;;from+=500){const r=await db.from("market_observer_graph_record_streets").select("record_id,street_id,canonical_name,geometry").order("record_id").order("street_id").range(from,from+499);if(r.error)throw Error(r.error.message);links.push(...r.data);if(r.data.length<500)break;}
  const records:PublicRecord[]=[];
  for(let from=0;;from+=500){const r=await db.from("market_observer_public_records").select("id,title,record_type,record_date,source_status,building_ids").order("id").range(from,from+499);if(r.error)throw Error(r.error.message);records.push(...r.data as PublicRecord[]);if(r.data.length<500)break;}
  const index=new Map(records.map(r=>[r.id,r]));
  for(const l of links){const p=streetRepresentativePoint(l.geometry as StreetLineGeometry),r=index.get(l.record_id);if(!p||!r||p.latitude<40.8||p.latitude>41.3||p.longitude<16.2||p.longitude>16.9)continue;
    points.push({id:`${l.record_id}:${l.street_id}`,recordId:r.id,title:r.title,category:r.record_type,latitude:p.latitude,longitude:p.longitude,precision:"STREET",streetName:l.canonical_name,streetId:l.street_id,buildingIds:r.building_ids,recordDate:r.record_date,sourceStatus:r.source_status});}
  return {points,total:records.length,locatedRecords:new Set(points.map(p=>p.recordId)).size};
}

export async function readRecordContext(db:SupabaseClient,recordId:string){
  const record=await db.from("market_observer_graph_public_records").select("*").eq("id",recordId).maybeSingle();if(record.error)throw Error(record.error.message);
  const links=await db.from("market_observer_graph_record_property_links").select("property_id,building_id,match_confidence,unit_match").eq("record_id",recordId);if(links.error)throw Error(links.error.message);
  const propertyIds=[...new Set(links.data.map(l=>l.property_id))];
  const properties=propertyIds.length?await db.from("market_observer_property_archive").select("property_id,address,state").in("property_id",propertyIds):{data:[],error:null};if(properties.error)throw Error(properties.error.message);
  const buildings=record.data?.building_ids?.length?await db.from("market_observer_building_intelligence").select("*").in("building_id",record.data.building_ids):{data:[],error:null};if(buildings.error)throw Error(buildings.error.message);
  return {record:record.data as PublicRecord|null,properties:properties.data??[],buildings:buildings.data??[]};
}
