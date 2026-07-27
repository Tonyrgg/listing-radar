import "server-only";

import { calculateMatch } from "./engine";
import { getMatchingConfig, logMatchingActivity, requireMatchingDatabase } from "./repository";
import type {
  PortfolioProperty, PropertyFeatureValue, PropertyRequest,
  RequestFeaturePreference, RequestZone,
} from "./types";

async function calculatePair(request: PropertyRequest, property: PortfolioProperty) {
  const supabase = requireMatchingDatabase();
  const [{ data: zones }, { data: preferences }, { data: values }, config] = await Promise.all([
    supabase.from("request_zones").select("*, zone:internal_zones(*)").eq("request_id", request.id),
    supabase.from("request_feature_preferences").select("*, feature:feature_definitions(*)").eq("request_id", request.id),
    supabase.from("property_feature_values").select("*, feature:feature_definitions(*)").eq("property_id", property.id),
    getMatchingConfig(),
  ]);
  const result = calculateMatch({
    request, property, config,
    requestZones: (zones ?? []) as RequestZone[],
    requestFeatures: (preferences ?? []) as RequestFeaturePreference[],
    propertyFeatures: (values ?? []) as PropertyFeatureValue[],
  });
  const { error } = await supabase.from("request_property_matches").upsert({
    request_id: request.id,
    property_id: property.id,
    score: result.score,
    classification: result.classification,
    matched_criteria: result.matched_criteria,
    missing_preferences: result.missing_preferences,
    conflicting_criteria: result.conflicting_criteria,
    explanation: result.explanation,
    last_calculated_at: new Date().toISOString(),
  }, { onConflict: "request_id,property_id", ignoreDuplicates: false });
  if (error) throw new Error(error.message);
}

export async function recalculateMatchesForRequest(requestId: string) {
  const supabase = requireMatchingDatabase();
  const [{ data: request }, { data: properties }] = await Promise.all([
    supabase.from("property_requests").select("*").eq("id", requestId).single(),
    supabase.from("portfolio_properties").select("*").eq("mandate_status", "active"),
  ]);
  if (!request) throw new Error("Richiesta non trovata.");
  await Promise.all((properties ?? []).map((property) => calculatePair(request as PropertyRequest, property as PortfolioProperty)));
  await logMatchingActivity("request", requestId, "matches_recalculated", { count: properties?.length ?? 0 });
}

export async function recalculateMatchesForProperty(propertyId: string) {
  const supabase = requireMatchingDatabase();
  const [{ data: property }, { data: requests }] = await Promise.all([
    supabase.from("portfolio_properties").select("*").eq("id", propertyId).single(),
    supabase.from("property_requests").select("*").in("status", ["active", "urgent"]),
  ]);
  if (!property) throw new Error("Immobile non trovato.");
  await Promise.all((requests ?? []).map((request) => calculatePair(request as PropertyRequest, property as PortfolioProperty)));
  await logMatchingActivity("property", propertyId, "matches_recalculated", { count: requests?.length ?? 0 });
}

export async function recalculateAllActiveMatches() {
  const supabase = requireMatchingDatabase();
  const { data: requests } = await supabase.from("property_requests").select("id").in("status", ["active", "urgent"]);
  for (const request of requests ?? []) await recalculateMatchesForRequest(request.id);
}

