import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

if (!process.env.APPDATA) throw new Error("Configurazione di prova disponibile su Windows");
const directory = path.join(process.env.APPDATA, "ListingRadarTerritoryLab-live");
await mkdir(directory, { recursive: true });
const filename = path.join(directory, "live-config.json");
const config = { cdpUrl: "http://127.0.0.1:9223", sisterTabMatch: "sister", crmTabMatch: "tecnocasa-group.my.site.com", allowedCadastralKeys: [], allowedTaxCodes: [], allowCreate: false };
try {
  await writeFile(filename, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Profilo di prova creato, scritture disabilitate: ${filename}`);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(`Configurazione esistente conservata: ${filename}`);
}
