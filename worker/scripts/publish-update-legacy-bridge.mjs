import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { readLatestRelease } from "./worker-release-channel.mjs";

if (!process.argv.includes("--confirm-one-time-bridge")) {
  throw new Error(
    "Comando bloccato: questo ponte consuma Storage Egress ed e previsto una sola volta. "
    + "Aggiungi --confirm-one-time-bridge soltanto dopo avere pubblicato la stessa versione su GitHub.",
  );
}

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
const version = packageData.version;
const { manifest: githubManifest } = await readLatestRelease();
if (githubManifest.version !== version) {
  throw new Error(`Il ponte e bloccato: GitHub espone ${githubManifest.version}, il pacchetto locale e ${version}.`);
}

const environment = {};
for (const source of [path.resolve(workerRoot, "..", ".env.local"), path.resolve(workerRoot, ".env")]) {
  if (existsSync(source)) Object.assign(environment, dotenv.parse(await readFile(source)));
}
const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Credenziali Supabase mancanti nei file di ambiente locali.");

const bucket = "property-worker-updates";
const installerName = `Property Data Worker Setup ${version}.exe`;
const installer = await readFile(path.join(workerRoot, "release", installerName));
const chunkSize = 32 * 1024 * 1024;
const chunks = [];
for (let offset = 0, index = 0; offset < installer.length; offset += chunkSize, index += 1) {
  const body = installer.subarray(offset, Math.min(offset + chunkSize, installer.length));
  const chunkPath = `releases/${version}/part-${String(index).padStart(3, "0")}.bin`;
  chunks.push({
    path: chunkPath,
    body,
    size: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}
const manifest = {
  version,
  fileName: installerName,
  installerAsset: githubManifest.installerAsset,
  size: installer.length,
  sha256: createHash("sha256").update(installer).digest("hex"),
  releaseDate: githubManifest.releaseDate,
  chunks: chunks.map((chunk) => ({
    name: path.posix.basename(chunk.path),
    path: chunk.path,
    size: chunk.size,
    sha256: chunk.sha256,
  })),
};
if (manifest.size !== githubManifest.size || manifest.sha256 !== githubManifest.sha256) {
  throw new Error("L'installer locale non coincide con quello gia pubblicato su GitHub.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
if (bucketsError) throw new Error(`Impossibile leggere i bucket: ${bucketsError.message}`);
if (!buckets.some((item) => item.id === bucket)) throw new Error(`Bucket legacy ${bucket} non trovato.`);

for (const chunk of chunks) {
  const { error } = await supabase.storage.from(bucket).upload(chunk.path, chunk.body, {
    upsert: true,
    contentType: "application/octet-stream",
    cacheControl: "31536000",
  });
  if (error) throw new Error(`Upload ${chunk.path} fallito: ${error.message}`);
}
const manifestBody = Buffer.from(JSON.stringify(manifest));
for (const manifestPath of [`releases/${version}/manifest.json`, "latest.json"]) {
  const { error } = await supabase.storage.from(bucket).upload(manifestPath, manifestBody, {
    upsert: true,
    contentType: "application/json",
    cacheControl: manifestPath === "latest.json" ? "0" : "31536000",
  });
  if (error) throw new Error(`Upload ${manifestPath} fallito: ${error.message}`);
}

console.log(
  `Ponte legacy pubblicato per ${version}. Non usare piu questo comando: le versioni successive passano soltanto da GitHub.`,
);
