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
  clients?: Pick<Client, "id" | "full_name" | "phone" | "email" | "raw_payload"> | null;
  request_zones?: Array<{
    preference_level: string;
    zone: { id: string; name: string } | null;
  }>;
}>> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("property_requests")
      .select("*, clients(id,full_name,phone,email,raw_payload), request_zones(preference_level, zone:internal_zones(id,name))")
      .order("created_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as Array<PropertyRequest & {
      clients?: Pick<Client, "id" | "full_name" | "phone" | "email" | "raw_payload"> | null;
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
export async function listZones(): Promise<InternalZone[]> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("internal_zones")
      .select("*")
      .order("name", { ascending: true });
    if (error) return [];
    return (data ?? []) as InternalZone[];
  } catch {
    return [];
  }
}
export const listFeatures = () => safeList<FeatureDefinition>("feature_definitions", "sort_order", true);
export async function listMatches(options: {
  limit?: number;
  classification?: string;
  status?: string;
  minimum?: number;
  requestIds?: string[];
} = {}): Promise<RequestPropertyMatch[]> {
  if (!configured()) return [];
  try {
    let query = getSupabaseServiceClient().from("request_property_matches").select("*");
    if (options.classification) query = query.eq("classification", options.classification);
    if (options.status) query = query.eq("status", options.status);
    if (options.minimum) query = query.gte("score", options.minimum);
    if (options.requestIds) {
      if (!options.requestIds.length) return [];
      query = query.in("request_id", options.requestIds);
    }
    const { data, error } = await query.order("score", { ascending: false }).limit(options.limit ?? 300);
    if (error) return [];
    return (data ?? []) as RequestPropertyMatch[];
  } catch {
    return [];
  }
}

export type MatchingStats = {
  total: number;
  compatible: number;
  almostCompatible: number;
  weak: number;
  notRelevant: number;
  toPropose: number;
  inProgress: number;
  lastCalculatedAt: string | null;
};

export async function getMatchingStats(): Promise<MatchingStats> {
  const empty = { total: 0, compatible: 0, almostCompatible: 0, weak: 0, notRelevant: 0, toPropose: 0, inProgress: 0, lastCalculatedAt: null };
  if (!configured()) return empty;
  try {
    const db = getSupabaseServiceClient();
    const count = (column?: string, value?: string | string[]) => {
      let query = db.from("request_property_matches").select("id", { count: "exact", head: true });
      if (column && Array.isArray(value)) query = query.in(column, value);
      else if (column && value) query = query.eq(column, value);
      return query;
    };
    const [total, compatible, almostCompatible, weak, notRelevant, toPropose, inProgress, latest] = await Promise.all([
      count(), count("classification", "compatible"), count("classification", "almost_compatible"),
      count("classification", "weak"), count("classification", "not_relevant"), count("status", "to_propose"),
      count("status", ["proposed", "interested", "visit_scheduled", "negotiation"]),
      db.from("request_property_matches").select("last_calculated_at").order("last_calculated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if ([total, compatible, almostCompatible, weak, notRelevant, toPropose, inProgress, latest].some((result) => result.error)) return empty;
    return {
      total: total.count ?? 0, compatible: compatible.count ?? 0,
      almostCompatible: almostCompatible.count ?? 0, weak: weak.count ?? 0,
      notRelevant: notRelevant.count ?? 0, toPropose: toPropose.count ?? 0,
      inProgress: inProgress.count ?? 0, lastCalculatedAt: latest.data?.last_calculated_at ?? null,
    };
  } catch {
    return empty;
  }
}

export async function listCompatibleMatchReferences(): Promise<Array<Pick<RequestPropertyMatch, "request_id" | "classification">>> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("request_property_matches")
      .select("request_id,classification")
      .eq("classification", "compatible");
    if (error) return [];
    return (data ?? []) as Array<Pick<RequestPropertyMatch, "request_id" | "classification">>;
  } catch {
    return [];
  }
}
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

export async function getMatch(id: string): Promise<RequestPropertyMatch | null> {
  if (!configured()) return null;
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("request_property_matches")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    return data as RequestPropertyMatch | null;
  } catch {
    return null;
  }
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
