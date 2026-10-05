import type { Geometry, Street, TerritoryState } from "./model.js";

export type NetworkWay = { type: string; id: number; nodes?: number[]; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> };
const roadKinds = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "pedestrian", "service"]);
const nameKey = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
const validPoint = (p: { lat: number; lon: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= 40.8 && p.lat <= 41.25 && p.lon >= 16.3 && p.lon <= 16.85;

/** The caller's Overpass query scopes data to the municipal administrative area. */
export function buildNetwork(ways: NetworkWay[], knownWayIds: Set<number>, centers: Array<{ name: string; latitude: number; longitude: number }>): Street[] {
  const groups = new Map<string, NetworkWay[]>();
  const ids = new Set<number>();
  for (const way of ways) {
    if (way.type !== "way" || !Number.isSafeInteger(way.id) || way.id < 1 || ids.has(way.id)) continue;
    ids.add(way.id);
    const kind = way.tags?.highway ?? "";
    const namedPath = Boolean(way.tags?.name?.trim()) && ["footway", "cycleway", "track", "steps", "path"].includes(kind);
    if (knownWayIds.has(way.id) || (!roadKinds.has(kind) && !namedPath) || !way.geometry || way.geometry.length < 2 || !way.geometry.every(validPoint)) continue;
    const key = way.tags?.name?.trim() ? nameKey(way.tags.name) : `unnamed:${way.id}`;
    groups.set(key, [...groups.get(key) ?? [], way]);
  }
  const result: Street[] = [];
  for (const group of groups.values()) {
    const parent = group.map((_, i) => i);
    const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
    const joins = new Map<string, number>();
    group.forEach((way, i) => {
      // Shared OSM nodes or identical coordinate vertices are evidence of continuity.
      const points = [...(way.nodes ?? []).map(n => `n:${n}`), ...way.geometry!.map(p => `p:${p.lon.toFixed(7)},${p.lat.toFixed(7)}`)];
      for (const point of points) { const prior = joins.get(point); if (prior !== undefined) parent[root(i)] = root(prior); else joins.set(point, i); }
    });
    const components = new Map<number, NetworkWay[]>();
    group.forEach((way, i) => { const key = root(i); components.set(key, [...components.get(key) ?? [], way]); });
    for (const component of components.values()) {
      component.sort((a, b) => a.id - b.id);
      const osmIds = component.map(w => w.id), name = component[0]!.tags?.name?.trim() || undefined;
      const lines = component.map(way => way.geometry!.map(p => [p.lon, p.lat]));
      const geometry: Geometry = lines.length === 1 ? { type: "LineString", coordinates: lines[0]! } : { type: "MultiLineString", coordinates: lines };
      const points = component.flatMap(way => way.geometry!);
      const center = centers.filter(c => c.name !== "Bitonto" && points.every(p => Math.hypot((p.lon - c.longitude) * 84000, (p.lat - c.latitude) * 111000) < 2200)).sort((a, b) => Math.hypot(points[0]!.lon - a.longitude, points[0]!.lat - a.latitude) - Math.hypot(points[0]!.lon - b.longitude, points[0]!.lat - b.latitude))[0];
      result.push({ id: `network:${osmIds[0]}`, name: name ?? `Tratto senza nome ${osmIds[0]}`, sisterName: name ? nameKey(name) : "", locality: center?.name ?? "Bitonto", geometry, geometryEvidence: `OpenStreetMap · ODbL 1.0 · tracciati ${osmIds.join(", ")} nell'area amministrativa di Bitonto. Il collegamento al Codvia richiede conferma.`, needsReview: !name, catalogKind: "network", osmWayIds: osmIds });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** Keeps the immutable catalogue and overlays only explicitly confirmed bindings. */
export function applyNetworkBindings(state: TerritoryState) {
  for (const [networkId, binding] of Object.entries(state.networkBindings ?? {})) {
    const network = state.streets.find(s => s.id === networkId && s.catalogKind === "network");
    const official = state.streets.find(s => s.id === binding.officialId && s.catalogKind !== "network");
    const confirmed = binding.geometry ?? network?.geometry;
    if (!network || !confirmed || !official) throw new Error("Associazione della rete non riconosciuta: archivio conservato");
    // Keep an existing official trace, but include the confirmed new component.
    const toLines = (g: Geometry) => g.type === "LineString" ? [g.coordinates as number[][]] : g.coordinates as number[][][];
    const unique = new Map([...official.geometry ? toLines(official.geometry) : [], ...toLines(confirmed)].map(line => [JSON.stringify(line), line]));
    const lines = [...unique.values()];
    official.geometry = lines.length === 1 ? { type: "LineString", coordinates: lines[0]! } : { type: "MultiLineString", coordinates: lines };
    official.geometryEvidence = `Associazione manuale dalla rete propria, confermata ${binding.confirmedAt}. ${binding.evidence ?? network.geometryEvidence}`;
    network.linkedOfficialId = official.id;
  }
}
