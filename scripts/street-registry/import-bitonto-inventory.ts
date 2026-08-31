import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  BITONTO_OFFICIAL_STREETS_DATASET_URL,
  BITONTO_OFFICIAL_STREETS_URL,
  parseOfficialStreetInventory,
} from "../../src/lib/street-registry/official-inventory";
import {
  chunks,
  errorMessage,
  fetchAllRows,
  optionValue,
  requireApplyConfirmation,
  serviceClient,
} from "./support";

const SOURCE_KEY = "comune-bitonto-areas-of-circulation";

async function loadCsv() {
  const file = optionValue("--file");
  if (file) return { csv: await readFile(file, "utf8"), sourceUrl: `file:${file}` };
  const response = await fetch(BITONTO_OFFICIAL_STREETS_URL, { headers: { "user-agent": "ListingRadarStreetRegistry/1.0" } });
  if (!response.ok) throw new Error(`Download inventario fallito: HTTP ${response.status}`);
  return { csv: await response.text(), sourceUrl: BITONTO_OFFICIAL_STREETS_URL };
}

async function main() {
  const apply = requireApplyConfirmation();
  const { csv, sourceUrl } = await loadCsv();
  const records = parseOfficialStreetInventory(csv);
  const sha256 = createHash("sha256").update(csv).digest("hex");
  const reviewCount = records.filter((record) => record.record_status === "needs_review").length;
  const names = new Map<string, number>();
  for (const record of records) names.set(record.normalized_name, (names.get(record.normalized_name) ?? 0) + 1);
  const duplicateNameGroups = [...names.values()].filter((count) => count > 1).length;

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    sourceUrl,
    sha256,
    records: records.length,
    active: records.length - reviewCount,
    needsReview: reviewCount,
    duplicateNameGroups,
  }, null, 2));
  if (!apply) {
    console.log("Nessuna modifica eseguita. Ripetere con --apply dopo avere applicato la migration 0006.");
    return;
  }

  const client = serviceClient();
  const fetchedAt = new Date().toISOString();
  const sourceMutation = await client.from("street_registry_sources").upsert({
    source_key: SOURCE_KEY,
    authority: "Comune di Bitonto",
    dataset_name: "Comune di Bitonto - Elenco delle aree di circolazione",
    source_url: BITONTO_OFFICIAL_STREETS_URL,
    license: "CC BY 4.0",
    last_fetched_at: fetchedAt,
    last_content_sha256: sha256,
    last_record_count: records.length,
    metadata: {
      catalog_url: BITONTO_OFFICIAL_STREETS_DATASET_URL,
      imported_from: sourceUrl,
      identity_field: "Codvia",
      retirement_policy: "manual_review_only",
    },
  }, { onConflict: "source_key" }).select("id").single();
  if (sourceMutation.error) throw new Error(`Registrazione fonte fallita: ${sourceMutation.error.message}`);
  const sourceId = String(sourceMutation.data.id);

  const existing = await fetchAllRows<{ official_code: string }>((from, to) => client
    .from("street_registry_streets")
    .select("official_code")
    .eq("municipality", "BITONTO")
    .range(from, to));
  const existingCodes = new Set(existing.map((row) => row.official_code));
  const insertedCount = records.filter((record) => !existingCodes.has(record.official_code)).length;

  const runMutation = await client.from("street_registry_import_runs").insert({
    source_id: sourceId,
    import_kind: "official_inventory",
    status: "running",
    content_sha256: sha256,
    source_record_count: records.length,
    inserted_count: insertedCount,
    updated_count: records.length - insertedCount,
    details: { source_url: sourceUrl, duplicate_name_groups: duplicateNameGroups },
  }).select("id").single();
  if (runMutation.error) throw new Error(`Apertura import run fallita: ${runMutation.error.message}`);
  const runId = String(runMutation.data.id);

  try {
    for (const batch of chunks(records)) {
      const mutation = await client.from("street_registry_streets").upsert(batch.map((record) => ({
        ...record,
        source_id: sourceId,
        last_seen_import_id: runId,
      })), { onConflict: "official_code" });
      if (mutation.error) throw new Error(`Import inventario fallito: ${mutation.error.message}`);
    }

    const activeCodes = records.filter((record) => record.record_status === "active").map((record) => record.official_code);
    const importedRows: Array<{ id: string }> = [];
    for (const batch of chunks(activeCodes)) {
      const query = await client.from("street_registry_streets").select("id").in("official_code", batch);
      if (query.error) throw new Error(`Rilettura vie importate fallita: ${query.error.message}`);
      importedRows.push(...(query.data ?? []));
    }
    for (const batch of chunks(importedRows)) {
      const mutation = await client.from("street_registry_work_items").upsert(batch.map((street) => ({
        street_id: street.id,
        workflow: "owner_network",
      })), { onConflict: "street_id,workflow", ignoreDuplicates: true });
      if (mutation.error) throw new Error(`Creazione coda Rete proprietari fallita: ${mutation.error.message}`);
    }

    const completion = await client.from("street_registry_import_runs").update({
      status: reviewCount ? "completed_with_warnings" : "completed",
      warning_count: reviewCount,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    if (completion.error) throw new Error(`Chiusura import run fallita: ${completion.error.message}`);
    console.log(`Import completato: ${records.length} Codvia; ${importedRows.length} lavorazioni disponibili.`);
  } catch (error) {
    await client.from("street_registry_import_runs").update({
      status: "failed",
      error_message: errorMessage(error),
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    throw error;
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
