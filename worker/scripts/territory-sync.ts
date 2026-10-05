import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TerritorySync, type TerritorySyncConfig } from "../src/territory/sync.js";
import { TerritoryStore } from "../src/territory/store.js";
import { lockTerritoryProfile } from "../src/territory/profile-lock.js";
import type { Street } from "../src/territory/model.js";

const argv = process.argv.slice(2);
if (argv.includes("--push") === argv.includes("--pull")) throw new Error("Scegli --push oppure --pull");
if (!process.env.APPDATA) throw new Error("Profilo Windows non disponibile");
const kind = argv.includes("--simulation") ? "simulation" : "live";
const directory = path.join(process.env.APPDATA, `ListingRadarTerritoryLab${kind === "live" ? "-live" : ""}`);
const config = JSON.parse(await readFile(path.join(directory, "sync-config.json"), "utf8")) as TerritorySyncConfig;
if (config.profileKind !== kind) throw new Error("Configurazione assegnata a un altro profilo");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(await readFile(path.join(root, "dist-territory/territory/renderer/inventory.json"), "utf8")) as { streets: Street[] };
const release = lockTerritoryProfile(directory);
try {
  const store = await TerritoryStore.open(directory, inventory.streets);
  const sync = new TerritorySync(store, directory, config);
  const result = argv.includes("--push") ? await sync.push() : await sync.pull();
  console.log(JSON.stringify({ ...result, environment: "Supabase locale", units: Object.keys(store.read().units).length }));
} finally { release(); }
