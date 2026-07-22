import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [path.resolve(workerRoot, "..", ".env.local"), path.resolve(workerRoot, ".env")];
const environment = {};
for (const source of sources) {
  if (existsSync(source)) Object.assign(environment, dotenv.parse(readFileSync(source)));
}

const keys = [
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CHROME_CDP_URL",
  "CONTACTS_EXCEL_PATH", "ERROR_SCREENSHOT_DIR", "ERROR_SCREENSHOT_RETENTION_DAYS",
  "SISTER_TAB_MATCH", "CRM_TAB_MATCH", "SISTER_KEEPALIVE_ENABLED",
  "SISTER_KEEPALIVE_MIN_SECONDS", "SISTER_KEEPALIVE_MAX_SECONDS", "SISTER_KEEPALIVE_URL",
];
const bundled = Object.fromEntries(keys.flatMap((key) => environment[key] ? [[key, environment[key]]] : []));
const outputDirectory = path.join(workerRoot, "generated");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(path.join(outputDirectory, "worker-config.json"), JSON.stringify(bundled), { encoding: "utf8", mode: 0o600 });
console.log(`Configurazione interna preparata (${Object.keys(bundled).length} valori, contenuto non stampato).`);
