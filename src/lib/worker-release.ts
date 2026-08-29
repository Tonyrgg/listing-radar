import { z } from "zod";

export const WORKER_RELEASE_REPOSITORY = "Tonyrgg/listing-radar";
export const WORKER_RELEASE_API_URL = `https://api.github.com/repos/${WORKER_RELEASE_REPOSITORY}/releases/latest`;
export const WORKER_UPDATE_MANIFEST_ASSET = "property-worker-manifest.json";

const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fileName: z.string().min(1).refine((value) => !/[\\/]/.test(value), "Nome installer non valido"),
  installerAsset: z.string().regex(/^[a-zA-Z0-9._-]+\.exe$/),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  releaseDate: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Data release non valida"),
  chunks: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z0-9._-]+\.bin$/),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })).min(1),
});

const releaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({
    name: z.string(),
    size: z.number().int().nonnegative(),
    browser_download_url: z.string().url(),
  })),
});

export type WorkerUpdateManifest = z.infer<typeof manifestSchema>;

export type PublishedWorkerRelease = {
  version: string;
  releaseDate: string;
  size: number;
  sha256: string;
  downloadUrl: string;
};

const requestHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Listing-Radar-Web",
  "X-GitHub-Api-Version": "2022-11-28",
};

function trustedAssetUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const expectedPrefix = `/${WORKER_RELEASE_REPOSITORY}/releases/download/`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error("La release del worker contiene un indirizzo non autorizzato");
  }
  return url.toString();
}

export async function getLatestWorkerRelease(fetchImpl: typeof fetch = fetch): Promise<PublishedWorkerRelease> {
  const releaseResponse = await fetchImpl(WORKER_RELEASE_API_URL, {
    headers: requestHeaders,
    next: { revalidate: 300 },
  });
  if (!releaseResponse.ok) throw new Error(`Canale release non raggiungibile: HTTP ${releaseResponse.status}`);
  const release = releaseSchema.parse(await releaseResponse.json());
  const manifestAsset = release.assets.find((asset) => asset.name === WORKER_UPDATE_MANIFEST_ASSET);
  if (!manifestAsset) throw new Error("La release più recente non contiene il manifest del worker");

  const manifestResponse = await fetchImpl(trustedAssetUrl(manifestAsset.browser_download_url), {
    next: { revalidate: 300 },
  });
  if (!manifestResponse.ok) throw new Error(`Manifest release non raggiungibile: HTTP ${manifestResponse.status}`);
  const manifest = manifestSchema.parse(await manifestResponse.json());
  if (release.tag_name !== `property-worker-v${manifest.version}`) throw new Error("Versione e tag della release non coincidono");

  const assetsByName = new Map<string, (typeof release.assets)[number]>();
  for (const asset of release.assets) {
    if (assetsByName.has(asset.name)) throw new Error(`Asset della release duplicato: ${asset.name}`);
    assetsByName.set(asset.name, asset);
  }
  const installer = assetsByName.get(manifest.installerAsset);
  if (!installer || installer.size !== manifest.size) throw new Error("Installer della release mancante o incompleto");
  const downloadUrl = trustedAssetUrl(installer.browser_download_url);
  const chunkNames = new Set<string>();
  let chunkTotalSize = 0;
  for (const chunk of manifest.chunks) {
    if (chunkNames.has(chunk.name)) throw new Error(`Parte duplicata nel manifest: ${chunk.name}`);
    chunkNames.add(chunk.name);
    chunkTotalSize += chunk.size;
    const asset = assetsByName.get(chunk.name);
    if (!asset || asset.size !== chunk.size) throw new Error(`Parte release mancante o incompleta: ${chunk.name}`);
    trustedAssetUrl(asset.browser_download_url);
  }
  if (chunkTotalSize !== manifest.size) throw new Error("La somma delle parti non coincide con la dimensione dell'installer");

  return {
    version: manifest.version,
    releaseDate: manifest.releaseDate,
    size: manifest.size,
    sha256: manifest.sha256,
    downloadUrl,
  };
}
