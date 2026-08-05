export type PropertyZoneGeometry = {
  type: string;
  coordinates: unknown;
};

export type PropertyLocationZone = {
  id: string;
  zone_number: number | null;
  name: string;
  geometry: PropertyZoneGeometry | null;
  associated_streets: string[];
};

export type PropertyPoint = { latitude: number; longitude: number };
type GeocodedPropertyPoint = PropertyPoint & { precision: "exact" | "street" };

export type PropertyAddress = {
  normalizedAddress: string;
  streetName: string | null;
  civicNumber: string | null;
};

export type PropertyLocationResolution = {
  normalized_address: string;
  street_name: string | null;
  civic_number: string | null;
  latitude: number | null;
  longitude: number | null;
  zone_id: string | null;
  zone_number: number | null;
  zone_name: string | null;
  status: "resolved" | "outside_municipality" | "outside_zones" | "street_match" | "not_found" | "error";
  confidence: "exact" | "street" | "manual" | "none";
  source: "existing_coordinates" | "nominatim" | "zone_street_index" | "verified_street_index" | "none";
  resolved_at: string;
  error?: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  addresstype?: string;
  type?: string;
  address?: { house_number?: string; road?: string; pedestrian?: string; city?: string; town?: string; village?: string };
};

const EMPTY_CIVIC = /^(?:\.|\/|-|nc|n\.c\.|sn|s\/n)$/i;
const BITONTO_MUNICIPALITIES = new Set(["bitonto", "palombaio", "mariotto"]);

const CRM_STREET_ALIASES = new Map<string, string>([
  ["traversa prima prolungamento di via domenico damascelli", "Prolungamento Via Domenico Damascelli"],
  ["corte de ilderis", "Corte Ilderis"],
  ["via tenente michele larovere", "Via Michele Larovere"],
  ["via prof antonia moschetta", "Via Professoressa Antonietta Moschetta"],
  ["via giov battista abbadessa", "Via Giovanni Battista Abbadessa"],
  ["corte aspromonte", "Via Aspromonte"],
  ["via giovanni modugno", "Via Modugno"],
  ["via piazza regina sancia", "Piazza Regina Sancia"],
  ["traversa prima di via ammiraglio vacca", "Via I Traversa Ammiraglio Vacca"],
  ["via arco di cristo", "Arco di Cristo"],
  ["via michele santoro corte teresa grandet", "Via Michele Santoro"],
  ["viale giovanni xxiii", "Via Papa Giovanni XXIII"],
  ["via 14 marzo 1848", "Via XIV Marzo 1848"],
  ["vicolo lucertola", "Corte della Lucertola"],
  ["traversa iii di via vecchia cappuccini", "Via Vecchia Cappuccini"],
  ["giuseppe comes", "Via Giuseppe Comez"],
]);

const VERIFIED_ZONE_BY_STREET = new Map<string, number>([
  ["via conte eustachio rogadeo", 3],
  ["corte romanelli", 1],
  ["piazza regina sancia", 1],
  ["arco di cristo", 1],
  ["corte luigi bruno", 1],
  ["corte calamita", 1],
]);

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeStreetText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/\b(?:strada provinciale|s\.p\.)\b/g, "sp")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cleanImportedPropertyAddress(
  rawAddress: string | null,
  municipality: string,
  fallbackStreet: string | null = null,
  fallbackCivic: string | null = null,
  internal: string | null = null,
) {
  const city = clean(municipality);
  let address = clean(rawAddress || fallbackStreet);
  if (!address) return null;

  if (city) {
    address = address.replace(
      new RegExp(`\\s+${escapeRegExp(city)}(?:\\s+\\([A-Z]{2}\\))?(?:\\s+\\d{5})?.*$`, "i"),
      "",
    ).trim();
  }

  const meaningfulCivic = clean(fallbackCivic);
  if (fallbackStreet && rawAddress == null && meaningfulCivic && !EMPTY_CIVIC.test(meaningfulCivic)) {
    address = `${clean(fallbackStreet)}, ${meaningfulCivic}`;
  }

  const meaningfulInternal = clean(internal);
  if (meaningfulInternal && !EMPTY_CIVIC.test(meaningfulInternal) && !/\bint\.?\s+/i.test(address)) {
    address = `${address} int. ${meaningfulInternal}`;
  }
  return address.replace(/\s+,/g, ",").replace(/,\s*,+/g, ", ").trim();
}

export function parsePropertyAddress(address: string | null, municipality: string): PropertyAddress {
  let normalizedAddress = cleanImportedPropertyAddress(address, municipality) ?? "";
  normalizedAddress = normalizedAddress.replace(/\s+int\.?\s+.*$/i, "").trim();
  const [streetPart = "", afterComma = ""] = normalizedAddress.split(/,(.*)/s);
  const rawStreetName = clean(streetPart) || null;
  const streetName = rawStreetName
    ? CRM_STREET_ALIASES.get(normalizeStreetText(rawStreetName)) ?? rawStreetName
    : null;
  const civicCandidate = clean(afterComma).split(/\s+/)[0] ?? "";
  const civicNumber = civicCandidate && !EMPTY_CIVIC.test(civicCandidate) ? civicCandidate : null;
  return {
    normalizedAddress: [streetName, civicNumber].filter(Boolean).join(", "),
    streetName,
    civicNumber,
  };
}

function belongsToBitontoMunicipality(municipality: string) {
  const normalized = normalizeStreetText(municipality);
  return BITONTO_MUNICIPALITIES.has(normalized)
    || normalized.split(" ").some((part) => BITONTO_MUNICIPALITIES.has(part));
}

function polygonRings(geometry: PropertyZoneGeometry | null): number[][][] | null {
  if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return null;
  const rings = geometry.coordinates.filter((ring): ring is number[][] => Array.isArray(ring));
  return rings.length ? rings : null;
}

function ringContainsPoint(point: PropertyPoint, ring: number[][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const xi = currentPoint[0];
    const yi = currentPoint[1];
    const xj = previousPoint[0];
    const yj = previousPoint[1];
    if (xi == null || yi == null || xj == null || yj == null || ![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = yi > point.latitude !== yj > point.latitude
      && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function zoneContainingPropertyPoint(zones: PropertyLocationZone[], point: PropertyPoint) {
  return zones.find((zone) => {
    const rings = polygonRings(zone.geometry);
    return rings ? ringContainsPoint(point, rings[0] ?? []) && !rings.slice(1).some((ring) => ringContainsPoint(point, ring)) : false;
  }) ?? null;
}

export class NominatimPropertyGeocoder {
  private lastRequestAt = 0;
  private readonly cache = new Map<string, GeocodedPropertyPoint | null>();

  constructor(private readonly options: {
    baseUrl?: string;
    userAgent?: string;
    minimumDelayMs?: number;
    fetchImpl?: typeof fetch;
  } = {}) {}

  async geocode(address: PropertyAddress, municipality: string): Promise<GeocodedPropertyPoint | null> {
    if (!address.streetName) return null;
    const cacheKey = normalizeStreetText(`${address.normalizedAddress}|${municipality}`);
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null;

    const candidates: Array<{ street: string; precision: "exact" | "street" }> = address.civicNumber
      ? [{ street: `${address.civicNumber} ${address.streetName}`, precision: "exact" }, { street: address.streetName, precision: "street" }]
      : [{ street: address.streetName, precision: "street" }];

    for (const candidate of candidates) {
      const result = await this.search(candidate.street, municipality);
      if (result) {
        const precision = candidate.precision === "exact"
          && result.houseNumber
          && normalizeStreetText(result.houseNumber) === normalizeStreetText(address.civicNumber ?? "")
          ? "exact" as const
          : "street" as const;
        const located = { latitude: result.latitude, longitude: result.longitude, precision };
        this.cache.set(cacheKey, located);
        return located;
      }
    }
    this.cache.set(cacheKey, null);
    return null;
  }

  private async search(street: string, municipality: string): Promise<(PropertyPoint & { houseNumber: string | null }) | null> {
    const elapsed = Date.now() - this.lastRequestAt;
    const delay = Math.max(0, (this.options.minimumDelayMs ?? 1_100) - elapsed);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    const url = new URL("search", this.options.baseUrl ?? "https://nominatim.openstreetmap.org/");
    url.searchParams.set("street", street);
    url.searchParams.set("city", municipality);
    url.searchParams.set("countrycodes", "it");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("layer", "address");
    url.searchParams.set("limit", "3");

    this.lastRequestAt = Date.now();
    const response = await (this.options.fetchImpl ?? fetch)(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "it",
        "User-Agent": this.options.userAgent ?? "ListingRadar/0.1 property-location-resolver",
      },
    });
    if (!response.ok) throw new Error(`Geocoding non disponibile (${response.status})`);
    const results = await response.json() as NominatimResult[];
    for (const result of results) {
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude, houseNumber: clean(result.address?.house_number) || null };
      }
    }
    return null;
  }
}

function uniqueStreetZone(address: PropertyAddress, zones: PropertyLocationZone[]) {
  if (!address.streetName) return null;
  const street = normalizeStreetText(address.streetName);
  const matches = zones.filter((zone) => zone.associated_streets.some((candidate) => normalizeStreetText(candidate) === street));
  return matches.length === 1 ? matches[0] : null;
}

function verifiedStreetZone(address: PropertyAddress, zones: PropertyLocationZone[]) {
  if (!address.streetName) return null;
  const zoneNumber = VERIFIED_ZONE_BY_STREET.get(normalizeStreetText(address.streetName));
  return zoneNumber == null ? null : zones.find((zone) => zone.zone_number === zoneNumber) ?? null;
}

export async function resolvePropertyLocation(input: {
  address: string | null;
  municipality: string;
  latitude?: number | null;
  longitude?: number | null;
}, zones: PropertyLocationZone[], geocoder: NominatimPropertyGeocoder): Promise<PropertyLocationResolution> {
  const parsed = parsePropertyAddress(input.address, input.municipality);
  const base = {
    normalized_address: parsed.normalizedAddress,
    street_name: parsed.streetName,
    civic_number: parsed.civicNumber,
    resolved_at: new Date().toISOString(),
  };
  if (!belongsToBitontoMunicipality(input.municipality)) {
    return { ...base, latitude: null, longitude: null, zone_id: null, zone_number: null, zone_name: null, status: "outside_municipality", confidence: "none", source: "none" };
  }

  const existingPoint = input.latitude != null && input.longitude != null
    ? { latitude: Number(input.latitude), longitude: Number(input.longitude) }
    : null;
  try {
    const geocodedPoint = existingPoint ? null : await geocoder.geocode(parsed, input.municipality);
    const point = existingPoint ?? geocodedPoint;
    if (point) {
      const zone = zoneContainingPropertyPoint(zones, point);
      return {
        ...base,
        latitude: point.latitude,
        longitude: point.longitude,
        zone_id: zone?.id ?? null,
        zone_number: zone?.zone_number ?? null,
        zone_name: zone?.name ?? null,
        status: zone ? "resolved" : "outside_zones",
        confidence: existingPoint ? (parsed.civicNumber ? "exact" : "street") : geocodedPoint?.precision ?? "street",
        source: existingPoint ? "existing_coordinates" : "nominatim",
      };
    }
    const verifiedZone = verifiedStreetZone(parsed, zones);
    const streetZone = verifiedZone ?? uniqueStreetZone(parsed, zones);
    return {
      ...base,
      latitude: null,
      longitude: null,
      zone_id: streetZone?.id ?? null,
      zone_number: streetZone?.zone_number ?? null,
      zone_name: streetZone?.name ?? null,
      status: streetZone ? "street_match" : "not_found",
      confidence: streetZone ? "street" : "none",
      source: verifiedZone ? "verified_street_index" : streetZone ? "zone_street_index" : "none",
    };
  } catch (error) {
    return {
      ...base,
      latitude: null,
      longitude: null,
      zone_id: null,
      zone_number: null,
      zone_name: null,
      status: "error",
      confidence: "none",
      source: "none",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
