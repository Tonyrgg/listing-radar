import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readLatestRelease } from "./worker-release-channel.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
const { manifest } = await readLatestRelease();

if (manifest.version !== packageData.version) {
  throw new Error(`Versione pubblicata ${manifest.version}, attesa ${packageData.version}.`);
}
console.log(`Canale GitHub verificato senza download binari: versione ${manifest.version}, ${manifest.chunks.length} parti, ${manifest.size} byte.`);
