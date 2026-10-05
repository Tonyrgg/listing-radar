import { readFile, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { TerritoryStore } from "../src/territory/store.js";
import { openOnlineMemory } from "../src/territory/online-memory.js";
import { lockTerritoryProfile } from "../src/territory/profile-lock.js";
import type { Street } from "../src/territory/model.js";

if (!process.argv.includes("--apply")) throw new Error("Il trasferimento online richiede --apply; nessun archivio è stato modificato");
if (!process.env.APPDATA) throw new Error("Profilo Windows non disponibile");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// This maintenance command is not bundled. Credentials stay in the existing ignored environment file.
const environment = dotenv.parse(await readFile(path.join(root, ".env.local"), "utf8"));
const directory = path.join(process.env.APPDATA, "ListingRadarTerritoryLab-live");
const release = lockTerritoryProfile(directory);
try {
  const inventory = JSON.parse(await readFile(path.join(root, "worker/dist-desktop/territory/renderer/inventory.json"), "utf8")) as { streets: Street[] };
  const ledger = path.join(directory, "territory-ledger.json");
  await copyFile(ledger, `${ledger}.before-online-${randomUUID()}.json`);
  const store = await TerritoryStore.open(directory, inventory.streets);
  const sync = await openOnlineMemory(store, directory, { url: environment.NEXT_PUBLIC_SUPABASE_URL!, key: environment.SUPABASE_SERVICE_ROLE_KEY! });
  await sync.reconcile();
  // Read back the remote state before reporting a confirmed transfer.
  const verified = await sync.pull();
  console.log(JSON.stringify({ environment: "online", revision: verified.revision, units: Object.keys(store.read().units).length, streets: store.read().streets.length, historyIssues: store.read().history?.reduce((n, h) => n + h.issues.length, 0), credentialStored: false }));
} finally { release(); }
