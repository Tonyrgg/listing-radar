const repository = "Tonyrgg/listing-radar";
const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const manifestAssetName = "property-worker-manifest.json";
const sha256Pattern = /^[a-f0-9]{64}$/i;
const safeInstallerPattern = /^[a-zA-Z0-9._-]+\.exe$/;
const safeChunkPattern = /^[a-zA-Z0-9._-]+\.bin$/;

function trustedAssetUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(`/${repository}/releases/download/`)) {
    throw new Error("La release contiene un indirizzo non autorizzato.");
  }
  return url.toString();
}

function requireAsset(assetsByName, name, size) {
  const asset = assetsByName.get(name);
  if (!asset || asset.size !== size) throw new Error(`Asset GitHub mancante o incompleto: ${name}.`);
  trustedAssetUrl(asset.browser_download_url);
  return asset;
}

export async function readLatestRelease() {
  const releaseResponse = await fetch(releaseApiUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Listing-Radar-Release-Verifier",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!releaseResponse.ok) throw new Error(`Canale GitHub non raggiungibile: HTTP ${releaseResponse.status}.`);
  const release = await releaseResponse.json();
  if (!release || typeof release !== "object" || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) {
    throw new Error("Risposta release GitHub non valida.");
  }
  const assetsByName = new Map();
  for (const rawAsset of release.assets) {
    if (!rawAsset || typeof rawAsset.name !== "string" || !Number.isInteger(rawAsset.size) || typeof rawAsset.browser_download_url !== "string") {
      throw new Error("Metadati asset GitHub non validi.");
    }
    if (assetsByName.has(rawAsset.name)) throw new Error(`Asset GitHub duplicato: ${rawAsset.name}.`);
    assetsByName.set(rawAsset.name, rawAsset);
  }

  const manifestAsset = assetsByName.get(manifestAssetName);
  if (!manifestAsset) throw new Error("La release piu recente non contiene il manifest del worker.");
  const manifestResponse = await fetch(trustedAssetUrl(manifestAsset.browser_download_url), { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Manifest non raggiungibile: HTTP ${manifestResponse.status}.`);
  const manifest = await manifestResponse.json();
  if (
    !manifest || typeof manifest !== "object"
    || !/^\d+\.\d+\.\d+$/.test(manifest.version)
    || typeof manifest.fileName !== "string" || pathBasename(manifest.fileName) !== manifest.fileName
    || typeof manifest.installerAsset !== "string" || !safeInstallerPattern.test(manifest.installerAsset)
    || !Number.isInteger(manifest.size) || manifest.size <= 0
    || typeof manifest.sha256 !== "string" || !sha256Pattern.test(manifest.sha256)
    || typeof manifest.releaseDate !== "string" || !Number.isFinite(Date.parse(manifest.releaseDate))
    || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0
  ) {
    throw new Error("Manifest worker non valido.");
  }
  if (release.tag_name !== `property-worker-v${manifest.version}`) throw new Error("Versione e tag della release non coincidono.");

  requireAsset(assetsByName, manifest.installerAsset, manifest.size);
  const seenChunks = new Set();
  let totalSize = 0;
  for (const chunk of manifest.chunks) {
    if (
      !chunk || typeof chunk.name !== "string" || !safeChunkPattern.test(chunk.name)
      || !Number.isInteger(chunk.size) || chunk.size <= 0
      || typeof chunk.sha256 !== "string" || !sha256Pattern.test(chunk.sha256)
      || seenChunks.has(chunk.name)
    ) {
      throw new Error(`Parte non valida nel manifest: ${chunk?.name ?? "nome mancante"}.`);
    }
    seenChunks.add(chunk.name);
    totalSize += chunk.size;
    requireAsset(assetsByName, chunk.name, chunk.size);
  }
  if (totalSize !== manifest.size) throw new Error("La somma delle parti non coincide con la dimensione dell'installer.");
  return { release, manifest, assetsByName };
}

function pathBasename(value) {
  return value.replace(/^.*[\\/]/, "");
}
