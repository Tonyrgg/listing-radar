import type { SupabaseClient } from "@supabase/supabase-js";

export const INTELLIGENCE_VIEWS = ["mercato", "opportunita", "usciti", "venduti"] as const;
export type IntelligenceView = typeof INTELLIGENCE_VIEWS[number];
export const EXIT_LABELS: Record<string, string> = {
  ACTIVE: "Online", MISSING_UNCONFIRMED: "Assenza da confermare", SOLD_CONFIRMED: "Vendita confermata",
  SOLD_PROBABLE: "Vendita probabile", UNDER_OFFER: "In trattativa", WITHDRAWN: "Ritirato",
  EXPIRED_POSSIBLE: "Possibile scadenza, da verificare", RELISTED: "Ripubblicato da privato",
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
}
export async function readIntelligence(db: SupabaseClient, filters: {
  view: IntelligenceView; page: number; query?: string; classification?: string;
}) {
  const size=40;
  let request=db.from("market_observer_intelligence").select("*");
  if (filters.view === "venduti") request=request.in("exit_classification", ["SOLD_CONFIRMED", "SOLD_PROBABLE"]);
  if (filters.view === "usciti") request=request.in("exit_classification", ["SOLD_CONFIRMED", "SOLD_PROBABLE", "WITHDRAWN", "RELISTED", "AGENCY_CHANGED", "UNKNOWN_EXIT", "MISSING_UNCONFIRMED"]);
  if (filters.view === "opportunita") request=request.gt("opportunity_score", 0).neq("exit_classification", "SOLD_CONFIRMED");
  if (filters.classification && EXIT_LABELS[filters.classification]) request=request.eq("exit_classification", filters.classification);
  if (filters.query?.trim()) request=request.ilike("address", `%${filters.query.trim().replace(/[%_\\]/g, "").slice(0,120)}%`);
  request=filters.view === "opportunita" ? request.order("opportunity_score", { ascending:false, nullsFirst:false }) : request.order("last_seen_at",{ascending:false});
  const { data,error }=await request.order("row_id").range((filters.page-1)*size,filters.page*size);
  if(error) throw new Error(error.message);
  const rows=(data ?? []) as IntelligenceRow[];
  return { rows:rows.slice(0,size), hasNext:rows.length>size };
}

export function observableDays(start: string | null, end: string | number): number | null {
  if (!start) return null;
  const first=Date.parse(start), last=typeof end === "number" ? end : Date.parse(end);
  return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0,Math.floor((last-first)/86_400_000)) : null;
}
