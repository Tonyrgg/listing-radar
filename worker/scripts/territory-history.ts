import dotenv from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { historyClient, exportHistory, type HistorySnapshot } from "../src/territory/history-source.js";
import { adoptHistory, type HistoryMappings } from "../src/territory/history.js";
import { TerritoryStore } from "../src/territory/store.js";
import type { Street } from "../src/territory/model.js";
import { lockTerritoryProfile } from "../src/territory/profile-lock.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const apply = argv.includes("--apply");
if (!process.env.APPDATA) throw new Error("Lo storico va nel profilo di prova Windows");
const directory = path.join(process.env.APPDATA, "ListingRadarTerritoryLab-live");
await mkdir(directory, { recursive: true });
let snapshot: HistorySnapshot;
if (option("--file")) snapshot = JSON.parse(await readFile(path.resolve(option("--file")!), "utf8"));
else if (argv.includes("--read-source")) {
  // Explicit import command only. The Electron application never loads these env files.
  dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
  dotenv.config({ path: path.join(root, "worker/.env"), quiet: true, override: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurazione della fonte storica non disponibile");
  snapshot = await exportHistory(historyClient(url, key), new URL(url).origin);
  await writeFile(path.join(directory, "history-snapshot.json"), JSON.stringify(snapshot), { mode: 0o600 });
} else throw new Error("Scegli --read-source per una lettura senza scritture, oppure --file per un'esportazione locale");
const inventory = JSON.parse(await readFile(path.join(root, "worker/dist-territory/territory/renderer/inventory.json"), "utf8")) as { streets: Street[] };
const mappings: HistoryMappings = option("--mappings") ? JSON.parse(await readFile(path.resolve(option("--mappings")!), "utf8")) : {};
if (apply) {
  const release = lockTerritoryProfile(directory);
  try {
  const store = await TerritoryStore.open(directory, inventory.streets);
  const report = await adoptHistory(store, snapshot, mappings);
  await writeFile(path.join(directory, "history-report.json"), JSON.stringify({ ...report, skippedJobs: snapshot.skippedJobIds.length, issues: store.read().history?.flatMap(h => h.issues.map(issue => ({ ...issue, jobId: h.id }))) }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, skippedJobs: snapshot.skippedJobIds.length, destination: "solo archivio locale Territorio Prova" }));
  } finally { release(); }
} else console.log(JSON.stringify({ jobs: snapshot.jobs.length, properties: snapshot.jobs.reduce((n, j) => n + j.graph.properties.length, 0), skippedJobs: snapshot.skippedJobIds.length, applied: false }));
