import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
const bundledConfig = JSON.parse(await readFile(path.join(workerRoot, "generated", "worker-config.json"), "utf8"));
const supabaseUrl = bundledConfig.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = bundledConfig.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Configurazione Supabase mancante. Esegui prima desktop:prepare-config.");

const version = packageData.version;
const bucket = "property-worker-updates";
const retainedReleaseCount = 1;
const installerName = `Property Data Worker Setup ${version}.exe`;
const installer = await readFile(path.join(workerRoot, "release", installerName));
const chunkSize = 32 * 1024 * 1024;
const chunks = [];
for (let offset = 0, index = 0; offset < installer.length; offset += chunkSize, index += 1) {
  const body = installer.subarray(offset, Math.min(offset + chunkSize, installer.length));
  chunks.push({
    path: `releases/${version}/part-${String(index).padStart(3, "0")}.bin`,
    body,
    size: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}
const manifest = {
  version,
  fileName: installerName,
  size: installer.length,
  sha256: createHash("sha256").update(installer).digest("hex"),
  releaseDate: new Date().toISOString(),
  chunks: chunks.map(({ path: chunkPath, size, sha256 }) => ({ path: chunkPath, size, sha256 })),
};

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
if (bucketsError) throw new Error(`Impossibile leggere i bucket: ${bucketsError.message}`);
const bucketOptions = {
  public: false,
  fileSizeLimit: "48MB",
  allowedMimeTypes: ["application/octet-stream", "application/json"],
};
if (!buckets.some((item) => item.id === bucket)) {
  const { error } = await supabase.storage.createBucket(bucket, bucketOptions);
  if (error) throw new Error(`Creazione bucket aggiornamenti fallita: ${error.message}`);
} else {
  const { error } = await supabase.storage.updateBucket(bucket, bucketOptions);
  if (error) throw new Error(`Configurazione bucket aggiornamenti fallita: ${error.message}`);
}

for (const chunk of chunks) {
  const { error } = await supabase.storage.from(bucket).upload(chunk.path, chunk.body, {
    upsert: true, contentType: "application/octet-stream", cacheControl: "31536000",
  });
  if (error) throw new Error(`Upload ${chunk.path} fallito: ${error.message}`);
  console.log(`Pubblicata parte ${path.basename(chunk.path)} (${chunk.size} byte).`);
}
const manifestBody = Buffer.from(JSON.stringify(manifest));
const versionManifestPath = `releases/${version}/manifest.json`;
const { error: versionManifestUploadError } = await supabase.storage.from(bucket).upload(versionManifestPath, manifestBody, {
  upsert: true, contentType: "application/json", cacheControl: "31536000",
});
if (versionManifestUploadError) throw new Error(`Upload manifest versione fallito: ${versionManifestUploadError.message}`);
const { data: publishedManifest, error: manifestError } = await supabase.storage.from(bucket).download(versionManifestPath);
if (manifestError) throw new Error(`Verifica manifest versione fallita: ${manifestError.message}`);
const verified = JSON.parse(await publishedManifest.text());
if (verified.version !== version || verified.sha256 !== manifest.sha256) throw new Error("Il manifest della versione non coincide con l'installer");

const { error: manifestUploadError } = await supabase.storage.from(bucket).upload("latest.json", manifestBody, {
  upsert: true, contentType: "application/json", cacheControl: "0",
});
if (manifestUploadError) throw new Error(`Upload manifest fallito: ${manifestUploadError.message}`);
console.log(`Canale aggiornamenti aggiornato alla versione ${version} (${chunks.length} parti verificate).`);

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

async function listReleaseFiles(prefix) {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Lettura ${prefix} fallita: ${error.message}`);
    for (const item of data ?? []) {
      const itemPath = `${prefix}/${item.name}`;
      if (item.id == null) files.push(...await listReleaseFiles(itemPath));
      else files.push(itemPath);
    }
    if (!data || data.length < 1000) break;
  }
  return files;
}

async function pruneOldReleases() {
  const { data, error } = await supabase.storage.from(bucket).list("releases", {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`Lettura release pubblicate fallita: ${error.message}`);

  const releaseVersions = (data ?? [])
    .filter((item) => item.id == null && parseVersion(item.name))
    .map((item) => item.name)
    .sort(compareVersions)
    .reverse();
  const versionsToKeep = new Set([
    version,
    ...releaseVersions.filter((item) => item !== version),
  ].slice(0, retainedReleaseCount));
  const versionsToDelete = releaseVersions.filter((item) => !versionsToKeep.has(item));

  const obsoleteFiles = [];
  for (const obsoleteVersion of versionsToDelete) {
    obsoleteFiles.push(...await listReleaseFiles(`releases/${obsoleteVersion}`));
  }
  for (let index = 0; index < obsoleteFiles.length; index += 1000) {
    const batch = obsoleteFiles.slice(index, index + 1000);
    const { error: removeError } = await supabase.storage.from(bucket).remove(batch);
    if (removeError) throw new Error(`Pulizia release obsolete fallita: ${removeError.message}`);
  }

  console.log(
    versionsToDelete.length
      ? `Pulizia completata: rimosse ${versionsToDelete.join(", ")}; conservate ${[...versionsToKeep].join(", ")}.`
      : `Nessuna release obsoleta: conservate ${[...versionsToKeep].join(", ")}.`,
  );
}

await pruneOldReleases();
