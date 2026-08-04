import "server-only";

import { calculateMatch } from "./engine";
import { getMatchingConfig, logMatchingActivity, requireMatchingDatabase } from "./repository";
import type {
  PortfolioProperty, PropertyFeatureValue, PropertyRequest,
  RequestFeaturePreference, RequestZone,
} from "./types";

const UPSERT_BATCH_SIZE = 400;

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

async function calculateAndStore(
  requests: PropertyRequest[],
  properties: PortfolioProperty[],
) {
  if (!requests.length || !properties.length) return 0;
  const supabase = requireMatchingDatabase();
  const requestIds = requests.map((request) => request.id);
  const propertyIds = properties.map((property) => property.id);
  const [{ data: zones, error: zonesError }, { data: preferences, error: preferencesError }, { data: values, error: valuesError }, config] = await Promise.all([
    supabase.from("request_zones").select("*, zone:internal_zones(*)").in("request_id", requestIds),
    supabase.from("request_feature_preferences").select("*, feature:feature_definitions(*)").in("request_id", requestIds),
    supabase.from("property_feature_values").select("*, feature:feature_definitions(*)").in("property_id", propertyIds),
    getMatchingConfig(),
  ]);
  const firstError = zonesError ?? preferencesError ?? valuesError;
  if (firstError) throw new Error(firstError.message);

  const zonesByRequest = groupBy((zones ?? []) as RequestZone[], (row) => String((row as RequestZone & { request_id: string }).request_id));
  const preferencesByRequest = groupBy((preferences ?? []) as RequestFeaturePreference[], (row) => String((row as RequestFeaturePreference & { request_id: string }).request_id));
  const valuesByProperty = groupBy((values ?? []) as PropertyFeatureValue[], (row) => String((row as PropertyFeatureValue & { property_id: string }).property_id));
  const calculatedAt = new Date().toISOString();
  const rows = requests.flatMap((request) => properties.map((property) => {
    const result = calculateMatch({
      request,
      property,
      config,
      requestZones: zonesByRequest.get(request.id) ?? [],
      requestFeatures: preferencesByRequest.get(request.id) ?? [],
      propertyFeatures: valuesByProperty.get(property.id) ?? [],
    });
    return {
      request_id: request.id,
      property_id: property.id,
      score: result.score,
      classification: result.classification,
      matched_criteria: result.matched_criteria,
      missing_preferences: result.missing_preferences,
      conflicting_criteria: result.conflicting_criteria,
      explanation: result.explanation,
      last_calculated_at: calculatedAt,
    };
  }));

  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const { error } = await supabase.from("request_property_matches")
      .upsert(rows.slice(index, index + UPSERT_BATCH_SIZE), { onConflict: "request_id,property_id", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

export async function recalculateMatchesForRequest(requestId: string) {
  const supabase = requireMatchingDatabase();
  const [{ data: request, error: requestError }, { data: properties, error: propertiesError }] = await Promise.all([
    supabase.from("property_requests").select("*").eq("id", requestId).single(),
    supabase.from("portfolio_properties").select("*").eq("mandate_status", "active"),
  ]);
  if (requestError || !request) throw new Error(requestError?.message ?? "Richiesta non trovata.");
  if (propertiesError) throw new Error(propertiesError.message);
  const count = await calculateAndStore([request as PropertyRequest], (properties ?? []) as PortfolioProperty[]);
  await logMatchingActivity("request", requestId, "matches_recalculated", { count });
}

export async function recalculateMatchesForProperty(propertyId: string) {
  const supabase = requireMatchingDatabase();
  const [{ data: property, error: propertyError }, { data: requests, error: requestsError }] = await Promise.all([
    supabase.from("portfolio_properties").select("*").eq("id", propertyId).single(),
    supabase.from("property_requests").select("*").in("status", ["active", "urgent"]),
  ]);
  if (propertyError || !property) throw new Error(propertyError?.message ?? "Immobile non trovato.");
  if (requestsError) throw new Error(requestsError.message);
  const count = await calculateAndStore((requests ?? []) as PropertyRequest[], [property as PortfolioProperty]);
  await logMatchingActivity("property", propertyId, "matches_recalculated", { count });
}

export async function recalculateAllActiveMatches() {
  const supabase = requireMatchingDatabase();
  const [{ data: requests, error: requestsError }, { data: properties, error: propertiesError }] = await Promise.all([
    supabase.from("property_requests").select("*").in("status", ["active", "urgent"]),
    supabase.from("portfolio_properties").select("*").eq("mandate_status", "active"),
  ]);
  if (requestsError || propertiesError) throw new Error((requestsError ?? propertiesError)?.message);
  const count = await calculateAndStore((requests ?? []) as PropertyRequest[], (properties ?? []) as PortfolioProperty[]);
  await logMatchingActivity("system", null, "all_matches_recalculated", {
    count,
    requests: requests?.length ?? 0,
    properties: properties?.length ?? 0,
  });
}
