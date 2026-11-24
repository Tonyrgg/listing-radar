import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeoJsonGeometry } from "@/lib/map/types";
import { clipStreetToAreas, type StreetArea } from "../../../../worker/src/territory/zone-streets";
import { haversineDistanceMeters, streetRepresentativePoint, type StreetLineGeometry, type GeoPoint } from "@/lib/street-registry/metrics";
import { inSavedArea } from "./area-filter";

const fields = "property_id,address,street_name,street_number,locality,agency_name,agency_role,state,sale_status,exit_classification,opportunity_score,private_source,latest_asking_price,latitude,longitude,location_precision,rooms,floor:attributes->>floor";
type Row = {
  property_id: string; address: string; street_name: string | null; street_number: string | null; locality: string | null;
  agency_name: string | null; agency_role: string | null; state: string; sale_status: string; exit_classification: string;
  opportunity_score: number | null; private_source: string | null; latest_asking_price: number | null;
  floor: string | null; rooms: number | null;
  latitude: number | null; longitude: number | null; location_precision: string | null;
};
type MarketLayer = "mercato" | "opportunita" | "privati";
type Street = { canonical_name:string; locality:string|null; geometry:StreetLineGeometry };
type VerifiedLocation = GeoPoint & { street_name:string; street_number:string; locality:string|null; municipality:string|null };
type Placement = GeoPoint & { zoneIds: string[]; precision: "published" | "address" | "area" | "street" };

function canonicalStreet(name: string) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/['’]/g,"")
    .replace(/\bLUDOVICO I DANGIO\b/g, "LUDOVICO DANGIO").replace(/[^A-Z0-9]+/g, " ").trim();
}

export function zonesForPoint(point: GeoPoint, zones: StreetArea[]) {
  return zones.filter(zone => inSavedArea(point, zone.geometry as GeoJsonGeometry)).map(zone => zone.id);
}

const addressKey = (street: string, civic: string) => canonicalStreet(street) + "|" + civic.toUpperCase().replace(/\s*\/\s*(?=[A-Z])/g, "").replace(/\s+/g, "");

function placements(row: Row, zones: StreetArea[], streets: Map<string, Street[]>, locations: Map<string, VerifiedLocation[]>): Placement[] {
  if (row.latitude != null && row.longitude != null && Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) {
    const point = { latitude: row.latitude, longitude: row.longitude };
    const zoneIds = zonesForPoint(point, zones);
    if (!zoneIds.length) return [];
    const precision = row.location_precision === "EXACT_COORDINATES" ? "published" : row.location_precision === "EXACT_ADDRESS"
      ? "address" : row.location_precision === "STREET_ONLY" ? "street" : "area";
    return [{ ...point, zoneIds, precision }];
  }
  if (!row.street_name || !row.street_number) return [];
  const known = (locations.get(addressKey(row.street_name, row.street_number)) ?? []).filter(location =>
    !row.locality || (location.locality ?? location.municipality ?? "").toLowerCase() === row.locality.toLowerCase());
  const knownPoint = known[0];
  if (knownPoint && known.every(location => haversineDistanceMeters(knownPoint, location) <= 15)) {
    const point = { latitude:knownPoint.latitude, longitude:knownPoint.longitude };
    const zoneIds = zonesForPoint(point, zones);
    return zoneIds.length ? [{ ...point, zoneIds, precision: "address" }] : [];
  }
  const matching = (streets.get(canonicalStreet(row.street_name)) ?? []).filter(street =>
    !street.locality || !row.locality || street.locality.toLowerCase() === row.locality.toLowerCase());
  if (matching.length !== 1) return [];
  return zones.flatMap(zone => {
    const point = streetRepresentativePoint(clipStreetToAreas(matching[0].geometry,[zone]) as StreetLineGeometry | null);
    return point && zonesForPoint(point, [zone]).length ? [{ ...point, zoneIds: [zone.id], precision: "street" as const }] : [];
  });
}

async function readRows(db: SupabaseClient, table: string, columns: string) {
  const rows: unknown[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const result = await db.from(table).select(columns).order(table === "street_registry_streets" ? "id" : "row_id")
      .range(offset, offset + 499);
    if (result.error) throw result.error;
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
  throw new Error("Limite di lettura cartografica superato");
}

export async function readWorkerMarketPins(db: SupabaseClient, zones: StreetArea[]) {
  const [market, privates] = await Promise.all([
    readRows(db, "radar_property_live_archive", fields) as Promise<Row[]>,
    readRows(db, "radar_private_live_archive", fields) as Promise<Row[]>,
  ]);
  const missing = [...market, ...privates].filter(row => row.street_name && row.street_number &&
    (row.latitude == null || row.longitude == null));
  const civics = [...new Set(missing.map(row => row.street_number!))];
  const locations = new Map<string, VerifiedLocation[]>();
  const [registry, ...verifiedBatches] = await Promise.all([
    readRows(db, "street_registry_streets", "id,canonical_name,locality,geometry,record_status") as Promise<Array<Street & {record_status: string}>>,
    ...Array.from({length: Math.ceil(civics.length / 60)}, (_, i) => db.from("locations")
      .select("street_name,street_number,latitude,longitude,locality,municipality")
      .in("street_number", civics.slice(i * 60, (i + 1) * 60)).not("latitude","is",null).not("longitude","is",null)
      .or("manually_verified.eq.true,resolution_method.eq.PUBLISHER_PIN_OSM_REVERSE").order("id").limit(1000)),
  ]);
  for (const result of verifiedBatches) {
    if (result.error) throw result.error;
    for (const row of result.data as VerifiedLocation[]) {
      if (!row.street_name) continue;
      const key = addressKey(row.street_name, row.street_number);
      const known = locations.get(key) ?? [];
      known.push(row);
      locations.set(key, known);
    }
  }
  const streets = new Map<string, Street[]>();
  for (const street of registry) {
    if (!street.geometry || street.record_status !== "active") continue;
    const key = canonicalStreet(street.canonical_name);
    const known = streets.get(key) ?? [];
    known.push(street);
    streets.set(key, known);
  }
  const asPin = (row: Row, layers: MarketLayer[]) => layers.length ? placements(row, zones, streets, locations).map(placement => ({
    ...placement, layers, propertyId: row.property_id, title: row.address, street: row.street_name ?? row.address,
    civics: row.street_number ? [row.street_number] : [], price: row.latest_asking_price,
    floor: row.floor, rooms: row.rooms,
    source: layers.includes("privati") ? row.private_source : row.agency_name,
  })) : [];
  return [
    ...market.flatMap(row => {
      const layers: MarketLayer[] = [];
      if (row.state === "ACTIVE") layers.push("mercato");
      if ((row.opportunity_score ?? 0) > 0 && !["SOLD_CONFIRMED","SOLD_PROBABLE"].includes(row.exit_classification)
        && row.sale_status !== "SOLD_CONFIRMED" && row.agency_role && row.agency_role !== "OUR_AGENCY") layers.push("opportunita");
      return asPin(row, layers);
    }),
    ...privates.flatMap(row => asPin(row, ["privati"])),
  ];
}
