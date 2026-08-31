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
  request_feature_preferences?: Array<{
    preference_level: string;
    feature: { key: string; label: string } | null;
  }>;
}>> {
  if (!configured()) return [];
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("property_requests")
      .select("*, clients(id,full_name,phone,email,raw_payload), request_zones(preference_level, zone:internal_zones(id,name)), request_feature_preferences(preference_level, feature:feature_definitions(key,label))")
      .order("created_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as Array<PropertyRequest & {
      clients?: Pick<Client, "id" | "full_name" | "phone" | "email" | "raw_payload"> | null;
      request_zones?: Array<{
        preference_level: string;
        zone: { id: string; name: string } | null;
      }>;
      request_feature_preferences?: Array<{
        preference_level: string;
        feature: { key: string; label: string } | null;
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
      .eq("is_active", true)
      .not("zone_number", "is", null)
      .order("zone_number", { ascending: true });
    if (error) return [];
    return (data ?? []) as InternalZone[];
  } catch {
    return [];
  }
}
export const listFeatures = () => safeList<FeatureDefinition>("feature_definitions", "sort_order", true);

/**
 * Sotto questo punteggio un abbinamento non e' una proposta.
 *
 * Non e' una soglia tecnica ma una decisione commerciale: sotto il settanta per
 * cento la casa non si porta al cliente, quindi non deve nemmeno occupargli lo
 * schermo. Sopra questa soglia stanno gli abbinamenti che si mostrano; sotto
 * ci sono sia gli esclusi dai filtri duri — contratto, tipologia, ascensore
 * obbligatorio, tutti a zero — sia quelli semplicemente troppo deboli.
 *
 * Le righe restano in tabella e le statistiche continuano a contarle: servono a
 * sapere quanto lavoro il motore ha scartato, e a spiegare un'assenza quando
 * qualcuno chiede perche' un immobile non compare. La stessa soglia vale nella
 * funzione `matching_request_coverage`, che decide quali richieste sono
 * scoperte: se cambia qui, va cambiata anche li'.
 */
export const MIN_PROPOSABLE_SCORE = 70;

export async function listMatches(options: {
  limit?: number;
  classification?: string;
  minimum?: number;
  requestIds?: string[];
  /** Include anche gli abbinamenti sotto soglia, per diagnosticare un'assenza. */
  includeExcluded?: boolean;
} = {}): Promise<RequestPropertyMatch[]> {
  if (!configured()) return [];
  try {
    let query = getSupabaseServiceClient().from("request_property_matches").select("*");
    if (!options.includeExcluded) query = query.gte("score", MIN_PROPOSABLE_SCORE);
    if (options.classification) query = query.eq("classification", options.classification);
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
  lastCalculatedAt: string | null;
};

export async function getMatchingStats(): Promise<MatchingStats> {
  const empty = { total: 0, compatible: 0, almostCompatible: 0, weak: 0, notRelevant: 0, lastCalculatedAt: null };
  if (!configured()) return empty;
  try {
    const db = getSupabaseServiceClient();
    const count = (column?: string, value?: string | string[]) => {
      let query = db.from("request_property_matches").select("id", { count: "exact", head: true });
      if (column && Array.isArray(value)) query = query.in(column, value);
      else if (column && value) query = query.eq(column, value);
      return query;
    };
    const [total, compatible, almostCompatible, weak, notRelevant, latest] = await Promise.all([
      count(), count("classification", "compatible"), count("classification", "almost_compatible"),
      count("classification", "weak"), count("classification", "not_relevant"),
      db.from("request_property_matches").select("last_calculated_at").order("last_calculated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if ([total, compatible, almostCompatible, weak, notRelevant, latest].some((result) => result.error)) return empty;
    return {
      total: total.count ?? 0, compatible: compatible.count ?? 0,
      almostCompatible: almostCompatible.count ?? 0, weak: weak.count ?? 0,
      notRelevant: notRelevant.count ?? 0, lastCalculatedAt: latest.data?.last_calculated_at ?? null,
    };
  } catch {
    return empty;
  }
}

/**
 * Quante case somigliano a ogni richiesta.
 *
 * Prima si scaricavano tutti gli abbinamenti compatibili per contarli qui:
 * quasi duemila righe, chieste mille alla volta una dopo l'altra, per ottenere
 * un numero per richiesta. Il conteggio lo fa il database, e torna già fatto.
 *
 * La paginazione esisteva perché senza `range` PostgREST ne restituisce mille
 * e tace: le 872 righe oltre il migliaio sparivano, e 159 richieste su 254
 * leggevano «nessuna casa le somiglia» — una frase falsa scritta con la stessa
 * sicurezza di una vera. Con un conteggio raggruppato il problema non esiste.
 */
export async function countCompatibleMatchesByRequest(): Promise<Map<string, number>> {
  const conteggi = new Map<string, number>();
  if (!configured()) return conteggi;

  try {
    const { data, error } = await getSupabaseServiceClient().rpc(
      "matching_compatible_counts",
    );
    if (error) return conteggi;

    for (const riga of (data ?? []) as Array<{
      request_id: string;
      compatible_count: number;
    }>) {
      conteggi.set(riga.request_id, riga.compatible_count);
    }
  } catch {
    return conteggi;
  }

  return conteggi;
}

/** Quanto e' coperta una richiesta: il meglio che il portafoglio sa offrirle. */
export type RequestCoverage = {
  /** Il punteggio dell'abbinamento migliore, per distinguere le urgenze. */
  bestScore: number;
  /** Abbinamenti non esclusi da un filtro duro. */
  proposableCount: number;
  /** Abbinamenti che superano la soglia oltre la quale vale la pena mostrarli. */
  relevantCount: number;
};

/**
 * Quanto e' coperta ogni richiesta.
 *
 * Il conteggio arriva dal database perche' l'elenco delle richieste scoperte
 * dev'essere esatto: ricavarlo dalle righe gia' scaricate, che hanno un limite,
 * farebbe sembrare scoperte le richieste rimaste fuori dal taglio.
 *
 * Ritorna `null`, e non una mappa vuota, quando il conteggio non riesce: una
 * mappa vuota si leggerebbe come «nessuna richiesta ha abbinamenti», che e' la
 * risposta sbagliata piu' credibile che questa funzione possa dare.
 */
export async function getRequestCoverage(): Promise<Map<string, RequestCoverage> | null> {
  if (!configured()) return null;

  try {
    const { data, error } = await getSupabaseServiceClient().rpc(
      "matching_request_coverage",
    );
    if (error) return null;

    const copertura = new Map<string, RequestCoverage>();
    for (const riga of (data ?? []) as Array<{
      request_id: string;
      best_score: number | string | null;
      proposable_count: number;
      relevant_count: number;
    }>) {
      copertura.set(riga.request_id, {
        bestScore: Number(riga.best_score ?? 0),
        proposableCount: riga.proposable_count,
        relevantCount: riga.relevant_count,
      });
    }
    return copertura;
  } catch {
    return null;
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
    supabase.from("request_property_matches").select("*, property:portfolio_properties(*)").eq("request_id", id).gte("score", MIN_PROPOSABLE_SCORE).order("score", { ascending: false }),
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
    supabase.from("request_property_matches").select("*, request:property_requests(*, clients(*))").eq("property_id", id).gte("score", MIN_PROPOSABLE_SCORE).order("score", { ascending: false }),
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
