import { NextResponse } from "next/server";

import { getCurrentUser, isAuthRequired } from "@/lib/auth";
import type { GeoJsonGeometry } from "@/lib/map/types";

export const dynamic = "force-dynamic";

type SnapPoint = {
  latitude: number;
  longitude: number;
};

type OsmElement =
  | {
      type: "node";
      id: number;
      lat: number;
      lon: number;
    }
  | {
      type: "way";
      id: number;
      nodes?: number[];
      tags?: Record<string, string>;
    };

type OsmResponse = {
  elements?: OsmElement[];
};

type GraphNode = {
  id: string;
  latitude: number;
  longitude: number;
};

type RoadEdge = {
  from: string;
  to: string;
  fromPoint: SnapPoint;
  toPoint: SnapPoint;
  distance: number;
};

type AdjacentEdge = {
  to: string;
  distance: number;
};

type StreetGraph = {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, AdjacentEdge[]>;
  roadEdges: RoadEdge[];
};

type QueueItem = {
  id: string;
  distance: number;
};

const BITONTO_BOUNDS = {
  minLatitude: 41.02,
  maxLatitude: 41.2,
  minLongitude: 16.56,
  maxLongitude: 16.84,
};
const MAX_INPUT_POINTS = 1000;
const BBOX_PADDING_DEGREES = 0.004;
const MAX_SNAP_DISTANCE_METERS = 65;
const EXCLUDED_HIGHWAYS = new Set([
  "construction",
  "motorway",
  "motorway_link",
  "proposed",
  "raceway",
  "steps",
  "trunk",
  "trunk_link",
]);

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWithinBitonto(point: SnapPoint) {
  return (
    point.latitude >= BITONTO_BOUNDS.minLatitude &&
    point.latitude <= BITONTO_BOUNDS.maxLatitude &&
    point.longitude >= BITONTO_BOUNDS.minLongitude &&
    point.longitude <= BITONTO_BOUNDS.maxLongitude
  );
}

function metersBetween(a: SnapPoint, b: SnapPoint) {
  const radius = 6371000;
  const latA = (a.latitude * Math.PI) / 180;
  const latB = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;

  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toLocalMeters(point: SnapPoint, originLatitude: number) {
  const latitudeScale = 111320;
  const longitudeScale = 111320 * Math.cos((originLatitude * Math.PI) / 180);

  return {
    x: point.longitude * longitudeScale,
    y: point.latitude * latitudeScale,
  };
}

function projectPointToSegment(point: SnapPoint, edge: RoadEdge) {
  const originLatitude = point.latitude;
  const pointMeters = toLocalMeters(point, originLatitude);
  const startMeters = toLocalMeters(edge.fromPoint, originLatitude);
  const endMeters = toLocalMeters(edge.toPoint, originLatitude);
  const dx = endMeters.x - startMeters.x;
  const dy = endMeters.y - startMeters.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((pointMeters.x - startMeters.x) * dx + (pointMeters.y - startMeters.y) * dy) /
              lengthSquared,
          ),
        );
  const projected = {
    latitude: edge.fromPoint.latitude + (edge.toPoint.latitude - edge.fromPoint.latitude) * ratio,
    longitude:
      edge.fromPoint.longitude + (edge.toPoint.longitude - edge.fromPoint.longitude) * ratio,
  };

  return {
    point: projected,
    distance: metersBetween(point, projected),
  };
}

function readPoints(value: unknown): SnapPoint[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_INPUT_POINTS) {
    return null;
  }

  const points = value.map((item) => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const latitude = record.latitude;
    const longitude = record.longitude;

    if (!isFiniteCoordinate(latitude) || !isFiniteCoordinate(longitude)) {
      return null;
    }

    return { latitude, longitude };
  });

  if (points.some((point) => point == null)) {
    return null;
  }

  return points as SnapPoint[];
}

function getBbox(points: SnapPoint[]) {
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);

  return {
    south: Math.max(Math.min(...latitudes) - BBOX_PADDING_DEGREES, BITONTO_BOUNDS.minLatitude),
    west: Math.max(Math.min(...longitudes) - BBOX_PADDING_DEGREES, BITONTO_BOUNDS.minLongitude),
    north: Math.min(Math.max(...latitudes) + BBOX_PADDING_DEGREES, BITONTO_BOUNDS.maxLatitude),
    east: Math.min(Math.max(...longitudes) + BBOX_PADDING_DEGREES, BITONTO_BOUNDS.maxLongitude),
  };
}

function getOverpassUrl() {
  return (
    process.env.MAP_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter"
  ).trim();
}

function getOverpassQuery(points: SnapPoint[]) {
  const bbox = getBbox(points);
  const bounds = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  return `
[out:json][timeout:20];
(
  way["highway"](${bounds});
);
out body;
>;
out skel qt;
`;
}

function shouldUseWay(way: Extract<OsmElement, { type: "way" }>) {
  const highway = way.tags?.highway;
  return (
    typeof highway === "string" &&
    way.tags?.area !== "yes" &&
    !EXCLUDED_HIGHWAYS.has(highway)
  );
}

function addNode(graph: StreetGraph, id: string, point: SnapPoint) {
  if (!graph.nodes.has(id)) {
    graph.nodes.set(id, {
      id,
      latitude: point.latitude,
      longitude: point.longitude,
    });
  }

  if (!graph.adjacency.has(id)) {
    graph.adjacency.set(id, []);
  }
}

function addEdge(graph: StreetGraph, from: string, to: string, storeRoadEdge = false) {
  const fromNode = graph.nodes.get(from);
  const toNode = graph.nodes.get(to);
  if (!fromNode || !toNode || from === to) return;

  const fromPoint = { latitude: fromNode.latitude, longitude: fromNode.longitude };
  const toPoint = { latitude: toNode.latitude, longitude: toNode.longitude };
  const distance = metersBetween(fromPoint, toPoint);
  graph.adjacency.get(from)?.push({ to, distance });
  graph.adjacency.get(to)?.push({ to: from, distance });

  if (storeRoadEdge) {
    graph.roadEdges.push({ from, to, fromPoint, toPoint, distance });
  }
}

function buildGraph(elements: OsmElement[]) {
  const osmNodes = new Map<number, SnapPoint>();
  const graph: StreetGraph = {
    nodes: new Map(),
    adjacency: new Map(),
    roadEdges: [],
  };

  for (const element of elements) {
    if (element.type === "node") {
      osmNodes.set(element.id, { latitude: element.lat, longitude: element.lon });
    }
  }

  for (const element of elements) {
    if (element.type !== "way" || !shouldUseWay(element) || !element.nodes?.length) {
      continue;
    }

    for (const nodeId of element.nodes) {
      const point = osmNodes.get(nodeId);
      if (point) {
        addNode(graph, String(nodeId), point);
      }
    }

    for (let index = 1; index < element.nodes.length; index += 1) {
      const from = String(element.nodes[index - 1]);
      const to = String(element.nodes[index]);
      if (graph.nodes.has(from) && graph.nodes.has(to)) {
        addEdge(graph, from, to, true);
      }
    }
  }

  return graph;
}

async function fetchStreetGraph(points: SnapPoint[]) {
  const response = await fetch(getOverpassUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "ListingRadar/0.1 street-graph",
    },
    body: new URLSearchParams({ data: getOverpassQuery(points) }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Rete stradale non disponibile ora.");
  }

  const data = (await response.json()) as OsmResponse;
  const graph = buildGraph(data.elements ?? []);

  if (!graph.roadEdges.length) {
    throw new Error("Nessuna strada trovata nell'area selezionata.");
  }

  return graph;
}

function snapPointToGraph(graph: StreetGraph, point: SnapPoint, index: number) {
  let best:
    | {
        edge: RoadEdge;
        snappedPoint: SnapPoint;
        distance: number;
      }
    | null = null;

  for (const edge of graph.roadEdges) {
    const projected = projectPointToSegment(point, edge);
    if (!best || projected.distance < best.distance) {
      best = {
        edge,
        snappedPoint: projected.point,
        distance: projected.distance,
      };
    }
  }

  if (!best || best.distance > MAX_SNAP_DISTANCE_METERS) {
    throw new Error(`Il punto ${index + 1} non e vicino a una strada.`);
  }

  const snapId = `snap:${index}`;
  addNode(graph, snapId, best.snappedPoint);
  addEdge(graph, snapId, best.edge.from);
  addEdge(graph, snapId, best.edge.to);

  return snapId;
}

class MinQueue {
  private items: QueueItem[] = [];

  push(item: QueueItem) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();

    if (this.items.length && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return first;
  }

  get size() {
    return this.items.length;
  }

  private bubbleUp(index: number) {
    let current = index;

    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.items[parent].distance <= this.items[current].distance) break;
      [this.items[parent], this.items[current]] = [this.items[current], this.items[parent]];
      current = parent;
    }
  }

  private bubbleDown(index: number) {
    let current = index;

    while (true) {
      const left = current * 2 + 1;
      const right = current * 2 + 2;
      let smallest = current;

      if (
        left < this.items.length &&
        this.items[left].distance < this.items[smallest].distance
      ) {
        smallest = left;
      }

      if (
        right < this.items.length &&
        this.items[right].distance < this.items[smallest].distance
      ) {
        smallest = right;
      }

      if (smallest === current) break;
      [this.items[current], this.items[smallest]] = [this.items[smallest], this.items[current]];
      current = smallest;
    }
  }
}

function shortestPath(graph: StreetGraph, start: string, end: string) {
  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const queue = new MinQueue();

  distances.set(start, 0);
  queue.push({ id: start, distance: 0 });

  while (queue.size) {
    const current = queue.pop();
    if (!current) break;
    if (current.distance > (distances.get(current.id) ?? Number.POSITIVE_INFINITY)) {
      continue;
    }
    if (current.id === end) break;

    for (const edge of graph.adjacency.get(current.id) ?? []) {
      const nextDistance = current.distance + edge.distance;
      if (nextDistance < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, current.id);
        queue.push({ id: edge.to, distance: nextDistance });
      }
    }
  }

  if (!distances.has(end)) {
    return null;
  }

  const path = [end];
  let current = end;

  while (current !== start) {
    const next = previous.get(current);
    if (!next) return null;
    path.push(next);
    current = next;
  }

  return path.reverse();
}

function appendPathCoordinates(
  coordinates: [number, number][],
  graph: StreetGraph,
  path: string[],
) {
  for (const nodeId of path) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    const coordinate: [number, number] = [node.longitude, node.latitude];
    const previous = coordinates.at(-1);
    if (
      previous &&
      metersBetween(
        { latitude: previous[1], longitude: previous[0] },
        { latitude: coordinate[1], longitude: coordinate[0] },
      ) < 0.75
    ) {
      continue;
    }
    coordinates.push(coordinate);
  }
}

function lineDistance(coordinates: [number, number][]) {
  return coordinates.slice(1).reduce((sum, coordinate, index) => {
    const previous = coordinates[index];
    return (
      sum +
      metersBetween(
        { latitude: previous[1], longitude: previous[0] },
        { latitude: coordinate[1], longitude: coordinate[0] },
      )
    );
  }, 0);
}

async function createGuidedStreet(points: SnapPoint[]) {
  const graph = await fetchStreetGraph(points);
  const snapIds = points.map((point, index) => snapPointToGraph(graph, point, index));
  const coordinates: [number, number][] = [];

  for (let index = 1; index < snapIds.length; index += 1) {
    const path = shortestPath(graph, snapIds[index - 1], snapIds[index]);

    if (!path) {
      throw new Error(`Non riesco a collegare i punti ${index} e ${index + 1}.`);
    }

    appendPathCoordinates(coordinates, graph, path);
  }

  if (coordinates.length < 2) {
    throw new Error("Servono almeno due punti su strada.");
  }

  return coordinates;
}

export async function POST(request: Request) {
  if (isAuthRequired()) {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sessione non valida." },
        { status: 401 },
      );
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Richiesta non valida." },
      { status: 400 },
    );
  }

  const pointsValue =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).points
      : undefined;
  const points = readPoints(pointsValue);

  if (!points) {
    return NextResponse.json(
      { ok: false, error: "Servono almeno 2 punti validi." },
      { status: 400 },
    );
  }

  if (!points.every(isWithinBitonto)) {
    return NextResponse.json(
      { ok: false, error: "I punti devono restare nell'area di Bitonto." },
      { status: 400 },
    );
  }

  try {
    const coordinates = await createGuidedStreet(points);
    const geometry = {
      type: "LineString",
      coordinates,
    } satisfies GeoJsonGeometry;

    return NextResponse.json({
      ok: true,
      geometry,
      distance: lineDistance(coordinates),
      duration: null,
    });
  } catch (snapError) {
    return NextResponse.json(
      {
        ok: false,
        error:
          snapError instanceof Error
            ? snapError.message
            : "Aggancio strada non raggiungibile.",
      },
      { status: 502 },
    );
  }
}
