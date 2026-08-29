import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readLatestRelease } from "./worker-release-channel.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
const { manifest, assetsByName } = await readLatestRelease();
if (manifest.version !== packageData.version) {
  throw new Error(`Versione pubblicata ${manifest.version}, attesa ${packageData.version}.`);
}

const installerHash = createHash("sha256");
let totalSize = 0;
for (const chunk of manifest.chunks) {
  const asset = assetsByName.get(chunk.name);
  const response = await fetch(asset.browser_download_url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Parte ${chunk.name} non raggiungibile: HTTP ${response.status}.`);
  const body = Buffer.from(await response.arrayBuffer());
  const chunkHash = createHash("sha256").update(body).digest("hex");
  if (body.length !== chunk.size || chunkHash !== chunk.sha256) {
    throw new Error(`La parte ${chunk.name} non supera il controllo di integrita.`);
  }
  totalSize += body.length;
  installerHash.update(body);
}
if (totalSize !== manifest.size || installerHash.digest("hex") !== manifest.sha256) {
  throw new Error("L'installer ricomposto non supera il controllo di integrita.");
}
console.log(`Verifica binaria GitHub superata: versione ${manifest.version}, ${manifest.chunks.length} parti, ${totalSize} byte.`);
