import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export type UpdateStatus = "unavailable" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "up_to_date" | "error";

export interface DesktopUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  transferred: number | null;
  total: number | null;
  message: string;
  checkedAt: string | null;
}

export const WORKER_RELEASE_REPOSITORY = "Tonyrgg/listing-radar";
export const WORKER_RELEASE_API_URL = `https://api.github.com/repos/${WORKER_RELEASE_REPOSITORY}/releases/latest`;
export const WORKER_UPDATE_MANIFEST_ASSET = "property-worker-manifest.json";

const updateManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fileName: z.string().min(1).refine((value) => path.basename(value) === value, "Nome installer non valido"),
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

export type UpdateManifest = z.infer<typeof updateManifestSchema>;
type ReleaseAsset = z.infer<typeof releaseSchema>["assets"][number];

interface DesktopUpdaterOptions {
  currentVersion: string;
  packaged: boolean;
  updateDirectory: string;
  isWorkerActive: () => boolean;
  quitApp: () => void;
  onState: (state: DesktopUpdateState) => void;
  releaseApiUrl?: string;
  fetchImpl?: typeof fetch;
  operationTimeoutMs?: number;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 20_000;
const RELEASE_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Listing-Radar-Property-Worker",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: tempo massimo superato`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function hasExpectedIntegrity(buffer: Buffer, size: number, sha256: string) {
  return buffer.length === size && createHash("sha256").update(buffer).digest("hex") === sha256;
}

async function readVerifiedFile(filePath: string, size: number, sha256: string) {
  try {
    const buffer = await readFile(filePath);
    return hasExpectedIntegrity(buffer, size, sha256) ? buffer : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertTrustedAssetUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const expectedPrefix = `/${WORKER_RELEASE_REPOSITORY}/releases/download/`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error("La release contiene un indirizzo di download non autorizzato");
  }
  return url.toString();
}

export function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export class DesktopUpdater {
  private state: DesktopUpdateState;
  private manifest: UpdateManifest | null = null;
  private assetsByName = new Map<string, ReleaseAsset>();
  private installerPath: string | null = null;
  private cancellationRequested = false;
  private activeDownloadController: AbortController | null = null;
  private checkPromise: Promise<DesktopUpdateState> | null = null;
  private downloadPromise: Promise<DesktopUpdateState> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DesktopUpdaterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.state = {
      status: options.packaged ? "idle" : "unavailable",
      currentVersion: options.currentVersion,
      availableVersion: null,
      percent: null,
      transferred: null,
      total: null,
      message: options.packaged ? "Controllo aggiornamenti disponibile" : "Disponibile soltanto nell'app installata",
      checkedAt: null,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  async check() {
    if (!this.options.packaged) return this.snapshot();
    if (this.checkPromise) return this.checkPromise;
    const timeoutMs = this.options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.checkPromise = (async () => {
      this.setState({ status: "checking", message: "Controllo se è disponibile una nuova versione", percent: null });
      try {
        const releaseResponse = await withTimeout(
          this.fetchImpl(this.options.releaseApiUrl ?? WORKER_RELEASE_API_URL, {
            cache: "no-store",
            headers: RELEASE_HEADERS,
          }),
          timeoutMs,
          "Controllo aggiornamenti",
        );
        if (!releaseResponse.ok) throw new Error(`GitHub ha risposto HTTP ${releaseResponse.status}`);
        const release = releaseSchema.parse(await withTimeout(releaseResponse.json(), timeoutMs, "Lettura release"));
        const manifestAsset = release.assets.find((asset) => asset.name === WORKER_UPDATE_MANIFEST_ASSET);
        if (!manifestAsset) throw new Error("La release più recente non contiene il manifest del worker");
        const manifestResponse = await withTimeout(
          this.fetchImpl(assertTrustedAssetUrl(manifestAsset.browser_download_url), { cache: "no-store" }),
          timeoutMs,
          "Download manifest aggiornamento",
        );
        if (!manifestResponse.ok) throw new Error(`Manifest non raggiungibile: HTTP ${manifestResponse.status}`);
        const manifest = updateManifestSchema.parse(JSON.parse(await withTimeout(manifestResponse.text(), timeoutMs, "Lettura manifest")));
        if (release.tag_name !== `property-worker-v${manifest.version}`) throw new Error("Versione e tag della release non coincidono");
        const assetsByName = new Map<string, ReleaseAsset>();
        for (const asset of release.assets) {
          if (assetsByName.has(asset.name)) throw new Error(`Asset release duplicato: ${asset.name}`);
          assetsByName.set(asset.name, asset);
        }
        const chunkNames = new Set<string>();
        let chunkTotalSize = 0;
        for (const chunk of manifest.chunks) {
          if (chunkNames.has(chunk.name)) throw new Error(`Parte duplicata nel manifest: ${chunk.name}`);
          chunkNames.add(chunk.name);
          chunkTotalSize += chunk.size;
        }
        if (chunkTotalSize !== manifest.size) throw new Error("La somma delle parti non coincide con la dimensione dell'installer");
        const expectedAssets = [
          { name: manifest.installerAsset, size: manifest.size },
          ...manifest.chunks.map((chunk) => ({ name: chunk.name, size: chunk.size })),
        ];
        for (const expected of expectedAssets) {
          const asset = assetsByName.get(expected.name);
          if (!asset || asset.size !== expected.size) throw new Error(`Asset release mancante o incompleto: ${expected.name}`);
          assertTrustedAssetUrl(asset.browser_download_url);
        }
        this.manifest = manifest;
        this.assetsByName = assetsByName;
        if (compareVersions(manifest.version, this.options.currentVersion) <= 0) {
          this.setState({ status: "up_to_date", availableVersion: null, message: "Il programma è aggiornato", checkedAt: new Date().toISOString(), percent: null });
        } else {
          this.setState({ status: "available", availableVersion: manifest.version, message: `Versione ${manifest.version} disponibile`, checkedAt: new Date().toISOString(), percent: null });
        }
      } catch (error) {
        this.fail(error, "Non riesco a controllare gli aggiornamenti");
      }
      return this.snapshot();
    })().finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  async download() {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = this.performDownload().finally(() => {
      this.downloadPromise = null;
    });
    return this.downloadPromise;
  }

  private async performDownload() {
    if (!this.options.packaged) throw new Error("Gli aggiornamenti sono disponibili soltanto nell'app installata");
    if (this.options.isWorkerActive()) throw new Error("Termina o metti in pausa la lavorazione prima di scaricare l'aggiornamento");
    if (this.state.status !== "available" || !this.manifest) throw new Error("Non c'è un aggiornamento pronto da scaricare");
    this.cancellationRequested = false;
    const versionDirectory = path.join(this.options.updateDirectory, this.manifest.version);
    await mkdir(versionDirectory, { recursive: true });
    this.installerPath = path.join(versionDirectory, this.manifest.fileName);
    const cachedInstaller = await readVerifiedFile(this.installerPath, this.manifest.size, this.manifest.sha256);
    if (cachedInstaller) {
      this.setState({
        status: "downloaded", availableVersion: this.manifest.version, percent: 100,
        transferred: cachedInstaller.length, total: cachedInstaller.length,
        message: "Aggiornamento già scaricato e pronto per l'installazione",
      });
      return this.snapshot();
    }
    await rm(this.installerPath, { force: true });
    const installer = await open(this.installerPath, "w");
    let transferred = 0;
    this.setState({ status: "downloading", message: "Scaricamento dell'aggiornamento", percent: 0, transferred: 0, total: this.manifest.size });
    try {
      for (const chunk of this.manifest.chunks) {
        if (this.cancellationRequested) throw new Error("DOWNLOAD_CANCELLED");
        const chunkFilePath = path.join(versionDirectory, chunk.name);
        let buffer = await readVerifiedFile(chunkFilePath, chunk.size, chunk.sha256);
        if (!buffer) {
          const asset = this.assetsByName.get(chunk.name);
          if (!asset) throw new Error(`Parte release non trovata: ${chunk.name}`);
          buffer = await this.downloadAsset(asset.browser_download_url, chunk.name);
          if (this.cancellationRequested) throw new Error("DOWNLOAD_CANCELLED");
          if (!hasExpectedIntegrity(buffer, chunk.size, chunk.sha256)) throw new Error(`Verifica fallita per ${chunk.name}`);
          await writeFile(chunkFilePath, buffer);
        }
        await installer.write(buffer);
        transferred += buffer.length;
        const percent = (transferred / this.manifest.size) * 100;
        this.setState({ status: "downloading", percent, transferred, total: this.manifest.size, message: `Scaricamento ${Math.round(percent)}%` });
      }
    } catch (error) {
      await installer.close();
      await rm(this.installerPath, { force: true });
      if (this.cancellationRequested) {
        this.cancellationRequested = false;
        this.setState({
          status: "available", percent: null, transferred: null, total: null,
          message: "Download interrotto dall'operatore; l'aggiornamento resta disponibile",
        });
        return this.snapshot();
      }
      this.fail(error, "Il download dell'aggiornamento non è riuscito");
      return this.snapshot();
    }
    await installer.close();
    const complete = await readVerifiedFile(this.installerPath, this.manifest.size, this.manifest.sha256);
    if (!complete) {
      await rm(this.installerPath, { force: true });
      this.fail(new Error("La firma SHA-256 dell'installer non coincide"), "Aggiornamento non valido");
      return this.snapshot();
    }
    this.setState({ status: "downloaded", availableVersion: this.manifest.version, percent: 100, transferred: complete.length, total: complete.length, message: "Aggiornamento verificato e pronto per l'installazione" });
    return this.snapshot();
  }

  private async downloadAsset(rawUrl: string, label: string) {
    const controller = new AbortController();
    const timeoutMs = this.options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(new Error(`${label}: tempo massimo superato`)), timeoutMs);
    timer.unref?.();
    this.activeDownloadController = controller;
    try {
      const response = await this.fetchImpl(assertTrustedAssetUrl(rawUrl), {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${label}: GitHub ha risposto HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (!this.cancellationRequested && controller.signal.aborted) {
        const reason = controller.signal.reason;
        throw reason instanceof Error ? reason : new Error(`${label}: download interrotto`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.activeDownloadController === controller) this.activeDownloadController = null;
    }
  }

  cancelDownload() {
    if (this.state.status !== "downloading") return false;
    this.cancellationRequested = true;
    this.activeDownloadController?.abort();
    this.setState({ message: "Interruzione del download richiesta" });
    return true;
  }

  install() {
    if (!this.installerPath || this.state.status !== "downloaded") throw new Error("L'aggiornamento non è ancora stato scaricato");
    if (this.options.isWorkerActive()) throw new Error("Termina o metti in pausa la lavorazione prima di installare l'aggiornamento");
    this.setState({ message: "Riavvio e installazione in corso" });
    const child = spawn(this.installerPath, ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    setTimeout(() => this.options.quitApp(), 500);
    return true;
  }

  private fail(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : String(error);
    this.setState({ status: "error", message: `${fallback}: ${detail}` });
  }

  private setState(values: Partial<DesktopUpdateState>) {
    this.state = { ...this.state, ...values };
    this.options.onState(this.snapshot());
  }
}
