import type { InternalZone, PropertyRequest } from "@/lib/matching/types";
import type { GeoJsonGeometry } from "./types";

export type MapPoint = { latitude: number; longitude: number };

type LngLat = [number, number];

export function polygonRing(geometry?: GeoJsonGeometry | null): LngLat[] | null {
  if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return null;
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring)) return null;
  const points = ring.filter((point): point is LngLat =>
    Array.isArray(point) && point.length >= 2 &&
    typeof point[0] === "number" && typeof point[1] === "number",
  );
  return points.length >= 3 ? points : null;
}

export function pointInPolygon(point: MapPoint, geometry?: GeoJsonGeometry | null) {
  const ring = polygonRing(geometry);
  if (!ring) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects = yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

export function zoneContainingPoint(zones: InternalZone[], point: MapPoint) {
  return zones.find((zone) => pointInPolygon(point, zone.geometry));
}

export function normalizeZoneText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function suggestedZoneIdsForRequest(
  request: Pick<PropertyRequest, "title" | "notes" | "raw_payload">,
  zones: InternalZone[],
) {
  return suggestedZonePreferencesForRequest(request, zones).map((item) => item.zoneId);
}

export function suggestedZonePreferencesForRequest(
  request: Pick<PropertyRequest, "title" | "notes" | "raw_payload">,
  zones: InternalZone[],
) {
  const fields = request.raw_payload?.fields ?? {};
  const source = normalizeZoneText([
    request.title,
    request.notes,
    fields.Esigenze,
    fields["Dettaglio Esigenza"],
    fields["Destinazione Richiesta"],
    request.raw_payload?.evolutionText,
  ].filter(Boolean).join(" "));

  if (!source) return [];

  return zones.flatMap((zone) => {
    const zoneName = normalizeZoneText(zone.name);
    let matchedPhrase = zoneName.length >= 4 && containsPhrase(source, zoneName) ? zoneName : null;

    const explicitPlaces = [...zone.associated_streets, ...zone.landmarks]
      .map(normalizeZoneText)
      .filter((candidate) => candidate.length >= 4);
    matchedPhrase ??= explicitPlaces.find((candidate) => containsPhrase(source, candidate)) ?? null;

    matchedPhrase ??= zone.aliases.map(normalizeZoneText).map((alias) => {
      if (alias.length < 4) return false;
      const phrase = alias.includes(" ") ? alias : `zona ${alias}`;
      return containsPhrase(source, phrase) ? phrase : false;
    }).find((phrase): phrase is string => Boolean(phrase)) ?? null;

    if (!matchedPhrase) return [];
    return [{
      zoneId: zone.id,
      preferenceLevel: isNegated(source, matchedPhrase) ? "excluded" as const : "preferred" as const,
    }];
  });
}

function containsPhrase(source: string, phrase: string) {
  return ` ${source} `.includes(` ${phrase} `);
}

function isNegated(source: string, phrase: string) {
  const index = ` ${source} `.indexOf(` ${phrase} `);
  if (index < 0) return false;
  const before = ` ${source} `.slice(Math.max(0, index - 34), index).trim();
  return /(?:^|\s)(?:no|non|esclude|esclusa|escluso|evita|evitare|fuori)(?:\s+dal|\s+dalla|\s+da|\s+il|\s+la)?\s*$/i.test(before);
}
