import { createClient } from "@supabase/supabase-js";

import { loadConfig } from "../src/config.js";
import {
  crmRequestFeatureRequirements,
  unreadableFeatureDeclarations,
} from "../src/services/request-feature-requirements.js";

/**
 * Riallinea le dotazioni dichiarate nel CRM con le preferenze dell'archivio.
 *
 * Le richieste importate prima di oggi portano l'ascensore solo dentro
 * `raw_payload`: il motore non lo vedeva e la scheda stampava «ascensore no».
 * Questo script legge quel campo e crea la preferenza mancante.
 *
 * Non tocca nulla di deciso a mano: se per quella caratteristica esiste gia'
 * una preferenza, la lascia dov'e'. Di default non scrive niente e mostra solo
 * cosa cambierebbe; con `--apply` scrive.
 *
 *   npm --prefix worker run requests:reconcile-features
 *   npm --prefix worker run requests:reconcile-features -- --apply
 *
 * Dopo un `--apply` i match vanno ricalcolati: le richieste toccate ora hanno
 * un filtro duro in piu'. Il pulsante «Ricalcola match» della pagina Matching
 * lo fa per tutte, quello della singola richiesta per una sola.
 */

type RequestRow = {
  id: string;
  title: string | null;
  external_crm_id: string | null;
  status: string | null;
  raw_payload: Record<string, unknown> | null;
};

const apply = process.argv.includes("--apply");
const config = loadConfig();
const database = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

const fieldMap = (value: unknown) => (typeof value === "object" && value
  ? value as Record<string, string | boolean | null>
  : {});

const [{ data: activeRun, error: activeRunError }, { data: requests, error: requestError }, { data: features, error: featureError }] = await Promise.all([
  database.from("crm_request_import_runs").select("id").eq("status", "running").limit(1).maybeSingle(),
  database.from("property_requests").select("id,title,external_crm_id,status,raw_payload"),
  database.from("feature_definitions").select("id,key,label"),
]);
if (activeRunError) throw activeRunError;
if (activeRun) throw new Error("La sincronizzazione richieste è ancora attiva: attendi la conclusione prima di riallineare le caratteristiche.");
if (requestError) throw requestError;
if (featureError) throw featureError;

const featureIdByKey = new Map((features ?? []).map((feature) => [String(feature.key), String(feature.id)]));
const featureLabelByKey = new Map((features ?? []).map((feature) => [String(feature.key), String(feature.label)]));

const requestIds = (requests ?? []).map((request) => String(request.id));
const existingByRequest = new Map<string, Set<string>>();
for (let index = 0; index < requestIds.length; index += 500) {
  const { data, error } = await database.from("request_feature_preferences")
    .select("request_id,feature_definition_id").in("request_id", requestIds.slice(index, index + 500));
  if (error) throw error;
  for (const row of data ?? []) {
    const key = String(row.request_id);
    existingByRequest.set(key, (existingByRequest.get(key) ?? new Set()).add(String(row.feature_definition_id)));
  }
}

const missing: Array<{ request_id: string; title: string; reference: string; status: string; feature: string; declared_as: string }> = [];
const alreadyAligned: string[] = [];
const unreadable: Array<{ request_id: string; title: string; crm_field: string; declared_as: string }> = [];
const rows: Array<Record<string, unknown>> = [];

for (const request of (requests ?? []) as RequestRow[]) {
  const payload = request.raw_payload ?? {};
  const detail = { fields: fieldMap(payload.fields), headerFields: fieldMap(payload.headerFields) };
  const title = request.title ?? "Richiesta senza titolo";
  const reference = request.external_crm_id ?? String(request.id).slice(0, 8).toUpperCase();

  for (const declaration of unreadableFeatureDeclarations(detail)) {
    unreadable.push({ request_id: String(request.id), title, crm_field: declaration.crm_field, declared_as: declaration.declared_as });
  }

  for (const requirement of crmRequestFeatureRequirements(detail)) {
    const featureId = featureIdByKey.get(requirement.feature_key);
    if (!featureId) throw new Error(`La caratteristica «${requirement.feature_key}» non esiste in feature_definitions: applica il seed prima di riallineare.`);
    if (existingByRequest.get(String(request.id))?.has(featureId)) {
      alreadyAligned.push(String(request.id));
      continue;
    }
    missing.push({
      request_id: String(request.id),
      title,
      reference,
      status: request.status ?? "sconosciuto",
      feature: featureLabelByKey.get(requirement.feature_key) ?? requirement.feature_key,
      declared_as: requirement.declared_as,
    });
    rows.push({
      request_id: request.id,
      feature_definition_id: featureId,
      preference_level: requirement.preference_level,
      desired_value: requirement.desired_value,
    });
  }
}

let inserted = 0;
if (apply && rows.length) {
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const { error } = await database.from("request_feature_preferences")
      .upsert(batch, { onConflict: "request_id,feature_definition_id", ignoreDuplicates: true });
    if (error) throw error;
    inserted += batch.length;
  }
}

console.log(JSON.stringify({
  modalita: apply ? "scrittura" : "prova (nessuna scrittura)",
  richiesteEsaminate: requests?.length ?? 0,
  preferenzeGiaAllineate: alreadyAligned.length,
  preferenzeDaCreare: missing.length,
  preferenzeCreate: inserted,
  campiNonLeggibili: unreadable,
  richieste: missing,
  prossimoPasso: apply && inserted
    ? "Ricalcola i match: pagina Matching, pulsante «Ricalcola match»."
    : "Nessuna scrittura eseguita: rilancia con --apply per applicare.",
}, null, 2));
