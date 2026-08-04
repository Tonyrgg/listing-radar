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

const bucket = "property-worker-updates";
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: signedManifest, error: signedManifestError } = await supabase.storage
  .from(bucket)
  .createSignedUrl("latest.json", 60);
if (signedManifestError || !signedManifest?.signedUrl) {
  throw new Error(`Manifest non raggiungibile: ${signedManifestError?.message ?? "URL non disponibile"}`);
}
const manifestResponse = await fetch(`${signedManifest.signedUrl}&verification=${Date.now()}`, { cache: "no-store" });
if (!manifestResponse.ok) throw new Error(`Manifest non raggiungibile: HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
if (manifest.version !== packageData.version) {
  throw new Error(`Versione pubblicata ${manifest.version ?? "sconosciuta"}, attesa ${packageData.version}.`);
}
if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
  throw new Error("Il manifest non contiene parti dell'installer.");
}

const installerHash = createHash("sha256");
let totalSize = 0;
for (const chunk of manifest.chunks) {
  const { data, error } = await supabase.storage.from(bucket).download(chunk.path);
  if (error) throw new Error(`Parte ${chunk.path} non raggiungibile: ${error.message}`);
  const body = Buffer.from(await data.arrayBuffer());
  const chunkHash = createHash("sha256").update(body).digest("hex");
  if (body.length !== chunk.size || chunkHash !== chunk.sha256) {
    throw new Error(`La parte ${chunk.path} non supera il controllo di integrita.`);
  }
  totalSize += body.length;
  installerHash.update(body);
}

if (totalSize !== manifest.size || installerHash.digest("hex") !== manifest.sha256) {
  throw new Error("L'installer ricomposto non supera il controllo di integrita.");
}
console.log(`Verifica binaria completa superata: versione ${manifest.version}, ${manifest.chunks.length} parti, ${totalSize} byte.`);
