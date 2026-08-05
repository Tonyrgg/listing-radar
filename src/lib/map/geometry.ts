import type { InternalZone, PropertyRequest } from "@/lib/matching/types";
import type { GeoJsonGeometry } from "./types";

export type MapPoint = { latitude: number; longitude: number };

type LngLat = [number, number];

export function polygonRing(geometry?: GeoJsonGeometry | null): LngLat[] | null {
  return polygonRings(geometry)?.[0] ?? null;
}

export function polygonRings(geometry?: GeoJsonGeometry | null): LngLat[][] | null {
  if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return null;
  const rings = geometry.coordinates.flatMap((ring) => {
    if (!Array.isArray(ring)) return [];
    const points = ring.filter((point): point is LngLat =>
      Array.isArray(point) && point.length >= 2 &&
      typeof point[0] === "number" && typeof point[1] === "number",
    );
    return points.length >= 3 ? [points] : [];
  });
  return rings.length ? rings : null;
}

export function pointInPolygon(point: MapPoint, geometry?: GeoJsonGeometry | null) {
  const rings = polygonRings(geometry);
  if (!rings) return false;
  const [outerRing, ...holes] = rings;
  if (!ringContainsPoint(point, outerRing)) return false;
  return !holes.some((hole) => ringContainsPoint(point, hole));
}

type LabelCell = {
  x: number;
  y: number;
  halfSize: number;
  distance: number;
  potential: number;
};

export function polygonLabelPoint(geometry?: GeoJsonGeometry | null): MapPoint | null {
  const rings = polygonRings(geometry);
  if (!rings) return null;

  const outerRing = rings[0];
  const longitudes = outerRing.map(([longitude]) => longitude);
  const latitudes = outerRing.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const width = maxLongitude - minLongitude;
  const height = maxLatitude - minLatitude;
  const cellSize = Math.min(width, height);

  if (cellSize === 0) {
    return { latitude: outerRing[0][1], longitude: outerRing[0][0] };
  }

  const cells: LabelCell[] = [];
  const halfSize = cellSize / 2;
  for (let longitude = minLongitude; longitude < maxLongitude; longitude += cellSize) {
    for (let latitude = minLatitude; latitude < maxLatitude; latitude += cellSize) {
      cells.push(createLabelCell(longitude + halfSize, latitude + halfSize, halfSize, rings));
    }
  }

  let bestCell = centroidLabelCell(outerRing, rings);
  const boundingCell = createLabelCell(
    minLongitude + width / 2,
    minLatitude + height / 2,
    0,
    rings,
  );
  if (boundingCell.distance > bestCell.distance) bestCell = boundingCell;

  const precision = Math.max(cellSize / 80, 0.000002);
  while (cells.length) {
    cells.sort((left, right) => left.potential - right.potential);
    const cell = cells.pop()!;
    if (cell.distance > bestCell.distance) bestCell = cell;
    if (cell.potential - bestCell.distance <= precision) continue;

    const nextHalfSize = cell.halfSize / 2;
    cells.push(
      createLabelCell(cell.x - nextHalfSize, cell.y - nextHalfSize, nextHalfSize, rings),
      createLabelCell(cell.x + nextHalfSize, cell.y - nextHalfSize, nextHalfSize, rings),
      createLabelCell(cell.x - nextHalfSize, cell.y + nextHalfSize, nextHalfSize, rings),
      createLabelCell(cell.x + nextHalfSize, cell.y + nextHalfSize, nextHalfSize, rings),
    );
  }

  return { latitude: bestCell.y, longitude: bestCell.x };
}

function createLabelCell(x: number, y: number, halfSize: number, rings: [number, number][][]): LabelCell {
  const distance = signedDistanceToPolygon(x, y, rings);
  return {
    x,
    y,
    halfSize,
    distance,
    potential: distance + halfSize * Math.SQRT2,
  };
}

function centroidLabelCell(outerRing: [number, number][], rings: [number, number][][]) {
  let area = 0;
  let longitude = 0;
  let latitude = 0;

  for (let index = 0, previous = outerRing.length - 1; index < outerRing.length; previous = index++) {
    const [currentLongitude, currentLatitude] = outerRing[index];
    const [previousLongitude, previousLatitude] = outerRing[previous];
    const factor = previousLongitude * currentLatitude - currentLongitude * previousLatitude;
    longitude += (previousLongitude + currentLongitude) * factor;
    latitude += (previousLatitude + currentLatitude) * factor;
    area += factor * 3;
  }

  if (area === 0) return createLabelCell(outerRing[0][0], outerRing[0][1], 0, rings);
  return createLabelCell(longitude / area, latitude / area, 0, rings);
}

function signedDistanceToPolygon(x: number, y: number, rings: [number, number][][]) {
  let inside = false;
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;

  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [currentX, currentY] = ring[index];
      const [previousX, previousY] = ring[previous];
      if ((currentY > y) !== (previousY > y) && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX) {
        inside = !inside;
      }
      minimumDistanceSquared = Math.min(
        minimumDistanceSquared,
        squaredDistanceToSegment(x, y, currentX, currentY, previousX, previousY),
      );
    }
  }

  return (inside ? 1 : -1) * Math.sqrt(minimumDistanceSquared);
}

function squaredDistanceToSegment(
  x: number,
  y: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  let segmentX = startX;
  let segmentY = startY;
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  if (deltaX !== 0 || deltaY !== 0) {
    const ratio = ((x - startX) * deltaX + (y - startY) * deltaY) / (deltaX * deltaX + deltaY * deltaY);
    if (ratio > 1) {
      segmentX = endX;
      segmentY = endY;
    } else if (ratio > 0) {
      segmentX += deltaX * ratio;
      segmentY += deltaY * ratio;
    }
  }

  const distanceX = x - segmentX;
  const distanceY = y - segmentY;
  return distanceX * distanceX + distanceY * distanceY;
}

function ringContainsPoint(point: MapPoint, ring: LngLat[]) {
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
    request.notes,
    fields.Esigenze,
    fields["Dettaglio Esigenza"],
    request.raw_payload?.evolutionText,
    ...(request.raw_payload?.activities ?? []).flatMap((activity) => [activity.subject, activity.description]),
  ].filter(Boolean).join(" "));

  if (!source) return [];

  const matches = zones.flatMap((zone) => {
    const aliases = zone.aliases.map(normalizeZoneText).map((alias) => alias.includes(" ") ? alias : `zona ${alias}`);
    const phrases = [zone.name, ...aliases, ...zone.associated_streets, ...zone.landmarks]
      .map(normalizeZoneText)
      .filter((phrase, index, values) => phrase.length >= 4 && values.indexOf(phrase) === index);
    return phrases.flatMap((phrase) => phraseOccurrences(source, phrase).map(({ start, end }) => ({ zone, phrase, start, end })));
  }).sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start);

  const selected: typeof matches = [];
  for (const match of matches) {
    if (!selected.some((current) => match.start < current.end && match.end > current.start)) selected.push(match);
  }

  const byZone = new Map<string, { zoneId: string; preferenceLevel: "preferred" | "excluded" }>();
  for (const match of selected.sort((left, right) => left.start - right.start)) {
    const preferenceLevel = isNegatedAt(source, match.start, match.end) ? "excluded" as const : "preferred" as const;
    if (!byZone.has(match.zone.id) || preferenceLevel === "excluded") byZone.set(match.zone.id, { zoneId: match.zone.id, preferenceLevel });
  }
  return [...byZone.values()];
}

function phraseOccurrences(source: string, phrase: string) {
  const occurrences: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(phrase, cursor);
    if (start < 0) break;
    const end = start + phrase.length;
    const before = start === 0 ? " " : source[start - 1];
    const after = end === source.length ? " " : source[end];
    if (before === " " && after === " ") occurrences.push({ start, end });
    cursor = start + Math.max(1, phrase.length);
  }
  return occurrences;
}

function isNegatedAt(source: string, start: number, end: number) {
  const before = source.slice(Math.max(0, start - 56), start).trim();
  const after = source.slice(end, Math.min(source.length, end + 24)).trim();
  return /(?:^|\s)(?:no|non|esclude|esclusa|escluso|evita|evitare|fuori|tranne)(?:\s+dal|\s+dalla|\s+da|\s+il|\s+la|\s+zona)?\s*$/i.test(before)
    || /^(?:no|esclusa|escluso|da evitare)(?:\s|$)/i.test(after);
}
