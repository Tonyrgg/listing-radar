"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  clientSchema, featureDefinitionSchema, matchStatusSchema,
  portfolioPropertySchema, propertyRequestSchema, zoneSchema,
} from "@/lib/matching/schemas";
import { estimateCommercialSqm } from "@/lib/matching/scoring";
import {
  getMatchingConfig, logMatchingActivity, requireMatchingDatabase,
} from "@/lib/matching/repository";
import {
  recalculateAllActiveMatches, recalculateMatchesForProperty,
  recalculateMatchesForRequest,
} from "@/lib/matching/recalculate";

function refreshAll() {
  for (const path of ["/dashboard", "/requests", "/portfolio", "/matching", "/zones", "/matching-settings"]) {
    revalidatePath(path);
  }
}

export async function getQuickRequestOptionsAction() {
  await requireUser();
  const supabase = requireMatchingDatabase();
  const [{ data: zones }, { data: features }] = await Promise.all([
    supabase.from("internal_zones").select("*").eq("is_active", true).order("name"),
    supabase.from("feature_definitions").select("*").eq("is_active", true).order("sort_order"),
  ]);
  return { zones: zones ?? [], features: features ?? [] };
}

export async function saveRequestAction(input: unknown) {
  await requireUser();
  const parsed = propertyRequestSchema.parse(input);
  const { zone_preferences, feature_preferences, id, ...request } = parsed;
  const config = await getMatchingConfig();
  const sqm = estimateCommercialSqm(request.internal_sqm_ideal ?? null, config);
  const supabase = requireMatchingDatabase();
  const payload = {
    ...request,
    commercial_sqm_estimated_min: sqm.minimum,
    commercial_sqm_estimated_max: sqm.maximum,
  };
  const query = id
    ? supabase.from("property_requests").update(payload).eq("id", id).select().single()
    : supabase.from("property_requests").insert(payload).select().single();
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message ?? "Richiesta non salvata.");
  await Promise.all([
    supabase.from("request_zones").delete().eq("request_id", data.id),
    supabase.from("request_feature_preferences").delete().eq("request_id", data.id),
  ]);
  if (zone_preferences.length) await supabase.from("request_zones").insert(zone_preferences.map((item) => ({ ...item, request_id: data.id })));
  if (feature_preferences.length) await supabase.from("request_feature_preferences").insert(feature_preferences.map((item) => ({ ...item, request_id: data.id, desired_value: item.desired_value ?? true })));
  await logMatchingActivity("request", data.id, id ? "updated" : "created", { status: request.status });
  if (["active", "urgent"].includes(request.status)) await recalculateMatchesForRequest(data.id);
  refreshAll();
  return { id: data.id };
}

export async function savePropertyAction(input: unknown) {
  await requireUser();
  const parsed = portfolioPropertySchema.parse(input);
  const { feature_values, id, ...property } = parsed;
  const supabase = requireMatchingDatabase();
  const query = id
    ? supabase.from("portfolio_properties").update(property).eq("id", id).select().single()
    : supabase.from("portfolio_properties").insert(property).select().single();
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message ?? "Immobile non salvato.");
  await supabase.from("property_feature_values").delete().eq("property_id", data.id);
  if (feature_values.length) await supabase.from("property_feature_values").insert(feature_values.map((item) => ({ ...item, property_id: data.id })));
  await logMatchingActivity("property", data.id, id ? "updated" : "created");
  if (property.mandate_status === "active") await recalculateMatchesForProperty(data.id);
  refreshAll();
  return { id: data.id };
}

export async function saveZoneAction(input: unknown) {
  await requireUser();
  const { id, ...zone } = zoneSchema.parse(input);
  const supabase = requireMatchingDatabase();
  const query = id ? supabase.from("internal_zones").update(zone).eq("id", id) : supabase.from("internal_zones").insert(zone);
  const { error } = await query;
  if (error) throw new Error(error.message);
  await logMatchingActivity("zone", id ?? null, id ? "updated" : "created");
  refreshAll();
}

export async function saveClientAction(input: unknown) {
  await requireUser();
  const { id, ...client } = clientSchema.parse(input);
  const supabase = requireMatchingDatabase();
  const query = id ? supabase.from("clients").update(client).eq("id", id).select().single() : supabase.from("clients").insert(client).select().single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  refreshAll();
  return data;
}

export async function linkClientAction(requestId: string, clientId: string | null) {
  await requireUser();
  const { error } = await requireMatchingDatabase().from("property_requests").update({ client_id: clientId }).eq("id", requestId);
  if (error) throw new Error(error.message);
  await logMatchingActivity("request", requestId, clientId ? "client_linked" : "client_unlinked");
  refreshAll();
}

export async function updateRequestStatusAction(requestId: string, status: unknown) {
  await requireUser();
  const parsed = propertyRequestSchema.shape.status.parse(status);
  const { error } = await requireMatchingDatabase().from("property_requests").update({ status: parsed }).eq("id", requestId);
  if (error) throw new Error(error.message);
  await logMatchingActivity("request", requestId, "status_changed", { status: parsed });
  if (["active", "urgent"].includes(parsed)) await recalculateMatchesForRequest(requestId);
  refreshAll();
}

export async function duplicateRequestAction(requestId: string) {
  await requireUser();
  const supabase = requireMatchingDatabase();
  const [{ data: request }, { data: zones }, { data: preferences }] = await Promise.all([
    supabase.from("property_requests").select("*").eq("id", requestId).single(),
    supabase.from("request_zones").select("zone_id,preference_level").eq("request_id", requestId),
    supabase.from("request_feature_preferences").select("feature_definition_id,preference_level,desired_value,custom_weight").eq("request_id", requestId),
  ]);
  if (!request) throw new Error("Richiesta non trovata.");
  const { id: _id, created_at: _created, updated_at: _updated, ...copy } = request;
  void _id; void _created; void _updated;
  const { data, error } = await supabase.from("property_requests").insert({
    ...copy, title: `${copy.title || "Richiesta"} — copia`, status: "draft",
  }).select().single();
  if (error || !data) throw new Error(error?.message ?? "Duplicazione non riuscita.");
  if (zones?.length) await supabase.from("request_zones").insert(zones.map((item) => ({ ...item, request_id: data.id })));
  if (preferences?.length) await supabase.from("request_feature_preferences").insert(preferences.map((item) => ({ ...item, request_id: data.id })));
  await logMatchingActivity("request", data.id, "duplicated", { from: requestId });
  refreshAll();
  return data.id as string;
}

export async function deleteRequestAction(requestId: string) {
  await requireUser();
  const { error } = await requireMatchingDatabase().from("property_requests").delete().eq("id", requestId);
  if (error) throw new Error(error.message);
  refreshAll();
}

export async function deletePropertyAction(propertyId: string) {
  await requireUser();
  const { error } = await requireMatchingDatabase().from("portfolio_properties").delete().eq("id", propertyId);
  if (error) throw new Error(error.message);
  refreshAll();
}

export async function deleteZoneAction(zoneId: string) {
  await requireUser();
  const supabase = requireMatchingDatabase();
  const [{ count: requestCount }, { count: propertyCount }] = await Promise.all([
    supabase.from("request_zones").select("*", { count: "exact", head: true }).eq("zone_id", zoneId),
    supabase.from("portfolio_properties").select("*", { count: "exact", head: true }).eq("internal_zone_id", zoneId),
  ]);
  if ((requestCount ?? 0) + (propertyCount ?? 0) > 0) {
    throw new Error("La zona è utilizzata: disattivala invece di eliminarla.");
  }
  const { error } = await supabase.from("internal_zones").delete().eq("id", zoneId);
  if (error) throw new Error(error.message);
  refreshAll();
}

export async function updateMatchStatusAction(matchId: string, status: unknown) {
  await requireUser();
  const parsed = matchStatusSchema.parse(status);
  const { error } = await requireMatchingDatabase().from("request_property_matches").update({ status: parsed }).eq("id", matchId);
  if (error) throw new Error(error.message);
  await logMatchingActivity("match", matchId, "status_changed", { status: parsed });
  refreshAll();
}

export async function recalculateAction(scope: "all" | "request" | "property", id?: string) {
  await requireUser();
  if (scope === "request" && id) await recalculateMatchesForRequest(id);
  else if (scope === "property" && id) await recalculateMatchesForProperty(id);
  else await recalculateAllActiveMatches();
  refreshAll();
}

export async function saveFeatureAction(input: unknown) {
  await requireUser();
  const { id, ...feature } = featureDefinitionSchema.parse(input);
  const supabase = requireMatchingDatabase();
  const query = id ? supabase.from("feature_definitions").update(feature).eq("id", id) : supabase.from("feature_definitions").insert(feature);
  const { error } = await query;
  if (error) throw new Error(error.message);
  refreshAll();
}

export async function saveMatchingConfigAction(input: unknown) {
  await requireUser();
  const current = await getMatchingConfig();
  const value = { ...current, ...(input as object) };
  const { error } = await requireMatchingDatabase().from("app_settings").upsert({ key: "matching_config", value });
  if (error) throw new Error(error.message);
  refreshAll();
}
