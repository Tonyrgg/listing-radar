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

/* Le release GitHub sono pubbliche: nel pacchetto entrano soltanto valori non
 * sensibili. Le credenziali e i percorsi personali restano nelle preferenze
 * cifrate di Windows e sopravvivono agli aggiornamenti. */
const bundled = {
  ...(environment.NEXT_PUBLIC_SUPABASE_URL ? { NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL } : {}),
  CHROME_CDP_URL: environment.CHROME_CDP_URL || "http://127.0.0.1:9222",
  ERROR_SCREENSHOT_DIR: "C:\\ListingRadar\\worker-errors",
  ERROR_SCREENSHOT_RETENTION_DAYS: environment.ERROR_SCREENSHOT_RETENTION_DAYS || "14",
  SISTER_TAB_MATCH: environment.SISTER_TAB_MATCH || "sister",
  CRM_TAB_MATCH: environment.CRM_TAB_MATCH || "CRMImmobiliareLightning",
  SISTER_KEEPALIVE_ENABLED: environment.SISTER_KEEPALIVE_ENABLED || "true",
  SISTER_KEEPALIVE_MIN_SECONDS: environment.SISTER_KEEPALIVE_MIN_SECONDS || "60",
  SISTER_KEEPALIVE_MAX_SECONDS: environment.SISTER_KEEPALIVE_MAX_SECONDS || "90",
};
const outputDirectory = path.join(workerRoot, "generated");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(path.join(outputDirectory, "worker-config.json"), JSON.stringify(bundled), { encoding: "utf8", mode: 0o600 });
console.log(`Configurazione pubblicabile preparata (${Object.keys(bundled).length} valori non sensibili).`);
