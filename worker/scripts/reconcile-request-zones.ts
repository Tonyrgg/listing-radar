import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import type { CrmRequestActivity, CrmRequestDetail } from "../src/adapters/crm/requests.js";
import { loadConfig } from "../src/config.js";
import { inferRequestZonePreferences, type RequestInferenceZone } from "../src/services/request-zone-inference.js";

type RequestRow = { id: string; raw_payload: Record<string, unknown> | null };
type Backup = { zones?: Array<{ request_id: string; zone_id: string; preference_level: string }> };

const config = loadConfig();
const database = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backupPath = process.argv[2] ?? resolve(scriptDirectory, "../../.backups/requests-before-activity-sync-2026-08-05.json");
const backup = JSON.parse(await readFile(backupPath, "utf8")) as Backup;
const requestsWithPreexistingZones = new Set((backup.zones ?? []).map((row) => row.request_id));

const [{ data: activeRun, error: activeRunError }, { data: requests, error: requestError }, { data: zones, error: zoneError }] = await Promise.all([
  database.from("crm_request_import_runs").select("id").eq("status", "running").limit(1).maybeSingle(),
  database.from("property_requests").select("id,raw_payload"),
  database.from("internal_zones").select("id,zone_number,name,aliases,landmarks,associated_streets")
    .eq("is_active", true).not("zone_number", "is", null).order("zone_number", { ascending: true }),
]);
if (activeRunError) throw activeRunError;
if (activeRun) throw new Error("La sincronizzazione richieste è ancora attiva: attendi la conclusione prima di riallineare le zone.");
if (requestError) throw requestError;
if (zoneError) throw zoneError;

let payloadsUpdated = 0;
let linksRemoved = 0;
let linksUpserted = 0;

for (const request of (requests ?? []) as RequestRow[]) {
  const rawPayload = request.raw_payload ?? {};
  const fields = typeof rawPayload.fields === "object" && rawPayload.fields ? rawPayload.fields as Record<string, string | number | boolean | null> : {};
  const activities = Array.isArray(rawPayload.activities) ? rawPayload.activities as CrmRequestActivity[] : [];
  const detail = {
    fields,
    evolutionText: typeof rawPayload.evolutionText === "string" ? rawPayload.evolutionText : null,
    activities,
  } as CrmRequestDetail;
  const inferred = inferRequestZonePreferences(detail, (zones ?? []) as RequestInferenceZone[]);
  const previousInference = Array.isArray(rawPayload._zone_inference)
    ? rawPayload._zone_inference as Array<{ zone_id?: string }>
    : [];

  if (JSON.stringify(previousInference) !== JSON.stringify(inferred)) {
    const { error } = await database.from("property_requests").update({ raw_payload: { ...rawPayload, _zone_inference: inferred } }).eq("id", request.id);
    if (error) throw error;
    payloadsUpdated += 1;
  }

  if (requestsWithPreexistingZones.has(request.id)) continue;

  const previouslyGeneratedZoneIds = previousInference.map((item) => item.zone_id).filter((id): id is string => Boolean(id));
  if (previouslyGeneratedZoneIds.length) {
    const { data: removed, error } = await database.from("request_zones").delete().eq("request_id", request.id)
      .in("zone_id", previouslyGeneratedZoneIds).select("id");
    if (error) throw error;
    linksRemoved += removed?.length ?? 0;
  }
  if (inferred.length) {
    const { error } = await database.from("request_zones").upsert(inferred.map((zone) => ({
      request_id: request.id,
      zone_id: zone.zone_id,
      preference_level: zone.preference_level,
    })), { onConflict: "request_id,zone_id" });
    if (error) throw error;
    linksUpserted += inferred.length;
  }
}

console.log(JSON.stringify({
  requests: requests?.length ?? 0,
  protectedRequestsWithPreexistingZones: requestsWithPreexistingZones.size,
  payloadsUpdated,
  linksRemoved,
  linksUpserted,
}, null, 2));
