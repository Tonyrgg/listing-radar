import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

const updateManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fileName: z.string().min(1).refine((value) => path.basename(value) === value, "Nome installer non valido"),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  releaseDate: z.string(),
  chunks: z.array(z.object({
    path: z.string().regex(/^releases\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })).min(1),
});

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

interface DesktopUpdaterOptions {
  currentVersion: string;
  packaged: boolean;
  supabaseUrl: string;
  serviceRoleKey: string;
  updateDirectory: string;
  isWorkerActive: () => boolean;
  quitApp: () => void;
  onState: (state: DesktopUpdateState) => void;
  storageClient?: Pick<SupabaseClient, "storage">;
  operationTimeoutMs?: number;
}

const DEFAULT_OPERATION_TIMEOUT_MS = 20_000;

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
  private readonly storage: Pick<SupabaseClient, "storage"> | null;
  private state: DesktopUpdateState;
  private manifest: UpdateManifest | null = null;
  private installerPath: string | null = null;
  private cancellationRequested = false;
  private checkPromise: Promise<DesktopUpdateState> | null = null;
  private downloadPromise: Promise<DesktopUpdateState> | null = null;

  constructor(private readonly options: DesktopUpdaterOptions) {
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
    this.storage = options.packaged
      ? options.storageClient ?? createClient(options.supabaseUrl, options.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  }

  snapshot() {
    return { ...this.state };
  }

  async check() {
    if (!this.storage) return this.snapshot();
    if (this.checkPromise) return this.checkPromise;
    const timeoutMs = this.options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.checkPromise = (async () => {
      this.setState({ status: "checking", message: "Controllo se è disponibile una nuova versione", percent: null });
      try {
        const response = await withTimeout(
          this.storage!.storage.from("property-worker-updates").download("latest.json", {}, { cache: "no-store" }),
          timeoutMs,
          "Controllo aggiornamenti",
        );
        const { data, error } = response;
        if (error) throw error;
        this.manifest = updateManifestSchema.parse(JSON.parse(await data.text()));
        if (compareVersions(this.manifest.version, this.options.currentVersion) <= 0) {
          this.setState({ status: "up_to_date", availableVersion: null, message: "Il programma è aggiornato", checkedAt: new Date().toISOString(), percent: null });
        } else {
          this.setState({ status: "available", availableVersion: this.manifest.version, message: `Versione ${this.manifest.version} disponibile`, checkedAt: new Date().toISOString(), percent: null });
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
    if (!this.storage) throw new Error("Gli aggiornamenti sono disponibili soltanto nell'app installata");
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
        message: "Aggiornamento gi\u00e0 scaricato e pronto per l'installazione",
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
        const chunkFilePath = path.join(versionDirectory, path.basename(chunk.path));
        let buffer = await readVerifiedFile(chunkFilePath, chunk.size, chunk.sha256);
        if (!buffer) {
          const { data, error } = await withTimeout(
            this.storage.storage.from("property-worker-updates").download(chunk.path),
            this.options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
            `Download ${path.basename(chunk.path)}`,
          );
          if (error) throw error;
          if (this.cancellationRequested) throw new Error("DOWNLOAD_CANCELLED");
          buffer = Buffer.from(await data.arrayBuffer());
          if (!hasExpectedIntegrity(buffer, chunk.size, chunk.sha256)) {
            throw new Error(`Verifica fallita per ${path.basename(chunk.path)}`);
          }
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

  cancelDownload() {
    if (this.state.status !== "downloading") return false;
    this.cancellationRequested = true;
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
    this.setState({ status: "error", message: `${fallback}: ${detail.replace(this.options.serviceRoleKey, "[chiave protetta]")}` });
  }

  private setState(values: Partial<DesktopUpdateState>) {
    this.state = { ...this.state, ...values };
    this.options.onState(this.snapshot());
  }
}
