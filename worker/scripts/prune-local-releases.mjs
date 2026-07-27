import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(workerRoot, "release");
const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
const currentVersion = packageData.version;
const versionPattern = /(?:^|[^0-9])(\d+\.\d+\.\d+)(?:[^0-9]|$)/;

const entries = await readdir(releaseRoot, { withFileTypes: true });
const obsoleteFiles = entries.filter((entry) => {
  if (!entry.isFile()) return false;
  const version = versionPattern.exec(entry.name)?.[1];
  return Boolean(version && version !== currentVersion);
});

const latestMetadata = entries.find((entry) => entry.isFile() && entry.name === "latest.yml");
if (latestMetadata) {
  const metadataPath = path.join(releaseRoot, latestMetadata.name);
  const metadata = await readFile(metadataPath, "utf8");
  const metadataVersion = /^version:\s*([^\s]+)\s*$/m.exec(metadata)?.[1];
  if (metadataVersion && metadataVersion !== currentVersion) {
    obsoleteFiles.push(latestMetadata);
  }
}

for (const entry of obsoleteFiles) {
  await rm(path.join(releaseRoot, entry.name), { force: true });
}

console.log(
  obsoleteFiles.length
    ? `Rimosse ${obsoleteFiles.length} pubblicazioni locali precedenti; conservata soltanto la ${currentVersion}.`
    : `Nessuna pubblicazione locale precedente; conservata soltanto la ${currentVersion}.`,
);
