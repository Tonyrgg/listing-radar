import centersConfig from "../../data/street-registry/bitonto-centers.json";
import { polygonLabelPoint } from "../../src/lib/map/geometry";
import type { GeoJsonGeometry } from "../../src/lib/map/types";
import { errorMessage, fetchAllRows, requireApplyConfirmation, serviceClient } from "./support";

type ZoneRow = {
  id: string;
  zone_number: number | null;
  name: string;
  geometry: GeoJsonGeometry | null;
};

async function upsertSource(
  client: ReturnType<typeof serviceClient>,
  source: { sourceKey: string; authority: string; datasetName: string; sourceUrl: string; license?: string },
) {
  const result = await client.from("street_registry_sources").upsert({
    source_key: source.sourceKey,
    authority: source.authority,
    dataset_name: source.datasetName,
    source_url: source.sourceUrl,
    license: source.license ?? null,
  }, { onConflict: "source_key" }).select("id").single();
  if (result.error) throw new Error(`Registrazione fonte ${source.sourceKey} fallita: ${result.error.message}`);
  return String(result.data.id);
}

async function saveCenter(
  client: ReturnType<typeof serviceClient>,
  payload: Record<string, unknown> & { scope: "city" | "zone"; zone_id: string | null },
) {
  let query = client.from("street_registry_centers").select("id")
    .eq("scope", payload.scope).eq("is_active", true);
  query = payload.zone_id ? query.eq("zone_id", payload.zone_id) : query.is("zone_id", null);
  const existing = await query.maybeSingle();
  if (existing.error) throw new Error(`Ricerca centro esistente fallita: ${existing.error.message}`);
  const mutation = existing.data
    ? await client.from("street_registry_centers").update(payload).eq("id", existing.data.id)
    : await client.from("street_registry_centers").insert(payload);
  if (mutation.error) throw new Error(`Salvataggio centro fallito: ${mutation.error.message}`);
}

async function main() {
  const apply = requireApplyConfirmation();
  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      city: centersConfig.city,
      fallbackZones: centersConfig.zoneFallbacks.map(({ zoneNumber, name, reference }) => ({ zoneNumber, name, reference })),
      polygonZonePolicy: "polygonLabelPoint for every active zone that already has geometry",
    }, null, 2));
    console.log("Nessuna modifica eseguita. Ripetere con --apply dopo avere applicato la migration 0006.");
    return;
  }

  const client = serviceClient();
  const zones = await fetchAllRows<ZoneRow>((from, to) => client.from("internal_zones")
    .select("id,zone_number,name,geometry")
    .eq("is_active", true)
    .order("zone_number", { ascending: true })
    .range(from, to));
  const zoneNumbers = new Set(zones.map((zone) => zone.zone_number));
  for (const fallback of centersConfig.zoneFallbacks) {
    if (!zoneNumbers.has(fallback.zoneNumber)) throw new Error(`Zona Listing Radar ${fallback.zoneNumber} non trovata`);
  }

  const citySourceId = await upsertSource(client, {
    sourceKey: centersConfig.city.sourceKey,
    authority: "Regione Puglia - CartApulia",
    datasetName: "Piazza Cavour - Bitonto",
    sourceUrl: centersConfig.city.sourceUrl,
    license: "CC BY 4.0",
  });
  const fallbackSourceId = await upsertSource(client, centersConfig.fallbackSource);
  const zoneGeometrySourceId = await upsertSource(client, {
    sourceKey: "listing-radar-internal-zone-geometries",
    authority: "Listing Radar",
    datasetName: "Perimetri operativi delle zone Listing Radar",
    sourceUrl: "internal:internal_zones.geometry",
  });

  await saveCenter(client, {
    scope: "city",
    municipality: centersConfig.municipality,
    zone_id: null,
    name: centersConfig.city.name,
    latitude: centersConfig.city.latitude,
    longitude: centersConfig.city.longitude,
    method: centersConfig.city.method,
    source_id: citySourceId,
    source_reference: centersConfig.city.sourceReference,
    is_active: true,
    metadata: { config_version: centersConfig.version },
  });

  let geometryCenters = 0;
  let fallbackCenters = 0;
  for (const zone of zones) {
    const polygonPoint = polygonLabelPoint(zone.geometry);
    const fallback = centersConfig.zoneFallbacks.find((candidate) => candidate.zoneNumber === zone.zone_number);
    if (!polygonPoint && !fallback) throw new Error(`La zona ${zone.zone_number ?? zone.id} non ha geometria né fallback validato`);
    const point = polygonPoint ?? fallback!;
    await saveCenter(client, {
      scope: "zone",
      municipality: centersConfig.municipality,
      zone_id: zone.id,
      name: `Centro ${zone.name}`,
      latitude: point.latitude,
      longitude: point.longitude,
      method: polygonPoint ? "zone_geometry" : "supporting_geocoder",
      source_id: polygonPoint ? zoneGeometrySourceId : fallbackSourceId,
      source_reference: polygonPoint ? `internal_zones:${zone.id}` : fallback!.reference,
      is_active: true,
      metadata: { zone_number: zone.zone_number, config_version: centersConfig.version },
    });
    if (polygonPoint) geometryCenters += 1;
    else fallbackCenters += 1;
  }

  console.log(`Centri salvati: 1 città, ${geometryCenters} da perimetro zona, ${fallbackCenters} da coordinate di supporto.`);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
