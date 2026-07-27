import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type {
  Client, FeatureDefinition, InternalZone, MatchingConfig, PortfolioProperty,
  PropertyRequest, RequestPropertyMatch,
} from "./types";
import { DEFAULT_MATCHING_CONFIG } from "./scoring";

function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function safeList<T>(table: string, order = "created_at", ascending = false): Promise<T[]> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from(table).select("*").order(order, { ascending });
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

export async function listRequests(): Promise<Array<PropertyRequest & {
  clients?: { full_name: string | null } | null;
  request_zones?: Array<{
    preference_level: string;
    zone: { id: string; name: string } | null;
  }>;
}>> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("property_requests")
      .select("*, clients(full_name), request_zones(preference_level, zone:internal_zones(id,name))")
      .order("created_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as Array<PropertyRequest & {
      clients?: { full_name: string | null } | null;
      request_zones?: Array<{
        preference_level: string;
        zone: { id: string; name: string } | null;
      }>;
    }>;
  } catch {
    return [];
  }
}

export async function listProperties(): Promise<Array<PortfolioProperty & {
  zone?: { name: string } | null;
  property_feature_values?: Array<{
    value: unknown;
    feature: { key: string; label: string } | null;
  }>;
}>> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("portfolio_properties")
      .select("*, zone:internal_zones(name), property_feature_values(value, feature:feature_definitions(key,label))")
      .order("created_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as Array<PortfolioProperty & {
      zone?: { name: string } | null;
      property_feature_values?: Array<{
        value: unknown;
        feature: { key: string; label: string } | null;
      }>;
    }>;
  } catch {
    return [];
  }
}
export const listZones = () => safeList<InternalZone>("internal_zones", "name", true);
export const listFeatures = () => safeList<FeatureDefinition>("feature_definitions", "sort_order", true);
export const listMatches = () => safeList<RequestPropertyMatch>("request_property_matches", "score", false);
export const listClients = () => safeList<Client>("clients", "full_name", true);

export async function getRequest(id: string) {
  if (!configured()) return null;
  const supabase = getSupabaseServiceClient();
  const [{ data: request }, { data: zones }, { data: features }, { data: matches }, { data: logs }] = await Promise.all([
    supabase.from("property_requests").select("*, clients(*)").eq("id", id).maybeSingle(),
    supabase.from("request_zones").select("*, zone:internal_zones(*)").eq("request_id", id),
    supabase.from("request_feature_preferences").select("*, feature:feature_definitions(*)").eq("request_id", id),
    supabase.from("request_property_matches").select("*, property:portfolio_properties(*)").eq("request_id", id).order("score", { ascending: false }),
    supabase.from("matching_activity_logs").select("*").eq("entity_type", "request").eq("entity_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  return request ? { request, zones: zones ?? [], features: features ?? [], matches: matches ?? [], logs: logs ?? [] } : null;
}

export async function getProperty(id: string) {
  if (!configured()) return null;
  const supabase = getSupabaseServiceClient();
  const [{ data: property }, { data: features }, { data: matches }] = await Promise.all([
    supabase.from("portfolio_properties").select("*, zone:internal_zones(*)").eq("id", id).maybeSingle(),
    supabase.from("property_feature_values").select("*, feature:feature_definitions(*)").eq("property_id", id),
    supabase.from("request_property_matches").select("*, request:property_requests(*, clients(*))").eq("property_id", id).order("score", { ascending: false }),
  ]);
  return property ? { property, features: features ?? [], matches: matches ?? [] } : null;
}

export async function getMatchingConfig(): Promise<MatchingConfig> {
  if (!configured()) return DEFAULT_MATCHING_CONFIG;
  const { data } = await getSupabaseServiceClient()
    .from("app_settings").select("value").eq("key", "matching_config").maybeSingle();
  return data?.value ? { ...DEFAULT_MATCHING_CONFIG, ...(data.value as Partial<MatchingConfig>) } : DEFAULT_MATCHING_CONFIG;
}

export async function logMatchingActivity(
  entityType: string, entityId: string | null, action: string, details: unknown = {},
) {
  if (!configured()) return;
  await getSupabaseServiceClient().from("matching_activity_logs").insert({
    entity_type: entityType, entity_id: entityId, action, details,
  });
}

export function requireMatchingDatabase() {
  if (!configured()) throw new Error("Configura Supabase prima di salvare.");
  return getSupabaseServiceClient();
}
