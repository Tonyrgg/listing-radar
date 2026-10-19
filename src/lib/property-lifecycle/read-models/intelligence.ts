import type { SupabaseClient } from "@supabase/supabase-js";

export const INTELLIGENCE_VIEWS = ["mercato", "opportunita", "usciti", "venduti"] as const;
export type IntelligenceView = typeof INTELLIGENCE_VIEWS[number];
export const EXIT_LABELS: Record<string, string> = {
  ACTIVE: "Online", MISSING_UNCONFIRMED: "Assenza da confermare", SOLD_CONFIRMED: "Vendita confermata",
  SOLD_PROBABLE: "Vendita probabile", UNDER_OFFER: "In trattativa", WITHDRAWN: "Ritirato",
  EXPIRED_POSSIBLE: "Possibile scadenza, da verificare", RELISTED: "Ripubblicato",
  AGENCY_CHANGED: "Cambio agenzia", UNKNOWN_EXIT: "Uscita senza esito noto",
};
export interface IntelligenceRow {
  row_id: string; agency_listing_id: string | null; property_id: string; agency_id: string | null; agency_name: string;
  address: string; locality: string | null; state: string; sale_status: string; property_state: string;
  earliest_market_evidence_at: string; sold_at: string | null; delisted_at: string | null;
  estimated_acquisition_at: string | null; acquisition_confidence: number | null;
  first_seen_at: string; last_seen_at: string; exit_classification: string; exit_confidence: number | null;
  first_asking_price: number | null; latest_asking_price: number | null; reduction_percent: number | null;
  drop_count: number; price_source_url: string | null; opportunity_score: number | null;
  reasons: string[]; evidence_summary: Record<string, unknown>;
  sold_observed_at?: string | null; classified_at?: string | null; classifier_version?: number | null;
  exit_evidence_ids?: string[]; exit_reasons?: string[]; exit_provenance?: Record<string, unknown>;
  zone_name?: string | null; observed_dom?: number | null; known_market_age?: number | null;
  price_confidence?: number | null; source_price_conflict?: boolean;
  earliest_known_asking?: number | null; earliest_known_asking_at?: string | null;
  agency_role?: string; agent_name?: string | null;
  market_evidence_provenance?: { source?: string; url?: string; observedAt?: string; claimedAt?: string; confidence?: number };
  publication_date_disagreement?: boolean;
  property_type?: string | null; surface_sqm?: number | null; rooms?: number | null;
  attributes?: Record<string,unknown>; publication_count?: number; publication_sources?: string[];
  updated_at?: string; building_id?: string | null; document_count?: number; evidence_count?: number;
  latitude?: number | null; longitude?: number | null; location_precision?: string | null;
  relaunch_count?: number; street_name?: string | null; street_number?: string | null;
  public_record_count?:number;recent_public_record_count?:number;new_territorial_signal_count?:number;
  latest_public_record_date?:string|null;latest_public_record_title?:string|null;latest_public_record_type?:string|null;
}
export interface IntelligenceFilters {
  view: IntelligenceView; page: number; query?: string; classification?: string;
  agency?: string; locality?: string; zone?: string; state?: string;
  minimumAge?: number; minimumScore?: number; minimumReduction?: number;
  propertyType?: string; minimumPrice?: number; maximumPrice?: number; minimumSqm?: number; maximumSqm?: number;
  reduced?: string; source?: string; publicRecords?:string;
}
export function marketAgeLabel(firstSeen: string, earliest: string | null, end: string | number): string {
  const publicDate = earliest && Date.parse(earliest) < Date.parse(firstSeen);
  const ended=typeof end === "number" ? end : Date.parse(end);
  if (ended < Date.parse(publicDate ? earliest : firstSeen)) return "Età mercato non ricostruibile";
  const days = observableDays(publicDate ? earliest : firstSeen, end);
  if (days == null) return "Anzianità da verificare";
  return publicDate ? `Sul mercato da almeno ${days} giorni` : `Monitorato da ${days} giorni`;
}
export async function readIntelligence(db: SupabaseClient, filters: IntelligenceFilters) {
  const size=40;
  let request=db.from("market_observer_territorial_property_archive").select("*");
  if(filters.publicRecords==="documents")request=request.gt("public_record_count",0);
  if(filters.publicRecords==="recent")request=request.gt("recent_public_record_count",0);
  if(filters.publicRecords==="signals")request=request.gt("new_territorial_signal_count",0);
  if (filters.view === "venduti") request=request.in("exit_classification", ["SOLD_CONFIRMED", "SOLD_PROBABLE"]);
  if (filters.view === "usciti") request=request.in("exit_classification", ["SOLD_CONFIRMED", "SOLD_PROBABLE", "WITHDRAWN", "RELISTED", "AGENCY_CHANGED", "UNKNOWN_EXIT", "MISSING_UNCONFIRMED"]);
  if (filters.view === "opportunita") request=request.gt("opportunity_score", 0).neq("exit_classification", "SOLD_CONFIRMED").neq("agency_role", "OUR_AGENCY");
  if (filters.classification && EXIT_LABELS[filters.classification]) request=request.eq("exit_classification", filters.classification);
  if (filters.query?.trim()) {
    const term=filters.query.trim().replace(/[%_\\,()]/g, "").slice(0,120);
    if(term)request=request.or(`address.ilike.%${term}%,agency_name.ilike.%${term}%,zone_name.ilike.%${term}%,locality.ilike.%${term}%`);
  }
  if (filters.agency && /^[0-9a-f-]{36}$/i.test(filters.agency)) request=request.eq("agency_id",filters.agency);
  if (filters.locality) request=request.eq("locality",filters.locality.slice(0,80));
  if (filters.zone?.trim()) request=request.ilike("zone_name",`%${filters.zone.trim().replace(/[%_\\]/g,"").slice(0,80)}%`);
  if (filters.state && ["ACTIVE","EXIT_PENDING","CLOSED_SOLD","CLOSED_WITHDRAWN","CLOSED_SWITCHED","CLOSED_TO_PRIVATE","OFF_MARKET_NO_SALE_EVIDENCE"].includes(filters.state)) request=request.eq("state",filters.state);
  if(filters.propertyType)request=request.ilike("property_type",`%${filters.propertyType.replace(/[%_\\]/g, "").slice(0,60)}%`);
  if(filters.source)request=request.contains("publication_sources",[filters.source.slice(0,100)]);
  if(filters.reduced==="yes")request=request.gt("drop_count",0);
  if(filters.reduced==="no")request=request.eq("drop_count",0);
  for(const [field,min,max] of [["latest_asking_price",filters.minimumPrice,filters.maximumPrice],["surface_sqm",filters.minimumSqm,filters.maximumSqm]] as const){
    if(min!=null && Number.isFinite(min) && min>=0)request=request.gte(field,min);
    if(max!=null && Number.isFinite(max) && max>=0)request=request.lte(field,max);
  }
  for (const [key,value,maximum] of [["known_market_age",filters.minimumAge,36500],["opportunity_score",filters.minimumScore,100],["reduction_percent",filters.minimumReduction,100]] as const) {
    if (value != null && Number.isFinite(value) && value >= 0) request=request.gte(key,Math.min(maximum,value));
  }
  request=filters.view === "opportunita" ? request.order("opportunity_score", { ascending:false, nullsFirst:false }) : request.order("last_seen_at",{ascending:false});
  const { data,error }=await request.order("row_id").range((filters.page-1)*size,filters.page*size);
  if(error) throw new Error(error.message);
  const rows=(data ?? []) as IntelligenceRow[];
  return { rows:rows.slice(0,size), hasNext:rows.length>size };
}

export interface AgencyMarketIntelligence { agency_id: string; name: string; market_role: string; active_listings: number;
  median_known_age: number | null; sold_observed: number; stale_listing_count: number; unknown_exit_count: number }
export async function readAgencyMarketIntelligence(db: SupabaseClient): Promise<AgencyMarketIntelligence[]> {
  const result = await db.from("market_observer_agency_intelligence")
    .select("agency_id,name,market_role,active_listings,median_known_age,sold_observed,stale_listing_count,unknown_exit_count")
    .gt("monitored_count",0).order("name").limit(50);
  if (result.error) throw new Error(result.error.message); return (result.data ?? []) as AgencyMarketIntelligence[];
}

export function observableDays(start: string | null, end: string | number): number | null {
  if (!start) return null;
  const first=Date.parse(start), last=typeof end === "number" ? end : Date.parse(end);
  return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0,Math.floor((last-first)/86_400_000)) : null;
}
