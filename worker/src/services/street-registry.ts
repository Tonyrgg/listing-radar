import type { SupabaseClient } from "@supabase/supabase-js";

export type StreetRegistryScope = "city" | "zone";
export type StreetRegistryWorkStatus = "pending" | "in_progress" | "completed" | "to_recheck" | "skipped" | "failed";
export type StreetRegistryOutcome = Exclude<StreetRegistryWorkStatus, "pending" | "in_progress">;
export type StreetRegistryZoneOption = { id: string; zone_number: number | null; name: string };

export type StreetRegistryQueueItem = {
  work_item_id: string;
  workflow: "owner_network";
  work_status: StreetRegistryWorkStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  lease_expires_at: string | null;
  last_job_id: string | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_result: Record<string, unknown> | null;
  last_error: Record<string, unknown> | null;
  street_id: string;
  official_code: string;
  municipality: string;
  locality: string | null;
  canonical_name: string;
  normalized_name: string;
  sister_search_name: string;
  geometry_match_status: "unresolved" | "exact" | "manual" | "ambiguous" | "rejected";
  centroid_latitude: number | null;
  centroid_longitude: number | null;
  city_distance_m: number | null;
  city_rank: number | null;
  city_ring: number | null;
  zone_id: string | null;
  zone_number: number | null;
  zone_name: string | null;
  zone_assignment_method: string | null;
  zone_assignment_confidence: number | null;
  zone_distance_m: number | null;
  zone_rank: number | null;
  zone_ring: number | null;
};

/**
 * Traduce l'esito di una run via nell'esito da registrare in coda.
 *
 * Una sospensione non e' un fallimento: la via torna disponibile come da
 * ricontrollare, altrimenti una pausa dell'operatore la marchierebbe come
 * fallita e le brucerebbe un tentativo.
 */
export function streetRunRegistryOutcome(input: {
  status: string;
  lastError?: string | null;
  runError?: string | null;
}): StreetRegistryOutcome {
  if (input.status === "completed" && !input.lastError && !input.runError) return "completed";
  return "to_recheck";
}

export class StreetRegistryService {
  constructor(private readonly client: SupabaseClient) {}

  async zones(): Promise<StreetRegistryZoneOption[]> {
    const response = await this.client.from("internal_zones")
      .select("id,zone_number,name")
      .eq("is_active", true)
      .not("zone_number", "is", null)
      .order("zone_number", { ascending: true });
    if (response.error) throw new Error(`Lettura zone Street Registry fallita: ${response.error.message}`);
    return (response.data ?? []) as StreetRegistryZoneOption[];
  }

  async list(options: {
    zoneId?: string;
    workerId?: string;
    scope?: StreetRegistryScope;
    status?: StreetRegistryWorkStatus;
    limit?: number;
  } = {}): Promise<StreetRegistryQueueItem[]> {
    const scope = options.scope ?? "city";
    const limit = Math.max(1, Math.min(500, options.limit ?? 100));
    let query = this.client.from("street_registry_worker_queue").select("*");
    if (options.zoneId) query = query.eq("zone_id", options.zoneId);
    if (options.workerId) query = query.eq("worker_id", options.workerId);
    if (options.status) query = query.eq("work_status", options.status);
    const result = await query
      .order(scope === "zone" ? "zone_rank" : "city_rank", { ascending: true, nullsFirst: false })
      .order("official_code", { ascending: true })
      .limit(limit);
    if (result.error) throw new Error(`Lettura Street Registry fallita: ${result.error.message}`);
    return (result.data ?? []) as StreetRegistryQueueItem[];
  }

  async claim(options: {
    workerId: string;
    zoneId?: string;
    scope?: StreetRegistryScope;
    leaseSeconds?: number;
  }): Promise<StreetRegistryQueueItem | null> {
    const result = await this.client.rpc("claim_street_registry_work", {
      p_worker_id: options.workerId,
      p_zone_id: options.zoneId ?? null,
      p_order_scope: options.scope ?? (options.zoneId ? "zone" : "city"),
      p_lease_seconds: options.leaseSeconds ?? 1800,
    });
    if (result.error) throw new Error(`Presa in carico via fallita: ${result.error.message}`);
    return (result.data ?? null) as StreetRegistryQueueItem | null;
  }

  async activeClaim(workerId: string): Promise<StreetRegistryQueueItem | null> {
    const rows = await this.list({ workerId, status: "in_progress", limit: 1 });
    return rows[0] ?? null;
  }

  async renew(options: {
    workItemId: string;
    workerId: string;
    leaseSeconds?: number;
  }): Promise<StreetRegistryQueueItem> {
    const response = await this.client.rpc("renew_street_registry_work", {
      p_work_item_id: options.workItemId,
      p_worker_id: options.workerId,
      p_lease_seconds: options.leaseSeconds ?? 1800,
    });
    if (response.error) throw new Error(`Rinnovo presa in carico via fallito: ${response.error.message}`);
    if (!response.data) throw new Error("La lavorazione via non è stata restituita dopo il rinnovo");
    return response.data as StreetRegistryQueueItem;
  }

  async complete(options: {
    workItemId: string;
    workerId: string;
    outcome: StreetRegistryOutcome;
    propertyWorkerJobId?: string;
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
  }): Promise<StreetRegistryQueueItem> {
    const response = await this.client.rpc("complete_street_registry_work", {
      p_work_item_id: options.workItemId,
      p_worker_id: options.workerId,
      p_outcome: options.outcome,
      p_property_worker_job_id: options.propertyWorkerJobId ?? null,
      p_result: options.result ?? null,
      p_error: options.error ?? null,
    });
    if (response.error) throw new Error(`Chiusura lavorazione via fallita: ${response.error.message}`);
    if (!response.data) throw new Error("La lavorazione via non è stata restituita dopo il completamento");
    return response.data as StreetRegistryQueueItem;
  }
}
