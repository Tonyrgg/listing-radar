import { normalizeStreetName } from "../../src/lib/street-registry/official-inventory";
import {
  distanceRing,
  rankByDistance,
  streetDistanceMeters,
  streetLengthMeters,
  streetRepresentativePoint,
  type StreetLineGeometry,
} from "../../src/lib/street-registry/metrics";
import { chunks, errorMessage, fetchAllRows, requireApplyConfirmation, serviceClient } from "./support";

const METRICS_VERSION = 1;

type CenterRow = {
  id: string;
  scope: "city" | "zone";
  zone_id: string | null;
  latitude: number | string;
  longitude: number | string;
};
type ZoneRow = { id: string; zone_number: number | null; name: string; associated_streets: string[] | null };
type StreetRow = {
  id: string;
  official_code: string;
  locality: string | null;
  normalized_name: string;
  geometry: StreetLineGeometry | null;
};
type LinkRow = {
  street_id: string;
  zone_id: string;
  is_primary: boolean;
  assignment_method: "manual" | "official" | "geometry_intersection" | "nearest_center" | "associated_street_seed";
};
type Assignment = {
  streetId: string;
  zoneId: string;
  method: LinkRow["assignment_method"];
  confidence: number;
  metadata: Record<string, unknown>;
};

function point(center: CenterRow) {
  return { latitude: Number(center.latitude), longitude: Number(center.longitude) };
}

async function parallelBatches<T>(items: T[], operation: (item: T) => Promise<void>) {
  for (const batch of chunks(items, 20)) await Promise.all(batch.map(operation));
}

async function main() {
  const apply = requireApplyConfirmation();
  const client = serviceClient();
  const [centers, zones, streets, links] = await Promise.all([
    fetchAllRows<CenterRow>((from, to) => client.from("street_registry_centers")
      .select("id,scope,zone_id,latitude,longitude").eq("is_active", true).range(from, to)),
    fetchAllRows<ZoneRow>((from, to) => client.from("internal_zones")
      .select("id,zone_number,name,associated_streets").eq("is_active", true).range(from, to)),
    fetchAllRows<StreetRow>((from, to) => client.from("street_registry_streets")
      .select("id,official_code,locality,normalized_name,geometry").eq("record_status", "active").range(from, to)),
    fetchAllRows<LinkRow>((from, to) => client.from("street_registry_street_zones")
      .select("street_id,zone_id,is_primary,assignment_method").range(from, to)),
  ]);
  const cityCenter = centers.find((center) => center.scope === "city");
  if (!cityCenter) throw new Error("Centro città attivo non configurato: eseguire prima street-registry:centers --apply");
  const zoneCenters = new Map(centers.filter((center) => center.scope === "zone" && center.zone_id)
    .map((center) => [center.zone_id!, center]));
  const missingZoneCenters = zones.filter((zone) => !zoneCenters.has(zone.id));
  if (missingZoneCenters.length) throw new Error(`Centri zona mancanti: ${missingZoneCenters.map((zone) => zone.zone_number).join(", ")}`);

  const streetNameCounts = new Map<string, number>();
  for (const street of streets) streetNameCounts.set(street.normalized_name, (streetNameCounts.get(street.normalized_name) ?? 0) + 1);
  const zonesBySeedName = new Map<string, ZoneRow[]>();
  for (const zone of zones) {
    for (const name of zone.associated_streets ?? []) {
      const normalized = normalizeStreetName(name);
      zonesBySeedName.set(normalized, [...(zonesBySeedName.get(normalized) ?? []), zone]);
    }
  }
  const zoneByNumber = new Map(zones.map((zone) => [zone.zone_number, zone]));
  const existingPrimary = new Map(links.filter((link) => link.is_primary).map((link) => [link.street_id, link]));
  const assignments: Assignment[] = [];

  for (const street of streets) {
    const primary = existingPrimary.get(street.id);
    if (primary && ["manual", "official", "geometry_intersection"].includes(primary.assignment_method)) continue;

    const localityZoneNumber = street.locality === "PALOMBAIO" ? 14 : street.locality === "MARIOTTO" ? 15 : null;
    const localityZone = localityZoneNumber == null ? null : zoneByNumber.get(localityZoneNumber);
    if (localityZone) {
      assignments.push({
        streetId: street.id,
        zoneId: localityZone.id,
        method: "associated_street_seed",
        confidence: 0.9,
        metadata: { basis: "official_inventory_locality", locality: street.locality },
      });
      continue;
    }

    const seedZones = zonesBySeedName.get(street.normalized_name) ?? [];
    if (streetNameCounts.get(street.normalized_name) === 1 && seedZones.length === 1) {
      assignments.push({
        streetId: street.id,
        zoneId: seedZones[0].id,
        method: "associated_street_seed",
        confidence: 0.8,
        metadata: { basis: "internal_zones.associated_streets" },
      });
      continue;
    }

    if (!street.geometry) continue;
    const candidates = zones.flatMap((zone) => {
      const distance = streetDistanceMeters(point(zoneCenters.get(zone.id)!), street.geometry);
      return distance == null ? [] : [{ zone, distance }];
    }).sort((left, right) => left.distance - right.distance || left.zone.id.localeCompare(right.zone.id));
    if (!candidates.length) continue;
    const nearest = candidates[0];
    const second = candidates[1];
    const confidence = second ? Math.max(0, Math.min(1, (second.distance - nearest.distance) / Math.max(second.distance, 1))) : 1;
    assignments.push({
      streetId: street.id,
      zoneId: nearest.zone.id,
      method: "nearest_center",
      confidence,
      metadata: { basis: "nearest_zone_center", second_distance_m: second?.distance ?? null },
    });
  }

  const cityMetrics = streets.flatMap((street) => {
    if (!street.geometry) return [];
    const distance = streetDistanceMeters(point(cityCenter), street.geometry);
    const representative = streetRepresentativePoint(street.geometry);
    const length = streetLengthMeters(street.geometry);
    if (distance == null || !representative || length == null) return [];
    return [{ street, distance, representative, length }];
  });
  const cityRanks = rankByDistance(cityMetrics.map(({ street, distance }) => ({ id: street.id, distance })));
  const activeStreetIds = new Set(streets.map((street) => street.id));
  const unassignedCount = streets.length - new Set([
    ...links.filter((link) => link.is_primary && activeStreetIds.has(link.street_id)).map((link) => link.street_id),
    ...assignments.map((assignment) => assignment.streetId),
  ]).size;

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    metricsVersion: METRICS_VERSION,
    activeStreets: streets.length,
    streetsWithGeometry: cityMetrics.length,
    proposedDerivedAssignments: assignments.length,
    unassignedStreets: unassignedCount,
  }, null, 2));
  if (!apply) {
    console.log("Nessuna modifica eseguita. Le assegnazioni nearest_center sono stime operative, mai fonti ufficiali.");
    return;
  }

  const sourceMutation = await client.from("street_registry_sources").upsert({
    source_key: `listing-radar-street-metrics-v${METRICS_VERSION}`,
    authority: "Listing Radar",
    dataset_name: `Street distance, ranking and derived zone assignment v${METRICS_VERSION}`,
    source_url: "internal:scripts/street-registry/recompute-metrics.ts",
    metadata: { ring_meters: 250, nearest_center_is_estimate: true },
  }, { onConflict: "source_key" }).select("id").single();
  if (sourceMutation.error) throw new Error(`Registrazione fonte metriche fallita: ${sourceMutation.error.message}`);
  const sourceId = String(sourceMutation.data.id);
  const runMutation = await client.from("street_registry_import_runs").insert({
    source_id: sourceId,
    import_kind: "metrics",
    status: "running",
    source_record_count: streets.length,
    updated_count: cityMetrics.length,
    warning_count: unassignedCount,
    details: { metrics_version: METRICS_VERSION, assignments: assignments.length },
  }).select("id").single();
  if (runMutation.error) throw new Error(`Apertura calcolo metriche fallita: ${runMutation.error.message}`);
  const runId = String(runMutation.data.id);

  try {
    await parallelBatches(cityMetrics, async ({ street, distance, representative, length }) => {
      const result = await client.from("street_registry_streets").update({
        centroid_latitude: representative.latitude,
        centroid_longitude: representative.longitude,
        length_m: length,
        city_distance_m: distance,
        city_rank: cityRanks.get(street.id),
        city_ring: distanceRing(distance),
        metrics_version: METRICS_VERSION,
        metrics_updated_at: new Date().toISOString(),
      }).eq("id", street.id);
      if (result.error) throw new Error(`Metriche città ${street.official_code} fallite: ${result.error.message}`);
    });

    for (const assignment of assignments) {
      const oldPrimary = existingPrimary.get(assignment.streetId);
      if (oldPrimary && oldPrimary.zone_id !== assignment.zoneId && !["manual", "official", "geometry_intersection"].includes(oldPrimary.assignment_method)) {
        const demotion = await client.from("street_registry_street_zones").update({ is_primary: false })
          .eq("street_id", assignment.streetId).eq("zone_id", oldPrimary.zone_id);
        if (demotion.error) throw new Error(`Aggiornamento zona primaria fallito: ${demotion.error.message}`);
      }
      const mutation = await client.from("street_registry_street_zones").upsert({
        street_id: assignment.streetId,
        zone_id: assignment.zoneId,
        is_primary: true,
        assignment_method: assignment.method,
        confidence: assignment.confidence,
        source_id: sourceId,
        metadata: assignment.metadata,
      }, { onConflict: "street_id,zone_id" });
      if (mutation.error) throw new Error(`Assegnazione zona fallita: ${mutation.error.message}`);
    }

    const currentLinks = await fetchAllRows<LinkRow>((from, to) => client.from("street_registry_street_zones")
      .select("street_id,zone_id,is_primary,assignment_method").range(from, to));
    const streetById = new Map(streets.map((street) => [street.id, street]));
    const zoneMetricRows = currentLinks.flatMap((link) => {
      const street = streetById.get(link.street_id);
      const center = zoneCenters.get(link.zone_id);
      if (!street?.geometry || !center) return [];
      const distance = streetDistanceMeters(point(center), street.geometry);
      return distance == null ? [] : [{ link, distance }];
    });
    const ranksByZone = new Map<string, Map<string, number>>();
    for (const zone of zones) {
      const items = zoneMetricRows.filter(({ link }) => link.zone_id === zone.id)
        .map(({ link, distance }) => ({ id: link.street_id, distance }));
      ranksByZone.set(zone.id, rankByDistance(items));
    }
    await parallelBatches(zoneMetricRows, async ({ link, distance }) => {
      const result = await client.from("street_registry_street_zones").update({
        zone_distance_m: distance,
        zone_rank: ranksByZone.get(link.zone_id)?.get(link.street_id),
        zone_ring: distanceRing(distance),
      }).eq("street_id", link.street_id).eq("zone_id", link.zone_id);
      if (result.error) throw new Error(`Metriche zona fallite: ${result.error.message}`);
    });

    const completion = await client.from("street_registry_import_runs").update({
      status: unassignedCount ? "completed_with_warnings" : "completed",
      completed_at: new Date().toISOString(),
      details: { metrics_version: METRICS_VERSION, assignments: assignments.length, zone_metrics: zoneMetricRows.length, unassigned: unassignedCount },
    }).eq("id", runId);
    if (completion.error) throw new Error(`Chiusura calcolo metriche fallita: ${completion.error.message}`);
    console.log(`Metriche aggiornate per ${cityMetrics.length} vie; ${zoneMetricRows.length} metriche zona.`);
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
