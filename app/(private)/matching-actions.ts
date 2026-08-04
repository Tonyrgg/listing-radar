"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  clientSchema, featureDefinitionSchema, matchStatusSchema,
  portfolioPropertySchema, propertyRequestSchema, zoneSchema,
} from "@/lib/matching/schemas";
import { estimateCommercialSqm } from "@/lib/matching/scoring";
import { suggestedZonePreferencesForRequest, zoneContainingPoint } from "@/lib/map/geometry";
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
  if (error || !data) {
    const missingRequestFormat =
      error?.code === "PGRST204"
      || error?.code === "42703"
      || /destination|financing_method|requested_floor_band|credit_status/i.test(error?.message ?? "");
    throw new Error(
      missingRequestFormat
        ? "Applica la migration 007_request_real_estate_format.sql in Supabase prima di salvare il nuovo formato."
        : error?.message ?? "Richiesta non salvata.",
    );
  }
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
  const { feature_values, id, ...propertyInput } = parsed;
  const supabase = requireMatchingDatabase();
  const zones = await getZonesWithGeometry(supabase);
  const detectedZone = propertyInput.latitude != null && propertyInput.longitude != null
    ? zoneContainingPoint(zones, { latitude: propertyInput.latitude, longitude: propertyInput.longitude })
    : null;
  const property = {
    ...propertyInput,
    internal_zone_id: detectedZone?.id ?? propertyInput.internal_zone_id,
  };
  const save = (payload: typeof property | Omit<typeof property, "latitude" | "longitude">) => id
    ? supabase.from("portfolio_properties").update(payload).eq("id", id).select().single()
    : supabase.from("portfolio_properties").insert(payload).select().single();
  let { data, error } = await save(property);
  const missingCoordinateColumns = error && (
    error.code === "PGRST204" || error.code === "42703" || /latitude|longitude/i.test(error.message)
  );
  if (missingCoordinateColumns && property.latitude == null && property.longitude == null) {
    const { latitude: _latitude, longitude: _longitude, ...legacyProperty } = property;
    void _latitude; void _longitude;
    ({ data, error } = await save(legacyProperty));
  }
  if (error || !data) {
    throw new Error(
      missingCoordinateColumns
        ? "Applica la migration 009_zone_geometries_and_property_coordinates.sql prima di salvare il punto sulla mappa."
        : error?.message ?? "Immobile non salvato.",
    );
  }
  await supabase.from("property_feature_values").delete().eq("property_id", data.id);
  if (feature_values.length) await supabase.from("property_feature_values").insert(feature_values.map((item) => ({ ...item, property_id: data.id })));
  await logMatchingActivity("property", data.id, id ? "updated" : "created");
  if (property.mandate_status === "active") await recalculateMatchesForProperty(data.id);
  refreshAll();
  return { id: data.id };
}

export async function saveZoneAction(input: unknown) {
  await requireUser();
  const { id, geometry, area_color, ...zoneInput } = zoneSchema.parse(input);
  const supabase = requireMatchingDatabase();
  let mapAreaId = zoneInput.map_area_id ?? null;

  if (geometry) {
    const areaPayload = {
      name: zoneInput.name,
      color: area_color ?? "#5fbf7a",
      geometry,
      status: "completed",
    };
    if (mapAreaId) {
      const { error } = await supabase.from("map_areas").update(areaPayload).eq("id", mapAreaId);
      if (error) throw new Error(error.message);
    } else {
      const { data: area, error } = await supabase.from("map_areas").insert(areaPayload).select("id").single();
      if (error || !area) throw new Error(error?.message ?? "Area non salvata.");
      mapAreaId = area.id;
    }
  } else if (mapAreaId && area_color) {
    const { error } = await supabase.from("map_areas").update({ color: area_color }).eq("id", mapAreaId);
    if (error) throw new Error(error.message);
  }

  const zone = { ...zoneInput, map_area_id: mapAreaId };
  const query = id
    ? supabase.from("internal_zones").update(zone).eq("id", id).select("id").single()
    : supabase.from("internal_zones").insert(zone).select("id").single();
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message ?? "Zona non salvata.");
  await logMatchingActivity("zone", data.id, id ? "updated" : "created", { map_area_id: mapAreaId });
  refreshAll();
  return { id: data.id as string, mapAreaId };
}

export async function unlinkZoneAreaAction(zoneId: string) {
  await requireUser();
  const id = zoneSchema.shape.id.unwrap().parse(zoneId);
  const { error } = await requireMatchingDatabase().from("internal_zones").update({ map_area_id: null }).eq("id", id);
  if (error) throw new Error(error.message);
  await logMatchingActivity("zone", id, "map_area_unlinked");
  refreshAll();
}

export async function saveRequestZonesAction(requestId: string, zoneIds: string[], excludedZoneIds: string[] = []) {
  await requireUser();
  const id = propertyRequestSchema.shape.id.unwrap().parse(requestId);
  const parsedZoneIds = Array.from(new Set(zoneIds.map((zoneId) => zoneSchema.shape.id.unwrap().parse(zoneId))));
  const parsedExcludedIds = Array.from(new Set(excludedZoneIds.map((zoneId) => zoneSchema.shape.id.unwrap().parse(zoneId))))
    .filter((zoneId) => !parsedZoneIds.includes(zoneId));
  const supabase = requireMatchingDatabase();
  const { error: deleteError } = await supabase.from("request_zones").delete().eq("request_id", id);
  if (deleteError) throw new Error(deleteError.message);
  if (parsedZoneIds.length || parsedExcludedIds.length) {
    const { error } = await supabase.from("request_zones").insert([
      ...parsedZoneIds.map((zone_id) => ({ request_id: id, zone_id, preference_level: "preferred" })),
      ...parsedExcludedIds.map((zone_id) => ({ request_id: id, zone_id, preference_level: "excluded" })),
    ]);
    if (error) throw new Error(error.message);
  }
  await logMatchingActivity("request", id, "zones_updated", { zone_ids: parsedZoneIds, excluded_zone_ids: parsedExcludedIds });
  await recalculateMatchesForRequest(id);
  refreshAll();
  return { count: parsedZoneIds.length, excludedCount: parsedExcludedIds.length };
}

export async function backfillRequestZonesAction() {
  await requireUser();
  const supabase = requireMatchingDatabase();
  const zones = await getZonesWithGeometry(supabase);
  const [{ data: requests, error: requestError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from("property_requests").select("id,title,notes,raw_payload"),
    supabase.from("request_zones").select("request_id"),
  ]);
  if (requestError || existingError) throw new Error(requestError?.message ?? existingError?.message ?? "Archivio non disponibile.");
  const linkedRequests = new Set((existing ?? []).map((item) => item.request_id));
  const rows = (requests ?? []).flatMap((request) => {
    if (linkedRequests.has(request.id)) return [];
    return suggestedZonePreferencesForRequest(request, zones).map(({ zoneId: zone_id, preferenceLevel: preference_level }) => ({
      request_id: request.id,
      zone_id,
      preference_level,
    }));
  });
  if (rows.length) {
    const { error } = await supabase.from("request_zones").upsert(rows, { onConflict: "request_id,zone_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const requestsUpdated = new Set(rows.map((row) => row.request_id)).size;
  await logMatchingActivity("request_zone_backfill", null, "crm_zones_backfilled", { requestsUpdated, linksCreated: rows.length });
  refreshAll();
  return { requestsUpdated, linksCreated: rows.length };
}

async function getZonesWithGeometry(supabase: ReturnType<typeof requireMatchingDatabase>) {
  const [{ data: zones }, { data: areas }] = await Promise.all([
    supabase.from("internal_zones").select("*"),
    supabase.from("map_areas").select("id,name,color,geometry,status"),
  ]);
  const areasById = new Map((areas ?? []).map((area) => [area.id, area]));
  return (zones ?? []).map((zone) => ({
    ...zone,
    map_area: zone.map_area_id ? areasById.get(zone.map_area_id) ?? null : null,
  }));
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
