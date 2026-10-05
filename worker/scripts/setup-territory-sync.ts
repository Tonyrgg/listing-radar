import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localSyncConfig } from "../src/territory/sync.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.APPDATA) throw new Error("Configurazione del laboratorio disponibile su Windows");
const kind = process.argv.includes("--simulation") ? "simulation" : "live";
const directory = path.join(process.env.APPDATA, `ListingRadarTerritoryLab${kind === "live" ? "-live" : ""}`);
await mkdir(directory, { recursive: true });
const filename = path.join(directory, "sync-config.json");
try { await access(filename); console.log("Configurazione della memoria condivisa esistente conservata"); }
catch {
  let status: Record<string, string>;
  try { status = JSON.parse(execFileSync(process.execPath, [path.join(root, "node_modules/supabase/dist/supabase.js"), "status", "-o", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); }
  catch { throw new Error("Supabase locale non disponibile; nessuna configurazione di produzione viene usata"); }
  const config = localSyncConfig({ url: status.API_URL!, key: status.SERVICE_ROLE_KEY!, ownerId: randomUUID(), workspaceId: randomUUID(), profileKind: kind });
  await writeFile(filename, JSON.stringify(config), { flag: "wx", mode: 0o600 });
  console.log(`Memoria condivisa predisposta: Supabase locale, profilo ${kind}. Credenziali solo nel processo principale.`);
}
