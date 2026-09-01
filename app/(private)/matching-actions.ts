"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  clientSchema, featureDefinitionSchema,
  portfolioPropertySchema, propertyRequestSchema, zoneSchema,
} from "@/lib/matching/schemas";
import { ELEVATOR_FEATURE_KEY } from "@/lib/matching/elevator";
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
  const zones = await getPropertyZones(supabase);
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

/**
 * L'ascensore di un immobile, registrato una risposta alla volta.
 *
 * Il portafoglio arriva dal gestionale, che l'ascensore non lo dice: nessuna
 * scheda lo aveva, e con la regola dell'ascensore un dato mancante vale «no».
 * Finche' resta vuoto, chi ha chiesto l'ascensore non vede niente e chi ce
 * l'ha non lo puo' proporre. Questa e' l'azione che riempie quel vuoto.
 *
 * «Non lo so» cancella la riga invece di scrivere un no: una risposta che non
 * abbiamo non va registrata come una risposta che abbiamo dato. Per il motore
 * il risultato non cambia — assente vale «no» — ma a schermo la scheda torna a
 * dire «ascensore non rilevato», che e' la verita' e si vede che manca.
 */
export async function setPropertyElevatorAction(propertyId: string, value: boolean | null) {
  await requireUser();
  const supabase = requireMatchingDatabase();
  const { data: feature, error: featureError } = await supabase
    .from("feature_definitions").select("id").eq("key", ELEVATOR_FEATURE_KEY).maybeSingle();
  if (featureError) throw new Error(featureError.message);
  if (!feature) throw new Error("La caratteristica «Ascensore» non esiste: applica il seed delle caratteristiche.");

  const { error } = value === null
    ? await supabase.from("property_feature_values").delete()
      .eq("property_id", propertyId).eq("feature_definition_id", feature.id)
    : await supabase.from("property_feature_values")
      .upsert({ property_id: propertyId, feature_definition_id: feature.id, value }, { onConflict: "property_id,feature_definition_id" });
  if (error) throw new Error(error.message);

  await logMatchingActivity("property", propertyId, "updated", { elevator: value });
  await recalculateMatchesForProperty(propertyId);
  revalidatePath("/portfolio/ascensori");
  refreshAll();
  return { value };
}

export async function saveZoneAction(input: unknown) {
  await requireUser();
  const { id, ...zone } = zoneSchema.parse(input);
  const supabase = requireMatchingDatabase();
  const query = id
    ? supabase.from("internal_zones").update(zone).eq("id", id).select("id").single()
    : supabase.from("internal_zones").insert(zone).select("id").single();
  const { data, error } = await query;
  const missingGeometryColumns = error && (
    error.code === "PGRST204" || error.code === "42703" || /geometry|color/i.test(error.message)
  );
  if (error || !data) throw new Error(
    missingGeometryColumns
      ? "Applica la migration 010_separate_operational_and_property_zones.sql prima di salvare le zone immobiliari."
      : error?.message ?? "Zona non salvata.",
  );
  await logMatchingActivity("zone", data.id, id ? "updated" : "created", { has_geometry: Boolean(zone.geometry) });
  refreshAll();
  return { id: data.id as string };
}

export async function clearZoneGeometryAction(zoneId: string) {
  await requireUser();
  const id = zoneSchema.shape.id.unwrap().parse(zoneId);
  const { error } = await requireMatchingDatabase().from("internal_zones").update({ geometry: null }).eq("id", id);
  if (error) throw new Error(error.message);
  await logMatchingActivity("zone", id, "property_zone_geometry_cleared");
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
  const zones = await getPropertyZones(supabase);
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

async function getPropertyZones(supabase: ReturnType<typeof requireMatchingDatabase>) {
  const { data, error } = await supabase.from("internal_zones").select("*")
    .eq("is_active", true)
    .not("zone_number", "is", null)
    .order("zone_number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as import("@/lib/matching/types").InternalZone[];
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
