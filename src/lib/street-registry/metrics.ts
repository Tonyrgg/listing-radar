export type GeoPoint = { latitude: number; longitude: number };
export type StreetLineGeometry =
  | { type: "LineString"; coordinates: unknown }
  | { type: "MultiLineString"; coordinates: unknown };

type LngLat = [number, number];

export const DEFAULT_STREET_RING_METERS = 250;

export function streetLines(geometry: StreetLineGeometry | null | undefined): LngLat[][] {
  if (!geometry) return [];
  const rawLines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(rawLines)) return [];
  return rawLines.flatMap((rawLine) => {
    if (!Array.isArray(rawLine)) return [];
    const line = rawLine.filter((value): value is LngLat =>
      Array.isArray(value)
      && value.length >= 2
      && typeof value[0] === "number"
      && Number.isFinite(value[0])
      && typeof value[1] === "number"
      && Number.isFinite(value[1]),
    );
    return line.length >= 2 ? [line] : [];
  });
}

export function haversineDistanceMeters(left: GeoPoint, right: GeoPoint): number {
  const radius = 6_371_008.8;
  const toRadians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * toRadians;
  const longitudeDelta = (right.longitude - left.longitude) * toRadians;
  const leftLatitude = left.latitude * toRadians;
  const rightLatitude = right.latitude * toRadians;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function streetLengthMeters(geometry: StreetLineGeometry | null | undefined): number | null {
  const lines = streetLines(geometry);
  if (!lines.length) return null;
  return lines.reduce((total, line) => total + line.slice(1).reduce((lineTotal, coordinate, index) => {
    const previous = line[index];
    return lineTotal + haversineDistanceMeters(
      { longitude: previous[0], latitude: previous[1] },
      { longitude: coordinate[0], latitude: coordinate[1] },
    );
  }, 0), 0);
}

export function streetRepresentativePoint(geometry: StreetLineGeometry | null | undefined): GeoPoint | null {
  const lines = streetLines(geometry);
  const segments = lines.flatMap((line) => line.slice(1).map((end, index) => {
    const start = line[index];
    return {
      start,
      end,
      length: haversineDistanceMeters(
        { longitude: start[0], latitude: start[1] },
        { longitude: end[0], latitude: end[1] },
      ),
    };
  }));
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!segments.length) return null;
  if (totalLength === 0) {
    return { longitude: segments[0].start[0], latitude: segments[0].start[1] };
  }

  const target = totalLength / 2;
  let traversed = 0;
  for (const segment of segments) {
    if (traversed + segment.length >= target) {
      const ratio = segment.length === 0 ? 0 : (target - traversed) / segment.length;
      return {
        longitude: segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
        latitude: segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
      };
    }
    traversed += segment.length;
  }
  const last = segments.at(-1)!.end;
  return { longitude: last[0], latitude: last[1] };
}

export function streetDistanceMeters(
  center: GeoPoint,
  geometry: StreetLineGeometry | null | undefined,
): number | null {
  const lines = streetLines(geometry);
  if (!lines.length) return null;

  const latitudeScale = 111_320;
  const longitudeScale = Math.cos(center.latitude * Math.PI / 180) * 111_320;
  let minimum = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const start = line[index - 1];
      const end = line[index];
      const startX = (start[0] - center.longitude) * longitudeScale;
      const startY = (start[1] - center.latitude) * latitudeScale;
      const endX = (end[0] - center.longitude) * longitudeScale;
      const endY = (end[1] - center.latitude) * latitudeScale;
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const denominator = deltaX * deltaX + deltaY * deltaY;
      const projection = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / denominator));
      minimum = Math.min(minimum, Math.hypot(startX + projection * deltaX, startY + projection * deltaY));
    }
  }
  return Number.isFinite(minimum) ? minimum : null;
}

export function distanceRing(distanceMeters: number | null, ringMeters = DEFAULT_STREET_RING_METERS): number | null {
  if (distanceMeters == null) return null;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) throw new Error("Distanza non valida");
  if (!Number.isFinite(ringMeters) || ringMeters <= 0) throw new Error("Ampiezza corona non valida");
  return Math.floor(distanceMeters / ringMeters);
}

export function rankByDistance<T extends { id: string; distance: number | null }>(items: T[]): Map<string, number> {
  return new Map(items
    .filter((item): item is T & { distance: number } => item.distance != null && Number.isFinite(item.distance))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
    .map((item, index) => [item.id, index + 1]));
}

