import { writeFile } from "node:fs/promises";

import { normalizeStreetName } from "../../src/lib/street-registry/official-inventory";
import {
  haversineDistanceMeters,
  streetLengthMeters,
  streetLines,
  type StreetLineGeometry,
} from "../../src/lib/street-registry/metrics";
import { errorMessage, fetchAllRows, optionValue, serviceClient } from "./support";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Una strada vera, per quanto lunga, non e' mai piu' larga di quanto sia lunga:
// lo span dei suoi punti resta sotto la somma dei tratti. Quando lo span sfonda
// quella soglia i tratti sono staccati fra loro, cioe' e' un'omonimia in due
// posti diversi. La tolleranza assorbe i tratti mancanti in OpenStreetMap.
const SPAN_OVER_LENGTH_TOLERANCE = 1.15;
const SPAN_ABSOLUTE_TOLERANCE_METERS = 250;

function isDisjointHomonym(span: number, length: number): boolean {
  return span > length * SPAN_OVER_LENGTH_TOLERANCE + SPAN_ABSOLUTE_TOLERANCE_METERS;
}

const OVERPASS_QUERY = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="8"]["name"="Bitonto"]->.bitonto;
way(area.bitonto)["highway"]["name"];
out geom;`;

type OverpassWay = {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

type StreetRow = {
  official_code: string;
  canonical_name: string;
  normalized_name: string;
  official_description: string;
  locality: string | null;
};

// L'inventario comunale scrive CANTU', OpenStreetMap scrive Cantu: la stessa via
// con due convenzioni tipografiche. La chiave larga toglie solo l'apostrofo.
function looseKey(value: string): string {
  return normalizeStreetName(value).replace(/'/g, "");
}

type MatchBasis = {
  key: (street: StreetRow) => string;
  label: string;
  note: string;
};

// L'ordine conta: si prova prima l'identita piu' stretta, poi quelle piu' larghe.
const MATCH_BASES: MatchBasis[] = [
  {
    key: (street) => street.normalized_name,
    label: "nome_completo",
    note: "nome ufficiale completo identico al nome OpenStreetMap",
  },
  {
    key: (street) => looseKey(street.canonical_name),
    label: "nome_completo_senza_apostrofi",
    note: "nome ufficiale completo identico a meno dell'apostrofo",
  },
  {
    key: (street) => looseKey(street.official_description),
    label: "descrizione_senza_specie",
    note: "descrizione ufficiale identica al nome OpenStreetMap, che non riporta la specie",
  },
];

async function requestOverpass(): Promise<Response> {
  const failures: string[] = [];
  // Le istanze pubbliche Overpass rispondono 429/504 sotto carico: si riprova
  // sullo stesso endpoint e poi sul mirror, senza mai insistere in fretta.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "ListingRadarStreetRegistry/1.0 (crosswalk Codvia-OSM)",
        },
        body: new URLSearchParams({ data: OVERPASS_QUERY }),
      });
      if (response.ok) return response;
      failures.push(`${endpoint} -> HTTP ${response.status}`);
      console.warn(`Overpass non disponibile (tentativo ${attempt}): ${endpoint} HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 15_000));
  }
  throw new Error(`Overpass non ha risposto: ${failures.join("; ")}`);
}

async function fetchOverpassWays(): Promise<OverpassWay[]> {
  const response = await requestOverpass();
  const payload = await response.json() as { elements?: unknown[] };
  if (!Array.isArray(payload.elements)) throw new Error("Risposta Overpass senza elements");
  return payload.elements.filter((element): element is OverpassWay => {
    const way = element as OverpassWay;
    return way.type === "way" && Array.isArray(way.geometry) && way.geometry.length >= 2 && Boolean(way.tags?.name);
  });
}

// Diagonale del rettangolo che contiene tutti i tratti: limite superiore della
// distanza fra due punti, calcolabile in una passata sola.
function spanMeters(lines: number[][][]): number {
  const points = lines.flat();
  if (points.length < 2) return 0;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  for (const [longitude, latitude] of points) {
    if (longitude < minLongitude) minLongitude = longitude;
    if (longitude > maxLongitude) maxLongitude = longitude;
    if (latitude < minLatitude) minLatitude = latitude;
    if (latitude > maxLatitude) maxLatitude = latitude;
  }
  return haversineDistanceMeters(
    { longitude: minLongitude, latitude: minLatitude },
    { longitude: maxLongitude, latitude: maxLatitude },
  );
}

function geometryOf(lines: number[][][]): StreetLineGeometry {
  return lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };
}

async function main() {
  const outFile = optionValue("--out") ?? "data/street-registry/osm-crosswalk.geojson";
  const reportFile = optionValue("--report") ?? "data/street-registry/osm-crosswalk-report.json";

  const client = serviceClient();
  const streets = await fetchAllRows<StreetRow>((from, to) => client
    .from("street_registry_streets")
    .select("official_code,canonical_name,normalized_name,official_description,locality")
    .eq("record_status", "active")
    .range(from, to));

  const ways = await fetchOverpassWays();
  const osmByKey = new Map<string, Map<string, { names: Set<string>; wayIds: number[]; lines: number[][][] }>>();
  for (const basis of MATCH_BASES) osmByKey.set(basis.label, new Map());
  for (const way of ways) {
    const line = way.geometry!.map((point) => [point.lon, point.lat]);
    for (const basis of MATCH_BASES) {
      const key = basis.label === "nome_completo" ? normalizeStreetName(way.tags!.name) : looseKey(way.tags!.name);
      if (!key) continue;
      const index = osmByKey.get(basis.label)!;
      const entry = index.get(key) ?? { names: new Set<string>(), wayIds: [], lines: [] };
      entry.names.add(way.tags!.name);
      entry.wayIds.push(way.id);
      entry.lines.push(line);
      index.set(key, entry);
    }
  }

  const features: unknown[] = [];
  const matchedByBasis = new Map<string, number>();
  const duplicateInRegistry: Array<{ normalized_name: string; codes: string[] }> = [];
  const notInOsm: Array<{ official_code: string; canonical_name: string; locality: string | null }> = [];
  const disjointHomonyms: Array<{
    official_code: string;
    canonical_name: string;
    span_m: number;
    length_m: number;
    osm_ways: number;
    basis: string;
  }> = [];
  const matchedStreets = new Set<string>();
  const consumedOsmNames = new Set<string>();

  const registryByName = new Map<string, StreetRow[]>();
  for (const street of streets) {
    registryByName.set(street.normalized_name, [...(registryByName.get(street.normalized_name) ?? []), street]);
  }
  for (const [normalized, group] of registryByName) {
    if (group.length > 1) {
      duplicateInRegistry.push({ normalized_name: normalized, codes: group.map((street) => street.official_code) });
      for (const street of group) matchedStreets.add(street.official_code);
    }
  }

  for (const basis of MATCH_BASES) {
    const registryByKey = new Map<string, StreetRow[]>();
    for (const street of streets) {
      if (matchedStreets.has(street.official_code)) continue;
      const key = basis.key(street);
      if (!key) continue;
      registryByKey.set(key, [...(registryByKey.get(key) ?? []), street]);
    }

    for (const [key, group] of registryByKey) {
      // Una chiave che vale per piu' Codvia non identifica una via sola.
      if (group.length > 1) continue;
      const osm = osmByKey.get(basis.label)!.get(key);
      if (!osm) continue;
      const street = group[0];
      const osmIdentity = [...osm.names].sort().join(" | ");
      if (consumedOsmNames.has(osmIdentity)) continue;

      const geometry = geometryOf(osm.lines);
      if (!streetLines(geometry).length) continue;
      const span = Math.round(spanMeters(osm.lines));
      const length = Math.round(streetLengthMeters(geometry) ?? 0);
      if (isDisjointHomonym(span, length)) {
        disjointHomonyms.push({
          official_code: street.official_code,
          canonical_name: street.canonical_name,
          span_m: span,
          length_m: length,
          osm_ways: osm.wayIds.length,
          basis: basis.label,
        });
        matchedStreets.add(street.official_code);
        continue;
      }

      features.push({
        type: "Feature",
        properties: {
          official_code: street.official_code,
          match_status: "manual",
          match_basis: basis.label,
          match_notes: `Corrispondenza univoca: ${basis.note}. Inventario: "${street.canonical_name}". `
            + `OpenStreetMap: "${osmIdentity}". Way OSM: ${osm.wayIds.join(",")}. `
            + `Lunghezza ${length} m, estensione ${span} m.`,
        },
        geometry,
      });
      matchedStreets.add(street.official_code);
      consumedOsmNames.add(osmIdentity);
      matchedByBasis.set(basis.label, (matchedByBasis.get(basis.label) ?? 0) + 1);
    }
  }

  for (const street of streets) {
    if (matchedStreets.has(street.official_code)) continue;
    notInOsm.push({ official_code: street.official_code, canonical_name: street.canonical_name, locality: street.locality });
  }

  const registryKeys = new Set<string>();
  for (const street of streets) for (const basis of MATCH_BASES) registryKeys.add(basis.key(street));
  const osmOnly: string[] = [];
  for (const key of osmByKey.get("nome_completo_senza_apostrofi")!.keys()) {
    if (!registryKeys.has(key)) osmOnly.push(key);
  }

  const report = {
    generated_at: new Date().toISOString(),
    overpass_query: OVERPASS_QUERY,
    span_over_length_tolerance: SPAN_OVER_LENGTH_TOLERANCE,
    span_absolute_tolerance_meters: SPAN_ABSOLUTE_TOLERANCE_METERS,
    active_streets: streets.length,
    osm_named_ways: ways.length,
    osm_distinct_names: osmByKey.get("nome_completo")!.size,
    matched: features.length,
    matched_by_basis: Object.fromEntries(MATCH_BASES.map((basis) => [basis.label, matchedByBasis.get(basis.label) ?? 0])),
    excluded: {
      duplicate_name_in_registry: duplicateInRegistry.reduce((total, group) => total + group.codes.length, 0),
      absent_from_osm: notInOsm.length,
      disjoint_homonyms: disjointHomonyms.length,
    },
    duplicate_name_in_registry: duplicateInRegistry.sort((a, b) => a.normalized_name.localeCompare(b.normalized_name)),
    disjoint_homonyms: disjointHomonyms.sort((a, b) => b.span_m - a.span_m),
    absent_from_osm: notInOsm.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)),
    osm_names_without_registry_match: osmOnly.sort(),
  };

  await writeFile(outFile, `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`, "utf8");
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    activeStreets: report.active_streets,
    osmNamedWays: report.osm_named_ways,
    osmDistinctNames: report.osm_distinct_names,
    matched: report.matched,
    matchedByBasis: report.matched_by_basis,
    excluded: report.excluded,
    outFile,
    reportFile,
  }, null, 2));
  console.log("Nessuna scrittura sul database. Rivedere il GeoJSON e importarlo con street-registry:geometry -- --apply.");
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
