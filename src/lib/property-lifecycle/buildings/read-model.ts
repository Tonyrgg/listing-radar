import type { SupabaseClient } from "@supabase/supabase-js";
import type { LifecyclePropertyDetail } from "@/lib/property-lifecycle/read-models/types";
import { canonicalBuildingAddress } from "./address";

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
}
export interface RecordFilters { query?: string; year?: string; type?: string; source?: string; zone?: string; page?: number }
const clean=(s:string)=>s.replace(/[%_\\,()]/g, "").trim().slice(0,120);
export async function readPublicRecords(db: SupabaseClient, filters: RecordFilters={}) {
  let q=db.from("market_observer_public_records").select("*");
  if(filters.query?.trim()) {
    const text=clean(filters.query);
    if(text) q=q.or(`title.ilike.%${text}%,address_text.ilike.%${text}%,practice_number.ilike.%${text}%`);
  }
  if(filters.year && /^\d{4}$/.test(filters.year))q=q.eq("practice_year",filters.year);
  if(filters.type)q=q.eq("record_type",filters.type.slice(0,50));
  if(filters.source)q=q.eq("source_key",filters.source.slice(0,100));
  if(filters.zone?.trim()){
    const zone=clean(filters.zone);if(zone)q=q.or(`area_name.ilike.%${zone}%,address_text.ilike.%${zone}%`);
  }
  const page=Math.max(1,Math.floor(filters.page??1));
  const r=await q.order("last_seen_at",{ascending:false}).order("id").range((page-1)*30,page*30);
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
  const links=await db.from("building_practice_buildings").select("practice_record_id").eq("building_id",buildingId);
  if(links.error)throw Error(links.error.message);
  const ids=(links.data??[]).map(r=>r.practice_record_id);
  if(!ids.length)return [];
  const r=await db.from("market_observer_public_records").select("*").in("id",ids).order("practice_date",{ascending:false,nullsFirst:false});
  if(r.error)throw Error(r.error.message);return (r.data??[]) as PublicRecord[];
}

export const PUBLIC_RECORD_LABELS: Record<string,string>={
  SCIA:"SCIA",CILA:"CILA",SANATORIA:"Sanatoria",CONDONO:"Condono",AGIBILITA:"Agibilità",
  PERMESSO_COSTRUIRE:"Permesso di costruire",URBAN_PLAN:"Piano e cartografia",OTHER:"Altra pratica pubblica",
};
