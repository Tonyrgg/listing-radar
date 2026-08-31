import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { streetLines, type StreetLineGeometry } from "../../src/lib/street-registry/metrics";
import { chunks, errorMessage, optionValue, requireApplyConfirmation, serviceClient } from "./support";

type GeometryFeature = {
  type: "Feature";
  properties: {
    official_code?: string | number;
    match_status?: "exact" | "manual";
    match_notes?: string;
  };
  geometry: StreetLineGeometry;
};

function parseFeatures(input: string): GeometryFeature[] {
  const parsed = JSON.parse(input) as { type?: string; features?: unknown[] };
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Il file deve essere un GeoJSON FeatureCollection");
  }
  const codes = new Set<string>();
  return parsed.features.map((raw, index) => {
    const feature = raw as Partial<GeometryFeature>;
    const code = String(feature.properties?.official_code ?? "").trim();
    if (!code) throw new Error(`Feature ${index + 1} senza properties.official_code`);
    if (codes.has(code)) throw new Error(`official_code duplicato nel GeoJSON: ${code}`);
    if (!feature.geometry || !["LineString", "MultiLineString"].includes(feature.geometry.type)) {
      throw new Error(`Geometria non valida per Codvia ${code}`);
    }
    if (!streetLines(feature.geometry).length) throw new Error(`Geometria vuota o non valida per Codvia ${code}`);
    const matchStatus = feature.properties?.match_status ?? "manual";
    if (!["exact", "manual"].includes(matchStatus)) throw new Error(`match_status non accettato per Codvia ${code}`);
    codes.add(code);
    return {
      type: "Feature",
      properties: { ...feature.properties, official_code: code, match_status: matchStatus },
      geometry: feature.geometry,
    };
  });
}

async function main() {
  const file = optionValue("--file");
  if (!file) throw new Error("Indicare un GeoJSON validato con --file <percorso>");
  const sourceKey = optionValue("--source-key");
  const sourceUrl = optionValue("--source-url");
  if (!sourceKey || !sourceUrl) throw new Error("--source-key e --source-url sono obbligatori per la provenienza");
  const apply = requireApplyConfirmation();
  const input = await readFile(file, "utf8");
  const features = parseFeatures(input);
  const sha256 = createHash("sha256").update(input).digest("hex");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", file, sourceKey, sourceUrl, sha256, features: features.length }, null, 2));
  if (!apply) {
    console.log("Nessuna modifica eseguita. L'import richiede un crosswalk Codvia esplicito e --apply.");
    return;
  }

  const client = serviceClient();
  const codes = features.map((feature) => String(feature.properties.official_code));
  const existing = new Map<string, string>();
  for (const batch of chunks(codes)) {
    const result = await client.from("street_registry_streets").select("id,official_code").in("official_code", batch);
    if (result.error) throw new Error(`Verifica Codvia fallita: ${result.error.message}`);
    for (const row of result.data ?? []) existing.set(String(row.official_code), String(row.id));
  }
  const missing = codes.filter((code) => !existing.has(code));
  if (missing.length) throw new Error(`Codvia assenti dal registro: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`);

  const sourceMutation = await client.from("street_registry_sources").upsert({
    source_key: sourceKey,
    authority: optionValue("--authority") ?? "Geometry provider",
    dataset_name: optionValue("--dataset-name") ?? sourceKey,
    source_url: sourceUrl,
    license: optionValue("--license"),
    last_fetched_at: new Date().toISOString(),
    last_content_sha256: sha256,
    last_record_count: features.length,
    metadata: { local_file: file, crosswalk_field: "properties.official_code" },
  }, { onConflict: "source_key" }).select("id").single();
  if (sourceMutation.error) throw new Error(`Registrazione fonte geometrica fallita: ${sourceMutation.error.message}`);
  const sourceId = String(sourceMutation.data.id);
  const runMutation = await client.from("street_registry_import_runs").insert({
    source_id: sourceId,
    import_kind: "geometry",
    status: "running",
    content_sha256: sha256,
    source_record_count: features.length,
    updated_count: features.length,
  }).select("id").single();
  if (runMutation.error) throw new Error(`Apertura import geometrie fallita: ${runMutation.error.message}`);
  const runId = String(runMutation.data.id);

  try {
    for (const feature of features) {
      const code = String(feature.properties.official_code);
      const mutation = await client.from("street_registry_streets").update({
        geometry: feature.geometry,
        geometry_source_id: sourceId,
        geometry_match_status: feature.properties.match_status,
        geometry_match_metadata: {
          source_key: sourceKey,
          match_notes: feature.properties.match_notes ?? null,
        },
        geometry_matched_at: new Date().toISOString(),
      }).eq("id", existing.get(code)!);
      if (mutation.error) throw new Error(`Salvataggio geometria ${code} fallito: ${mutation.error.message}`);
    }
    const completion = await client.from("street_registry_import_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      details: { explicit_crosswalk: true },
    }).eq("id", runId);
    if (completion.error) throw new Error(`Chiusura import geometrie fallita: ${completion.error.message}`);
    console.log(`Importate ${features.length} geometrie con provenienza ${sourceKey}.`);
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
