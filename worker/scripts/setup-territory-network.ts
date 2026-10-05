import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNetwork, type NetworkWay } from "../src/territory/network.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cache = path.join(root, ".runtime/territory-catalog"); await mkdir(cache, { recursive: true });
const query = '[out:json][timeout:45];area["boundary"="administrative"]["admin_level"="8"]["name"="Bitonto"]->.bitonto;way(area.bitonto)["highway"];out geom;';
let payload: { elements: NetworkWay[] } | undefined;
const args = process.argv.slice(2); const input = args.indexOf("--file");
if (input >= 0) payload = JSON.parse(await readFile(path.resolve(args[input + 1]!), "utf8"));
else {
  for (const endpoint of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, { headers: { accept: "application/json", "user-agent": "ListingRadarTerritory/1.0" }, signal: AbortSignal.timeout(55000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json(); if (!payload || !Array.isArray(payload.elements)) throw new Error("Dati cartografici non riconosciuti");
      break;
    } catch { console.warn(`Fonte cartografica non disponibile: ${new URL(endpoint).hostname}`); }
  }
}
if (!payload || !Array.isArray(payload.elements) || !payload.elements.length || (payload as { remark?: string }).remark) throw new Error("Rete non disponibile o incompleta: la copia precedente resta conservata");
const crosswalk = JSON.parse(await readFile(path.join(root, "data/street-registry/osm-crosswalk.geojson"), "utf8"));
const known = new Set<number>(crosswalk.features.flatMap((f: { properties: { match_notes: string } }) => (f.properties.match_notes.match(/Way OSM: ([\d,]+)/)?.[1] ?? "").split(",").filter(Boolean).map(Number)));
const seed = JSON.parse(await readFile(path.join(root, "data/street-registry/bitonto-centers.json"), "utf8"));
const streets = buildNetwork(payload.elements, known, [{ name: "Bitonto", ...seed.city }, ...seed.zoneFallbacks.filter((c: { zoneNumber: number }) => [14, 15].includes(c.zoneNumber))]);
if (streets.length < 50) throw new Error("Rete troppo parziale per il setup: copia precedente conservata");
await writeFile(path.join(cache, "network-overpass.json"), JSON.stringify(payload));
const destination = path.join(root, "data/street-registry/territory-network.json"), temporary = `${destination}.${randomUUID()}.tmp`;
await writeFile(temporary, JSON.stringify({ version: 1, source: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/copyright", license: "ODbL 1.0", municipality: "BITONTO", fetchedAt: new Date().toISOString(), query, streets }));
await rename(temporary, destination);
console.log(JSON.stringify({ networkDossiers: streets.length, named: streets.filter(s => !s.needsReview).length, unnamed: streets.filter(s => s.needsReview).length, destination: "solo rete locale del laboratorio" }));
