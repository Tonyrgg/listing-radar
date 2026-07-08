export type ListingCoordinates = {
  latitude: number;
  longitude: number;
  source: string;
};

type CoordinateCandidate = ListingCoordinates & {
  priority: number;
};

const LISTING_COORDINATE_BOUNDS = {
  minLatitude: 41.02,
  maxLatitude: 41.2,
  minLongitude: 16.56,
  maxLongitude: 16.84,
};

const LATITUDE_KEYS = new Set([
  "lat",
  "latitude",
  "latitudine",
  "geolatitude",
]);

const LONGITUDE_KEYS = new Set([
  "lng",
  "lon",
  "long",
  "longitude",
  "longitudine",
  "geolongitude",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function coordinateNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(",", ".");

  if (!/^-?\d{1,3}(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinateInBounds(latitude: number, longitude: number) {
  return (
    latitude >= LISTING_COORDINATE_BOUNDS.minLatitude &&
    latitude <= LISTING_COORDINATE_BOUNDS.maxLatitude &&
    longitude >= LISTING_COORDINATE_BOUNDS.minLongitude &&
    longitude <= LISTING_COORDINATE_BOUNDS.maxLongitude
  );
}

function candidate(
  latitude: unknown,
  longitude: unknown,
  source: string,
  priority: number,
): CoordinateCandidate | null {
  const parsedLatitude = coordinateNumber(latitude);
  const parsedLongitude = coordinateNumber(longitude);

  if (
    parsedLatitude == null ||
    parsedLongitude == null ||
    !coordinateInBounds(parsedLatitude, parsedLongitude)
  ) {
    return null;
  }

  return {
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    source,
    priority,
  };
}

function coordinateKind(key: string) {
  const normalized = normalizeKey(key);

  if (LATITUDE_KEYS.has(normalized) || normalized.endsWith("latitude")) {
    return "latitude";
  }

  if (LONGITUDE_KEYS.has(normalized) || normalized.endsWith("longitude")) {
    return "longitude";
  }

  return null;
}

function coordinateFromRecord(
  record: Record<string, unknown>,
  source: string,
  priority: number,
) {
  let latitude: unknown = null;
  let longitude: unknown = null;

  for (const [key, value] of Object.entries(record)) {
    const kind = coordinateKind(key);

    if (kind === "latitude") {
      latitude = value;
    }

    if (kind === "longitude") {
      longitude = value;
    }
  }

  return candidate(latitude, longitude, source, priority);
}

function coordinateFromGeoPosition(
  value: unknown,
  source: string,
  priority: number,
) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/(-?\d{1,3}[.,]\d+)[,;\s]+(-?\d{1,3}[.,]\d+)/);

  if (!match) {
    return null;
  }

  return candidate(match[1], match[2], source, priority);
}

function parseLatLngPair(value: string, source: string, priority: number) {
  const match = value.match(/^\s*(-?\d{1,3}[.,]\d+)\s*,\s*(-?\d{1,3}[.,]\d+)\s*$/);

  if (!match) {
    return null;
  }

  return candidate(match[1], match[2], source, priority);
}

function coordinateFromMapUrl(value: string, source: string) {
  const decoded = value.replace(/&amp;/gi, "&");
  const exclamationMatch = decoded.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);

  if (exclamationMatch) {
    return candidate(exclamationMatch[1], exclamationMatch[2], `${source}:google-map`, 95);
  }

  let url: URL;

  try {
    url = new URL(decoded);
  } catch {
    return null;
  }

  for (const parameter of ["markers", "marker", "q", "query", "ll", "sll", "center"]) {
    const value = url.searchParams.get(parameter);

    if (!value) {
      continue;
    }

    const coordinates = parseLatLngPair(
      value.split("|").find((part) => /^-?\d/.test(part.trim())) ?? value,
      `${source}:map-${parameter}`,
      parameter === "center" ? 70 : 92,
    );

    if (coordinates) {
      return coordinates;
    }
  }

  return null;
}

function collectUrlCoordinates(html: string, source: string) {
  const candidates: CoordinateCandidate[] = [];
  const urlPattern = /https?:\/\/[^\s"'<>]+/gi;

  for (const match of html.matchAll(urlPattern)) {
    const coordinates = coordinateFromMapUrl(match[0], source);

    if (coordinates) {
      candidates.push(coordinates);
    }
  }

  return candidates;
}

function collectTagAttributeCoordinates(html: string, source: string) {
  const candidates: CoordinateCandidate[] = [];
  const tagPattern = /<[^>]+>/g;
  const attributePattern =
    /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const tag of html.matchAll(tagPattern)) {
    const attributes: Record<string, string> = {};

    for (const attribute of tag[0].matchAll(attributePattern)) {
      const key = attribute[1]?.toLowerCase();

      if (key) {
        attributes[key] = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      }
    }

    const coordinates = coordinateFromRecord(attributes, `${source}:html-attributes`, 90);

    if (coordinates) {
      candidates.push(coordinates);
    }
  }

  return candidates;
}

function collectObjectCoordinates(
  value: unknown,
  source: string,
  priority: number,
  depth = 0,
): CoordinateCandidate[] {
  if (depth > 8 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    const geoPosition = coordinateFromGeoPosition(value, source, priority);
    const mapUrl = /(?:maps|staticmap|geo:|!3d|!4d)/i.test(value)
      ? coordinateFromMapUrl(value, source)
      : null;

    return [geoPosition, mapUrl].filter(
      (item): item is CoordinateCandidate => Boolean(item),
    );
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      collectObjectCoordinates(item, source, priority, depth + 1),
    );
  }

  if (!isRecord(value)) {
    return [];
  }

  const direct = coordinateFromRecord(value, source, priority);
  const nested = Object.values(value).flatMap((child) =>
    collectObjectCoordinates(child, source, priority - 1, depth + 1),
  );

  return direct ? [direct, ...nested] : nested;
}

function bestCandidate(candidates: CoordinateCandidate[]) {
  return candidates.sort((left, right) => right.priority - left.priority)[0] ?? null;
}

export function normalizeListingCoordinates(input: {
  latitude?: unknown;
  longitude?: unknown;
  source?: string | null;
}): ListingCoordinates | null {
  const coordinates = candidate(
    input.latitude,
    input.longitude,
    input.source ?? "input",
    100,
  );

  if (!coordinates) {
    return null;
  }

  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    source: coordinates.source,
  };
}

export function extractListingCoordinates(input: {
  html?: string;
  jsonLd?: unknown[];
  meta?: Record<string, string>;
  rawPayload?: unknown;
  source?: string;
}): ListingCoordinates | null {
  const source = input.source ?? "listing";
  const candidates: CoordinateCandidate[] = [];

  if (input.meta) {
    candidates.push(...collectObjectCoordinates(input.meta, `${source}:meta`, 100));
  }

  if (input.jsonLd) {
    candidates.push(...collectObjectCoordinates(input.jsonLd, `${source}:jsonld`, 98));
  }

  if (input.rawPayload) {
    candidates.push(...collectObjectCoordinates(input.rawPayload, `${source}:payload`, 96));
  }

  if (input.html) {
    candidates.push(...collectTagAttributeCoordinates(input.html, source));
    candidates.push(...collectUrlCoordinates(input.html, source));
  }

  const best = bestCandidate(candidates);

  if (!best) {
    return null;
  }

  return {
    latitude: best.latitude,
    longitude: best.longitude,
    source: best.source,
  };
}
