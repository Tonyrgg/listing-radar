import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BITONTO_OFFICIAL_STREETS_URL, parseOfficialStreetInventory } from "../../src/lib/street-registry/official-inventory";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cache = path.join(root, ".runtime/territory-catalog");
const distribution = process.argv.includes("--desktop") ? "dist-desktop" : "dist-territory";
const output = path.join(root, `worker/${distribution}/territory/renderer`);
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
let csv: string;
try { csv = await readFile(path.join(cache, "inventory.csv"), "utf8"); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const response = await fetch(BITONTO_OFFICIAL_STREETS_URL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Inventario ufficiale non disponibile: HTTP ${response.status}`);
  csv = await response.text();
  parseOfficialStreetInventory(csv); // Validate before storing, never cache an error page.
  await writeFile(path.join(cache, "inventory.csv"), csv);
}
const inventory = parseOfficialStreetInventory(csv);
const crosswalk = JSON.parse(await readFile(path.join(root, "data/street-registry/osm-crosswalk.geojson"), "utf8"));
const byCode = new Map<string, { geometry: unknown; properties: { match_notes: string } }>(crosswalk.features.map((f: { properties: { official_code: string } }) => [f.properties.official_code, f]));
const official = inventory.map(street => ({ id: street.official_code, name: street.canonical_name, sisterName: street.sister_search_name, locality: street.locality === "PALOMBAIO" ? "Palombaio" : street.locality === "MARIOTTO" ? "Mariotto" : "Bitonto", geometry: byCode.get(street.official_code)?.geometry ?? null, geometryEvidence: byCode.get(street.official_code)?.properties.match_notes ?? null, needsReview: street.record_status === "needs_review", catalogKind: "official" }));
const network = JSON.parse(await readFile(path.join(root, "data/street-registry/territory-network.json"), "utf8"));
if (network.version !== 1 || network.municipality !== "BITONTO" || !Array.isArray(network.streets) || network.streets.some((s: { id: string; catalogKind: string }) => !s.id.startsWith("network:") || s.catalogKind !== "network")) throw new Error("Rete del laboratorio non riconosciuta");
const streets = [...official, ...network.streets];
await cp(path.join(root, "worker/src/territory/renderer"), output, { recursive: true });
await cp(path.join(root, "node_modules/leaflet/dist"), path.join(output, "vendor"), { recursive: true });
await cp(path.join(root, "worker/src/desktop/renderer/tokens.css"), path.join(output, "tokens.css"));
await cp(path.join(root, "worker/src/territory/preload.cjs"), path.join(root, `worker/${distribution}/territory/preload.cjs`));
await writeFile(path.join(output, "inventory.json"), JSON.stringify({ source: BITONTO_OFFICIAL_STREETS_URL, license: "CC BY 4.0", geometrySource: "OpenStreetMap ODbL 1.0: rete propria e associazioni al Codvia conservate nel repository", streets }));
console.log(`Catalogo Territorio: ${streets.length} vie, ${streets.filter(s => s.geometry).length} geometrie. Nessun accesso a Supabase o ai portali di lavoro.`);
