import { existsSync, readFileSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import dotenv from "dotenv";
import { z } from "zod";

import { ExcelContactsAdapter, REQUIRED_CONTACT_COLUMNS } from "../adapters/excel/index.js";
import { PlaywrightCrmAdapter } from "../adapters/crm/index.js";
import { PlaywrightSisterAdapter } from "../adapters/sister/index.js";
import { loadConfig, type WorkerConfig } from "../config.js";
import { automaticRetryAttempts, buildAutomaticSkipImpact } from "../core/automatic-skip.js";
import { normalizeTaxCode } from "../core/normalize.js";
import { PropertyWorkerRunner, type RunnerEvent } from "../services/runner.js";
import { connectToChrome, isPresumablyAuthenticated } from "../services/chrome.js";
import { MandateArchiveImporter, type MandateArchiveImportEvent } from "../services/mandate-archive-importer.js";
import { RequestArchiveImporter, type RequestArchiveImportEvent } from "../services/request-archive-importer.js";
import { nextKeepAliveDelay, pingSisterSession, type SisterKeepAliveResult } from "../services/sister-keepalive.js";
import {
  SisterStreetRun,
  type SisterStreetRunCheckpoint,
  type SisterStreetRunProgress,
} from "../services/sister-street-run.js";
import { WorkerRepository } from "../services/repository.js";
import { removeDiagnosticScreenshots } from "../services/screenshots.js";
import type { PromptResponse } from "../services/prompts.js";
import type { WorkerMode } from "../types.js";
import { DesktopPromptController, type DesktopPrompt } from "./prompts.js";
import { DesktopUpdater, type DesktopUpdateState } from "./updater.js";

type Preferences = {
  environmentFilePath?: string;
  contactsExcelPath?: string;
  mode: WorkerMode;
  dryRun: boolean;
  autoRetryEnabled: boolean;
  encryptedEnvironment?: string;
};

type ActivityItem = { at: string; tone: "info" | "success" | "warning" | "error"; message: string };
type DiagnosticErrorItem = {
  id: string;
  at: string;
  source: "worker" | "street-run" | "request-archive" | "mandate-archive" | "desktop-ui";
  status: string;
  message: string;
  jobId: string | null;
  details: Record<string, unknown>;
};
type KeepAliveState = SisterKeepAliveResult & { nextAttemptAt: string | null; statusLabel: "waiting" | "active" | "expired" | "error" | "disabled" };

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(moduleDirectory, "../..");
const defaultPreferences: Preferences = { mode: "assisted", dryRun: true, autoRetryEnabled: true };
const editablePropertySchema = z.object({
  id: z.string().uuid(),
  sheet: z.string().trim().min(1),
  parcel: z.string().trim().min(1),
  subaltern: z.string().trim().min(1),
  address: z.string().trim().nullable().optional(),
  category: z.string().trim().min(1),
  class: z.string().trim().nullable().optional(),
  consistency: z.string().trim().nullable().optional(),
  cadastralIncome: z.number().nullable().optional(),
});
const editablePersonSchema = z.object({
  id: z.string().uuid(),
  ownershipId: z.string().uuid().optional(),
  fullName: z.string().trim().min(1),
  taxCode: z.string().trim().nullable().optional(),
  birthPlace: z.string().trim().nullable().optional(),
  birthProvince: z.string().trim().nullable().optional(),
  birthDate: z.string().trim().nullable().optional(),
  shareOriginal: z.string().trim().min(1),
  sharePercentage: z.number().min(0).max(100).nullable().optional(),
});
const manualCorrectionSchema = z.object({
  jobId: z.string().uuid(),
  properties: z.array(editablePropertySchema).default([]),
  people: z.array(editablePersonSchema).default([]),
});
const removeJobPropertySchema = z.object({
  jobId: z.string().uuid(),
  propertyId: z.string().uuid(),
});
const internalConfigurationSchema = z.object({
  supabaseUrl: z.string().url(),
  serviceRoleKey: z.string().min(20),
  contactsExcelPath: z.string().min(1),
  sisterTabMatch: z.string().min(1),
  crmTabMatch: z.string().min(1),
});
const uiActionSchema = z.object({
  action: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(160),
  status: z.enum(["started", "completed", "failed", "cancelled"]),
  detail: z.string().trim().max(500).nullable().optional(),
});

let mainWindow: BrowserWindow | null = null;
let preferences: Preferences = defaultPreferences;
let activePrompts: DesktopPromptController | null = null;
let activeJobId: string | null = null;
let active = false;
let activeRunPromise: Promise<void> | null = null;
let cancellingJobId: string | null = null;
let pausingJobId: string | null = null;
let prompt: DesktopPrompt | null = null;
let currentStep: string | null = null;
let propertyProgress: { propertyId: string; index: number; total: number; address: string | null; stage: string; message: string } | null = null;
let lastError: string | null = null;
let skippingPropertyId: string | null = null;
let autoRetryTimer: ReturnType<typeof setTimeout> | null = null;
let autoRetryAt: string | null = null;
let autoRetryJobId: string | null = null;
let autoRetryAttemptNumber: number | null = null;
let automaticRetryInFlight: { jobId: string; propertyId: string; attempt: number } | null = null;
let completedImportsLimit = 6;
let requestImportActive = false;
let requestImportCancellationRequested = false;
let requestImportError: string | null = null;
let requestImportProgress: { runId: string | null; index: number; total: number; title: string; externalId: string | null; failed: number; phase: "index" | "detail" } | null = null;
let mandateImportActive = false;
let mandateImportCancellationRequested = false;
let mandateImportError: string | null = null;
let mandateImportProgress: { runId: string | null; index: number; total: number; title: string; externalId: string | null; failed: number; phase: "index" | "detail" } | null = null;
let streetRunActive = false;
let streetRunCancellationRequested = false;
let streetRunCheckpoint: SisterStreetRunCheckpoint | null = null;
let streetRunError: string | null = null;
let streetRunProgress: SisterStreetRunProgress | null = null;
let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckTimer: ReturnType<typeof setTimeout> | null = null;
let desktopUpdater: DesktopUpdater | null = null;
let sisterKeepAlive: KeepAliveState = {
  ok: false,
  sessionExpired: false,
  status: null,
  checkedAt: "",
  nextAttemptAt: null,
  statusLabel: "waiting",
  message: "Primo controllo in attesa",
};
const activity: ActivityItem[] = [];
let activityLogWrite: Promise<void> = Promise.resolve();
let diagnosticErrors: DiagnosticErrorItem[] = [];

function pushActivity(message: string, tone: ActivityItem["tone"] = "info") {
  const entry = { at: new Date().toISOString(), tone, message } satisfies ActivityItem;
  activity.unshift(entry);
  activity.splice(300);
  activityLogWrite = activityLogWrite
    .then(async () => {
      await mkdir(path.dirname(operationLogPath()), { recursive: true });
      await appendFile(operationLogPath(), `${JSON.stringify(entry)}\n`, "utf8");
    })
    .catch(() => undefined);
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "desktop-preferences.json");
}

function streetRunCheckpointPath() {
  return path.join(app.getPath("userData"), "sister-street-run.json");
}

function diagnosticErrorsPath() {
  return path.join(app.getPath("userData"), "worker-errors.json");
}

function operationLogPath() {
  return path.join(app.getPath("userData"), "worker-operations.ndjson");
}

async function loadDiagnosticErrors() {
  try {
    const loaded = JSON.parse(await readFile(diagnosticErrorsPath(), "utf8"));
    diagnosticErrors = Array.isArray(loaded) ? loaded.slice(0, 200) as DiagnosticErrorItem[] : [];
  } catch {
    diagnosticErrors = [];
  }
}

function sanitizedDetails(value: unknown): Record<string, unknown> {
  const blocked = /token|secret|password|authorization|service.?role|api.?key/i;
  const sanitize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sanitize);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
      .filter(([key]) => !blocked.test(key))
      .map(([key, child]) => [key, sanitize(child)]));
  };
  return sanitize(value) as Record<string, unknown>;
}

async function recordDiagnosticError(values: Omit<DiagnosticErrorItem, "id" | "at">) {
  diagnosticErrors.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...values,
    details: sanitizedDetails(values.details),
  });
  diagnosticErrors = diagnosticErrors.slice(0, 200);
  await mkdir(path.dirname(diagnosticErrorsPath()), { recursive: true });
  await writeFile(diagnosticErrorsPath(), JSON.stringify(diagnosticErrors, null, 2), "utf8");
}

async function recordDiagnosticErrorSafely(
  values: Omit<DiagnosticErrorItem, "id" | "at">,
  options: { publish?: boolean } = {},
) {
  try {
    await recordDiagnosticError(values);
    if (options.publish) await publishState();
  } catch (error) {
    pushActivity(
      `Registro errori non aggiornato: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}

async function loadStreetRunCheckpoint() {
  try {
    streetRunCheckpoint = JSON.parse(await readFile(streetRunCheckpointPath(), "utf8")) as SisterStreetRunCheckpoint;
  } catch {
    streetRunCheckpoint = null;
  }
}

async function persistStreetRunCheckpoint(checkpoint: SisterStreetRunCheckpoint) {
  const target = streetRunCheckpointPath();
  const temporary = `${target}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, JSON.stringify(checkpoint, null, 2), "utf8");
  await rename(temporary, target);
  streetRunCheckpoint = checkpoint;
}

async function loadPreferences() {
  try {
    preferences = { ...defaultPreferences, ...JSON.parse(await readFile(preferencesPath(), "utf8")) as Preferences };
  } catch {
    preferences = defaultPreferences;
  }
  const developmentEnv = path.join(workerRoot, ".env");
  const workspaceEnv = path.join(homedir(), "listing-radar", "worker", ".env");
  if (!preferences.environmentFilePath) {
    preferences.environmentFilePath = [developmentEnv, workspaceEnv].find(existsSync);
  }
  if (!preferences.encryptedEnvironment) {
    const imported = readEnvironmentFiles(preferences.environmentFilePath);
    if (imported.SUPABASE_SERVICE_ROLE_KEY && safeStorage.isEncryptionAvailable()) {
      preferences.encryptedEnvironment = safeStorage.encryptString(JSON.stringify(imported)).toString("base64");
      await persistPreferences();
      pushActivity("Configurazione importata e protetta da Windows", "success");
    }
  }
}

async function persistPreferences() {
  await mkdir(path.dirname(preferencesPath()), { recursive: true });
  await writeFile(preferencesPath(), JSON.stringify(preferences, null, 2), "utf8");
}

function readEnvironmentFiles(environmentFilePath?: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (environmentFilePath && existsSync(environmentFilePath)) {
    const rootEnvironment = path.resolve(path.dirname(environmentFilePath), "..", ".env.local");
    if (existsSync(rootEnvironment)) Object.assign(values, dotenv.parse(readFileSync(rootEnvironment)));
    Object.assign(values, dotenv.parse(readFileSync(environmentFilePath)));
  }
  const bundledPath = app.isPackaged ? path.join(process.resourcesPath, "worker-config.json") : path.join(workerRoot, "generated", "worker-config.json");
  if (existsSync(bundledPath)) {
    try { Object.assign(values, JSON.parse(readFileSync(bundledPath, "utf8")) as Record<string, string>); } catch { /* Configurazione opzionale non valida. */ }
  }
  return values;
}

function internalEnvironment(): Record<string, string> {
  if (preferences.encryptedEnvironment && safeStorage.isEncryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(preferences.encryptedEnvironment, "base64"))) as Record<string, string>;
    } catch { /* Prova le origini di migrazione. */ }
  }
  return readEnvironmentFiles(preferences.environmentFilePath);
}

function workerConfig(overrides: Partial<Preferences> = {}): WorkerConfig {
  const merged = { ...preferences, ...overrides };
  const fileEnvironment = internalEnvironment();
  return loadConfig({
    ...process.env,
    ...fileEnvironment,
    ...(merged.contactsExcelPath ? { CONTACTS_EXCEL_PATH: merged.contactsExcelPath } : {}),
    WORKER_MODE: merged.mode,
    WORKER_DRY_RUN: String(merged.dryRun),
  });
}

function repository(config = workerConfig()) {
  return new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

async function purgeJob(jobId: string) {
  const config = workerConfig();
  const repo = repository(config);
  const screenshotPaths = await repo.listJobScreenshotPaths(jobId);
  await repo.deleteJob(jobId);
  const cleanup = await removeDiagnosticScreenshots(config.ERROR_SCREENSHOT_DIR, screenshotPaths);
  if (cleanup.failed.length) {
    pushActivity(`${cleanup.failed.length} screenshot non rimossi; verranno gestiti dalla pulizia automatica`, "warning");
  }
  return cleanup;
}

async function stateSnapshot() {
  let jobs: Awaited<ReturnType<WorkerRepository["listJobs"]>> = [];
  let completedImports: Array<{
    job: Awaited<ReturnType<WorkerRepository["getJob"]>>;
    properties: Awaited<ReturnType<WorkerRepository["loadGraph"]>>["properties"];
    people: Awaited<ReturnType<WorkerRepository["loadGraph"]>>["people"];
    ownerships: Awaited<ReturnType<WorkerRepository["loadGraph"]>>["ownerships"];
  }> = [];
  let completedImportsHasMore = false;
  let configError: string | null = null;
  let publicConfig: Record<string, unknown> = {};
  let latestRequestImport: Awaited<ReturnType<WorkerRepository["latestRequestImportRun"]>> = null;
  let requestImportSchemaError: string | null = null;
  let latestMandateImport: Awaited<ReturnType<WorkerRepository["latestMandateImportRun"]>> = null;
  let mandateImportSchemaError: string | null = null;
  try {
    const config = workerConfig();
    publicConfig = {
      configurationReady: true,
      configurationSource: preferences.encryptedEnvironment ? "Protetta da Windows" : "Inclusa nell'app",
      contactsExcelPath: config.CONTACTS_EXCEL_PATH,
      chromeCdpUrl: config.CHROME_CDP_URL,
      screenshotDirectory: config.ERROR_SCREENSHOT_DIR,
      operationLogPath: operationLogPath(),
      sisterKeepAliveEnabled: config.SISTER_KEEPALIVE_ENABLED,
      sisterKeepAliveInterval: `${config.SISTER_KEEPALIVE_MIN_SECONDS}-${config.SISTER_KEEPALIVE_MAX_SECONDS} secondi`,
    };
    const repo = repository(config);
    const [savedJobs, completedJobsPage] = await Promise.all([repo.listSavedJobs(), repo.listCompletedJobs(completedImportsLimit + 1)]);
    const completedJobs = completedJobsPage.slice(0, completedImportsLimit);
    completedImportsHasMore = completedJobsPage.length > completedImportsLimit;
    jobs = savedJobs;
    completedImports = await Promise.all(completedJobs.map(async (job) => ({ job, ...await repo.loadGraph(job.id) })));
    try {
      await repo.requestArchiveHealthCheck();
      latestRequestImport = await repo.latestRequestImportRun();
    } catch (error) {
      requestImportSchemaError = error instanceof Error ? error.message : String(error);
    }
    try {
      await repo.mandateArchiveHealthCheck();
      latestMandateImport = await repo.latestMandateImportRun();
    } catch (error) {
      mandateImportSchemaError = error instanceof Error ? error.message : String(error);
    }
    if (activeJobId) {
      const activeJob = completedJobs.find((job) => job.id === activeJobId)
        ?? savedJobs.find((job) => job.id === activeJobId)
        ?? await repo.getJob(activeJobId).catch(() => null);
      if (activeJob?.status === "completed") {
        currentStep = "completed";
        propertyProgress = null;
        prompt = null;
        lastError = null;
      }
    }
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  return {
    active,
    activeJobId,
    cancellingJobId,
    pausingJobId,
    skippingPropertyId,
    currentStep,
    propertyProgress,
    autoRetry: autoRetryAt && autoRetryJobId
      ? { jobId: autoRetryJobId, dueAt: autoRetryAt, attempt: autoRetryAttemptNumber, maximumAttempts: 3 }
      : null,
    autoRetryEnabled: preferences.autoRetryEnabled,
    prompt,
    lastError,
    sisterKeepAlive,
    softwareUpdate: desktopUpdater?.snapshot() ?? {
      status: "unavailable", currentVersion: app.getVersion(), availableVersion: null, percent: null,
      transferred: null, total: null, message: "Controllo aggiornamenti non inizializzato", checkedAt: null,
    },
    activity,
    diagnosticErrors,
    preferences,
    config: publicConfig,
    configError,
    jobs,
    completedImports,
    completedImportsHasMore,
    requestArchive: {
      active: requestImportActive,
      cancelling: requestImportCancellationRequested,
      progress: requestImportProgress,
      lastError: requestImportError,
      latestRun: latestRequestImport,
      schemaError: requestImportSchemaError,
    },
    mandateArchive: {
      active: mandateImportActive,
      cancelling: mandateImportCancellationRequested,
      progress: mandateImportProgress,
      lastError: mandateImportError,
      latestRun: latestMandateImport,
      schemaError: mandateImportSchemaError,
    },
    streetRun: {
      active: streetRunActive,
      cancelling: streetRunCancellationRequested,
      checkpoint: streetRunCheckpoint,
      progress: streetRunProgress,
      lastError: streetRunError,
      checkpointPath: streetRunCheckpointPath(),
    },
    version: app.getVersion(),
  };
}

function scheduleUpdateCheck(delayMs = 12_000) {
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  updateCheckTimer = setTimeout(async () => {
    await desktopUpdater?.check();
    scheduleUpdateCheck(6 * 60 * 60 * 1_000);
  }, delayMs);
  updateCheckTimer.unref?.();
}

function initializeDesktopUpdater() {
  try {
    const config = workerConfig();
    let previousStatus: DesktopUpdateState["status"] | null = null;
    desktopUpdater = new DesktopUpdater({
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      supabaseUrl: config.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      updateDirectory: path.join(app.getPath("temp"), "PropertyDataWorkerUpdates"),
      isWorkerActive: () => active || requestImportActive || mandateImportActive || streetRunActive,
      quitApp: () => app.quit(),
      onState: (state) => {
        if (state.status !== previousStatus) {
          if (state.status === "available") pushActivity(`Aggiornamento ${state.availableVersion} disponibile`, "warning");
          else if (state.status === "downloaded") pushActivity("Aggiornamento scaricato e pronto", "success");
          else if (state.status === "error") pushActivity(state.message, "warning");
          previousStatus = state.status;
        }
        void publishState();
      },
    });
    scheduleUpdateCheck();
  } catch (error) {
    pushActivity(`Aggiornamenti non inizializzati: ${error instanceof Error ? error.message : String(error)}`, "warning");
  }
}

async function handleRequestImportEvent(event: RequestArchiveImportEvent) {
  if (event.type === "index") {
    requestImportProgress = { runId: null, index: event.page, total: 0, title: `${event.discovered} richieste individuate`, externalId: null, failed: 0, phase: "index" };
    pushActivity(`Archivio richieste: pagina ${event.page}, ${event.discovered} voci individuate`);
  } else if (event.type === "progress") {
    requestImportProgress = { runId: event.runId, index: event.index, total: event.total, title: event.title, externalId: event.externalId, failed: event.failed, phase: "detail" };
    pushActivity(`Archivio richieste: voce ${event.index}/${event.total} · ${event.title}`);
  } else {
    requestImportProgress = { runId: event.run.id, index: event.run.processed_requests + event.run.failed_requests, total: event.run.total_requests, title: "Sincronizzazione conclusa", externalId: null, failed: event.run.failed_requests, phase: "detail" };
  }
  await publishState();
}

async function runRequestArchiveImport(resumeRunId?: string) {
  if (active || requestImportActive || mandateImportActive || streetRunActive) throw new Error("Attendi la fine della lavorazione già in esecuzione");
  requestImportActive = true;
  requestImportCancellationRequested = false;
  requestImportError = null;
  requestImportProgress = null;
  pushActivity(resumeRunId ? "Ripresa sincronizzazione archivio richieste" : "Sincronizzazione archivio richieste avviata");
  await publishState();
  const importer = new RequestArchiveImporter(workerConfig(), repository(), {
    isCancelled: () => requestImportCancellationRequested,
    onEvent: handleRequestImportEvent,
  });
  void importer.run(resumeRunId).then((run) => {
    if (run.status === "cancelled") pushActivity("Sincronizzazione richieste interrotta: l’avanzamento è stato salvato", "warning");
    else if (run.failed_requests) pushActivity(`Sincronizzazione conclusa con ${run.failed_requests} richieste da riprovare`, "warning");
    else pushActivity(`${run.processed_requests} richieste immobiliari sincronizzate`, "success");
  }).catch((error) => {
    requestImportError = error instanceof Error ? error.message : String(error);
    pushActivity(requestImportError, "error");
    void recordDiagnosticErrorSafely({
      source: "request-archive",
      status: "failed",
      message: requestImportError,
      jobId: resumeRunId ?? null,
      details: { operation: "request-archive-import", resume: Boolean(resumeRunId) },
    }, { publish: true });
  }).finally(async () => {
    requestImportActive = false;
    requestImportCancellationRequested = false;
    await publishState();
  });
}

async function handleMandateImportEvent(event: MandateArchiveImportEvent) {
  if (event.type === "index") {
    mandateImportProgress = { runId: null, index: event.page, total: 0, title: `${event.discovered} incarichi individuati`, externalId: null, failed: 0, phase: "index" };
    pushActivity(`Archivio incarichi: pagina ${event.page}, ${event.discovered} voci individuate`);
  } else if (event.type === "progress") {
    mandateImportProgress = { runId: event.runId, index: event.index, total: event.total, title: event.title, externalId: event.externalId, failed: event.failed, phase: "detail" };
    pushActivity(`Archivio incarichi: voce ${event.index}/${event.total} · ${event.title}`);
  } else {
    mandateImportProgress = { runId: event.run.id, index: event.run.processed_mandates + event.run.failed_mandates, total: event.run.total_mandates, title: "Sincronizzazione conclusa", externalId: null, failed: event.run.failed_mandates, phase: "detail" };
  }
  await publishState();
}

async function runMandateArchiveImport(resumeRunId?: string) {
  if (active || requestImportActive || mandateImportActive || streetRunActive) throw new Error("Attendi la fine della lavorazione già in esecuzione");
  mandateImportActive = true;
  mandateImportCancellationRequested = false;
  mandateImportError = null;
  mandateImportProgress = null;
  pushActivity(resumeRunId ? "Ripresa sincronizzazione archivio incarichi" : "Sincronizzazione archivio incarichi avviata");
  await publishState();
  const importer = new MandateArchiveImporter(workerConfig(), repository(), {
    isCancelled: () => mandateImportCancellationRequested,
    onEvent: handleMandateImportEvent,
  });
  void importer.run(resumeRunId).then((run) => {
    if (run.status === "cancelled") pushActivity("Sincronizzazione incarichi interrotta: l'avanzamento è stato salvato", "warning");
    else if (run.failed_mandates) pushActivity(`Sincronizzazione conclusa con ${run.failed_mandates} incarichi da riprovare`, "warning");
    else pushActivity(`${run.processed_mandates} immobili con incarico sincronizzati`, "success");
  }).catch((error) => {
    mandateImportError = error instanceof Error ? error.message : String(error);
    pushActivity(mandateImportError, "error");
    void recordDiagnosticErrorSafely({
      source: "mandate-archive",
      status: "failed",
      message: mandateImportError,
      jobId: resumeRunId ?? null,
      details: { operation: "mandate-archive-import", resume: Boolean(resumeRunId) },
    }, { publish: true });
  }).finally(async () => {
    mandateImportActive = false;
    mandateImportCancellationRequested = false;
    await publishState();
  });
}

async function runSisterStreet(input: { street: string; resume: boolean; dryRun: boolean }) {
  if (active || requestImportActive || mandateImportActive || streetRunActive) {
    throw new Error("Attendi la fine della lavorazione già in esecuzione");
  }
  const street = input.street.replace(/\s+/g, " ").trim();
  if (street.length < 4) throw new Error("Inserisci il nome completo della via");
  const resumeCheckpoint = input.resume ? streetRunCheckpoint ?? undefined : undefined;
  if (input.resume && !resumeCheckpoint) throw new Error("Non esiste una scansione da riprendere");
  const longRunMode = input.resume && resumeCheckpoint
    ? (resumeCheckpoint.mode === "live" ? "live" : "dry_run")
    : (input.dryRun ? "dry_run" : "live");

  streetRunActive = true;
  streetRunCancellationRequested = false;
  streetRunError = null;
  streetRunProgress = null;
  pushActivity(
    input.resume
      ? `Ripresa ${longRunMode === "dry_run" ? "dry-run" : "run reale"} via ${street}`
      : `${longRunMode === "dry_run" ? "Dry-run" : "Run reale"} via ${street} avviato`,
    "info",
  );
  await publishState();

  const config = workerConfig({ dryRun: longRunMode === "dry_run" });
  let jobToImport: string | null = null;
  let streetImportJobId = resumeCheckpoint?.importJobId ?? null;
  void connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH).then(async (tabs) => {
    try {
      const liveRepository = longRunMode === "live" ? repository(config) : null;
      let importJobId = resumeCheckpoint?.importJobId ?? null;
      if (liveRepository && !importJobId) {
        const importJob = await liveRepository.createJob("automatic");
        importJobId = importJob.id;
        streetImportJobId = importJob.id;
        await liveRepository.setJobContext(importJob.id, {
          municipality: "BITONTO",
          street,
          civicNumber: null,
          sourceUrl: tabs.sisterPage.url(),
        });
      }
      const scanner = new SisterStreetRun(tabs.sisterPage, {
        strategy: "bulk_exact_variants",
        mode: longRunMode,
        importJobId,
        acquireOwners: true,
        isCancelled: () => streetRunCancellationRequested,
        onPropertyAcquired: liveRepository && importJobId ? async (variant, property, owners) => {
          const [savedProperty] = await liveRepository.insertProperties(importJobId!, [{
            ...property,
            rawPayload: {
              ...property.rawPayload,
              long_run: { strategy: "bulk_exact_variants", variantId: variant.sourceId, acquiredAt: new Date().toISOString() },
            },
          }]);
          if (!savedProperty) throw new Error("Immobile long run non salvato");
          if (!owners.length) {
            await liveRepository.updatePropertyProcessing(savedProperty.id, {
              processing_status: "acquisition_failed",
              raw_payload: {
                ...(savedProperty.raw_payload ?? {}),
                acquisition: { status: "acquisition_failed", reason: "Nessun proprietario interpretabile", variantId: variant.sourceId },
              },
            });
            return;
          }
          for (const owner of owners) await liveRepository.insertOwner(importJobId!, savedProperty.id, owner);
        } : undefined,
        onProgress: (progress) => publishStreetRunProgress(progress),
        onCheckpoint: async (checkpoint) => {
          await persistStreetRunCheckpoint(checkpoint);
          await publishState();
        },
      });
      const result = await scanner.run(street, resumeCheckpoint);
      if (liveRepository && result.importJobId) {
        const graph = await liveRepository.loadGraph(result.importJobId);
        const activeProperties = graph.properties.filter((property) => !["acquisition_failed", "acquisition_skipped"].includes(property.processing_status));
        const activePropertyIds = new Set(activeProperties.map((property) => property.id));
        const activeOwnerships = graph.ownerships.filter((ownership) => activePropertyIds.has(ownership.property_id));
        const activePersonIds = new Set(activeOwnerships.map((ownership) => ownership.person_id));
        const activePeople = graph.people.filter((person) => activePersonIds.has(person.id));
        const incompleteProperties = activeProperties.filter((property) => !property.sheet || !property.parcel || !property.subaltern);
        const incompletePeople = activePeople.filter((person) => !normalizeTaxCode(person.tax_code) || person.share_percentage == null);
        const propertiesWithoutOwners = activeProperties.filter((property) => !activeOwnerships.some((ownership) => ownership.property_id === property.id));

        await Promise.all([
          ...activeProperties.map((property) => liveRepository.updatePropertyProcessing(property.id, { processing_status: "normalized" })),
          ...activePeople.map((person) => liveRepository.updatePersonProcessing(person.id, { tax_code: normalizeTaxCode(person.tax_code), processing_status: "normalized" })),
        ]);
        const totals = { total_properties: graph.properties.length, total_people: graph.people.length };
        if (result.status === "completed" && activeProperties.length && !incompleteProperties.length && !incompletePeople.length && !propertiesWithoutOwners.length) {
          await liveRepository.updateJob(result.importJobId, {
            ...totals,
            status: "saved",
            saved_at: new Date().toISOString(),
            last_completed_step: "acquisition_reviewed",
            current_step: "properties_processed",
            error_message: null,
            error_details: null,
          });
          jobToImport = result.importJobId;
        } else {
          const message = result.status !== "completed"
            ? "Run via sospesa: l'acquisizione resta salvata e riprendibile."
            : "Run via acquisita, ma alcuni dati obbligatori richiedono una correzione prima dell'import.";
          await liveRepository.updateJob(result.importJobId, {
            ...totals,
            status: result.status === "completed" ? "data_incomplete" : "paused",
            saved_at: new Date().toISOString(),
            last_completed_step: "owners_extracted",
            current_step: "data_normalized",
            error_message: message,
            error_details: {
              action: "long-run-acquisition-validation",
              incompletePropertyIds: incompleteProperties.map((property) => property.id),
              incompletePersonIds: incompletePeople.map((person) => person.id),
              propertiesWithoutOwners: propertiesWithoutOwners.map((property) => property.id),
            },
          });
          streetRunError = message;
        }
      }
      pushActivity(
        result.status === "completed"
          ? `${longRunMode === "dry_run" ? "Dry-run" : "Acquisizione reale"} via completata: ${result.totalAcceptedProperties} immobili unici e ${result.totalOwnersRead} proprietari letti`
          : `${longRunMode === "dry_run" ? "Dry-run" : "Run reale"} via sospesa dopo ${result.currentVariantIndex} varianti`,
        result.status === "completed" ? "success" : "warning",
      );
    } finally {
      await tabs.browser.close().catch(() => undefined);
    }
  }).catch((error) => {
    streetRunError = error instanceof Error ? error.message : String(error);
    pushActivity(streetRunError, "error");
    void recordDiagnosticErrorSafely({
      source: "street-run",
      status: "failed",
      message: streetRunError,
      jobId: streetImportJobId,
      details: { checkpointPath: streetRunCheckpointPath(), street },
    }, { publish: true });
  }).finally(async () => {
    streetRunActive = false;
    streetRunCancellationRequested = false;
    streetRunProgress = null;
    await publishState();
    if (jobToImport) {
      try {
        pushActivity("Acquisizione bulk completata: avvio l'import automatico degli immobili salvati", "success");
        await repository(config).markImportStarted(jobToImport);
        await runWorker({ mode: "automatic", dryRun: false, jobId: jobToImport });
      } catch (error) {
        const message = `Acquisizione salvata, ma avvio import non riuscito: ${error instanceof Error ? error.message : String(error)}`;
        streetRunError = message;
        pushActivity(message, "error");
        await recordDiagnosticErrorSafely({
          source: "worker",
          status: "failed",
          message,
          jobId: jobToImport,
          details: { operation: "long-run-import-start", street },
        });
        await publishState();
      }
    }
  });
}

async function publishState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:state", await stateSnapshot());
}

function publishPrompt(value: DesktopPrompt | null) {
  prompt = value;
  void publishState();
}

function publishStreetRunProgress(value: SisterStreetRunProgress) {
  streetRunProgress = value;
  const position = value.total ? ` ${value.current}/${value.total}` : "";
  const address = value.address ? ` · ${value.address}` : "";
  pushActivity(`Acquisizione via: ${value.phase}${position}${address}`);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:street-run-progress", value);
}

function clearAutoRetry() {
  if (autoRetryTimer) clearTimeout(autoRetryTimer);
  autoRetryTimer = null;
  autoRetryAt = null;
  autoRetryJobId = null;
  autoRetryAttemptNumber = null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function markCaseSkipped(
  jobId: string,
  propertyId: string,
  values: { source: "automatic" | "manual"; reason: string; attempts: number },
) {
  const repo = repository();
  const graph = await repo.loadGraph(jobId);
  const property = graph.properties.find((row) => row.id === propertyId);
  if (!property) throw new Error("Immobile da saltare non appartenente alla lavorazione");
  const impact = buildAutomaticSkipImpact(graph, propertyId);
  const relatedOwnerships = graph.ownerships.filter((ownership) => impact.ownershipIds.includes(ownership.id));
  const relatedPersonIds = impact.personIds;
  const skippedAt = new Date().toISOString();
  const skipDetails = {
    source: values.source,
    reason: values.reason,
    attempts: values.attempts,
    personIds: relatedPersonIds,
    skippedAt,
  };
  property.raw_payload = {
    ...(property.raw_payload ?? {}),
    property_flow: { version: 2, stage: "skipped", dryRun: preferences.dryRun, updatedAt: skippedAt },
    skip_details: skipDetails,
  };
  await repo.updatePropertyProcessing(property.id, {
    processing_status: "skipped",
    raw_payload: property.raw_payload,
  });
  for (const ownership of relatedOwnerships) {
    await repo.updateOwnership(ownership.id, { processing_status: "skipped" });
  }
  for (const personId of relatedPersonIds) {
    const person = graph.people.find((row) => row.id === personId);
    if (!person) continue;
    const previousCases = Array.isArray(person.raw_payload?.skipped_cases)
      ? person.raw_payload.skipped_cases
      : [];
    const hasAnotherActiveProperty = !impact.exclusivePersonIds.includes(personId);
    person.raw_payload = {
      ...(person.raw_payload ?? {}),
      skipped_cases: [
        ...previousCases.filter((entry) => recordValue(entry).propertyId !== propertyId),
        { propertyId, cadastralKey: property.cadastral_key, ...skipDetails },
      ],
    };
    await repo.updatePersonProcessing(person.id, {
      ...(!hasAnotherActiveProperty ? { processing_status: "skipped" } : {}),
      raw_payload: person.raw_payload,
    });
  }
  return { property, peopleCount: relatedPersonIds.length };
}

async function scheduleAutoRetry(jobId: string) {
  clearAutoRetry();
  if (!preferences.autoRetryEnabled) return;
  const repo = repository();
  const job = await repo.getJob(jobId);
  const propertyId = typeof job.error_details?.propertyId === "string"
    ? job.error_details.propertyId
    : propertyProgress?.propertyId;
  let completedAttempts = 0;
  if (propertyId) {
    const graph = await repo.loadGraph(jobId);
    const property = graph.properties.find((row) => row.id === propertyId);
    completedAttempts = automaticRetryAttempts(property?.raw_payload);
  }
  autoRetryJobId = jobId;
  autoRetryAttemptNumber = Math.min(completedAttempts + 1, 3);
  autoRetryAt = new Date(Date.now() + 60_000).toISOString();
  autoRetryTimer = setTimeout(async () => {
    if (active || cancellingJobId || activeJobId !== jobId) {
      await scheduleAutoRetry(jobId);
      await publishState();
      return;
    }
    try {
      const currentJob = await repo.getJob(jobId);
      const currentPropertyId = typeof currentJob.error_details?.propertyId === "string"
        ? currentJob.error_details.propertyId
        : propertyId;
      const attempt = autoRetryAttemptNumber ?? 1;
      if (currentPropertyId) {
        const graph = await repo.loadGraph(jobId);
        const property = graph.properties.find((row) => row.id === currentPropertyId);
        if (property) {
          property.raw_payload = {
            ...(property.raw_payload ?? {}),
            automatic_retry: {
              attempts: attempt,
              maximumAttempts: 3,
              lastAttemptAt: new Date().toISOString(),
              lastError: currentJob.error_message,
            },
          };
          await repo.updatePropertyProcessing(property.id, { raw_payload: property.raw_payload });
          automaticRetryInFlight = { jobId, propertyId: property.id, attempt };
        }
      }
      pushActivity(`Tentativo automatico ${attempt}/3`, "warning");
      await runWorker({ mode: currentJob.mode, dryRun: preferences.dryRun, jobId });
    } catch (error) {
      automaticRetryInFlight = null;
      lastError = error instanceof Error ? error.message : String(error);
      await scheduleAutoRetry(jobId);
      await publishState();
    }
  }, 60_000);
  autoRetryTimer.unref?.();
}

async function skipAfterAutomaticRetries(
  jobId: string,
  propertyId: string,
  reason: string,
  attempts: number,
) {
  try {
    while (active && activeJobId === jobId) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (cancellingJobId || activeJobId !== jobId) return;
    await resetCrmAfterSkippedCase();
    const skipped = await markCaseSkipped(jobId, propertyId, {
      source: "automatic",
      reason,
      attempts,
    });
    lastError = null;
    propertyProgress = null;
    pushActivity(
      `Caso saltato automaticamente dopo ${attempts} tentativi: ${skipped.property.address ?? skipped.property.cadastral_key}`,
      "warning",
    );
    pushActivity(`${skipped.peopleCount} nominativ${skipped.peopleCount === 1 ? "o" : "i"} annotati nel riepilogo`, "warning");
    await publishState();
    const job = await repository().getJob(jobId);
    await runWorker({ mode: job.mode, dryRun: preferences.dryRun, jobId });
  } catch (error) {
    lastError = `Skip automatico non completato: ${error instanceof Error ? error.message : String(error)}`;
    pushActivity(lastError, "error");
    await publishState();
  }
}

function handleRunnerEvent(event: RunnerEvent) {
  if (event.type === "job-ready") {
    activeJobId = event.job.id;
    const total = event.job.total_properties ?? 0;
    pushActivity(
      total > 0
        ? `Lavorazione ${event.job.id.slice(0, 8)} pronta: ${total} immobili totali da importare`
        : `Lavorazione ${event.job.id.slice(0, 8)} pronta`,
      "success",
    );
  } else if (event.type === "step-started") {
    currentStep = event.step;
    pushActivity(`Inizio: ${friendlyStepLabel(event.step)}`);
  } else if (event.type === "step-completed") {
    currentStep = event.next;
    pushActivity(`Terminato: ${friendlyStepLabel(event.step)}`, "success");
  } else if (event.type === "job-completed") {
    clearAutoRetry();
    automaticRetryInFlight = null;
    currentStep = "completed";
    propertyProgress = null;
    prompt = null;
    lastError = null;
    pushActivity("Import eseguito con successo", "success");
  } else if (event.type === "job-archived") {
    clearAutoRetry();
    automaticRetryInFlight = null;
    currentStep = "properties_processed";
    propertyProgress = null;
    activeJobId = null;
    pushActivity("Ricerca SISTER salvata nell'archivio", "success");
  } else if (event.type === "sister-keepalive") {
    updateKeepAliveState(event.result);
  } else if (event.type === "property-progress") {
    propertyProgress = { propertyId: event.propertyId, index: event.index, total: event.total, address: event.address, stage: event.stage, message: event.message };
    pushActivity(`Immobile ${event.index}/${event.total}: ${event.message}`);
  } else if (event.details.cancelled === true && cancellingJobId === event.jobId) {
    pushActivity("Arresto del processo completato", "warning");
  } else if (event.details.pauseRequested === true && pausingJobId === event.jobId) {
    prompt = null;
    propertyProgress = null;
    pushActivity("Lavorazione messa in pausa: il checkpoint è stato salvato", "warning");
  } else {
    lastError = event.message;
    pushActivity(event.message, "error");
    void recordDiagnosticErrorSafely({
      source: "worker",
      status: event.status,
      message: event.message,
      jobId: event.jobId,
      details: event.details,
    }, { publish: true });
    const retry = automaticRetryInFlight;
    automaticRetryInFlight = null;
    const failedPropertyId = typeof event.details.propertyId === "string" ? event.details.propertyId : null;
    if (retry && retry.jobId === event.jobId && retry.propertyId === failedPropertyId && retry.attempt >= 3) {
      clearAutoRetry();
      void skipAfterAutomaticRetries(event.jobId, retry.propertyId, event.message, retry.attempt);
    } else if (preferences.autoRetryEnabled && failedPropertyId && ["portal_error", "failed"].includes(event.status)) {
      void scheduleAutoRetry(event.jobId);
    } else {
      pushActivity(
        preferences.autoRetryEnabled
          ? "Questo errore richiede un controllo umano e non verrà trasformato in retry o skip automatico"
          : "Riprova automatico disattivato: il lavoro resta fermo finché non decidi tu",
        "warning",
      );
    }
  }
  void publishState();
}

function friendlyStepLabel(step: string) {
  const labels: Record<string, string> = {
    ready: "preparazione collegamenti", sister_results_acquired: "lettura risultati SISTER",
    properties_extracted: "raccolta immobili", owners_extracted: "raccolta proprietari",
    data_normalized: "controllo dei dati", acquisition_reviewed: "riepilogo acquisizione",
    person_searched: "ricerca nominativi", person_created_or_updated: "aggiornamento nominativi",
    person_merge_reviewed: "verifica unioni nominativi", property_searched: "ricerca immobili del nominativo",
    property_created_or_updated: "aggiornamento immobili", activity_created: "creazione attività sugli immobili",
    properties_processed: "lavorazione completa degli immobili",
    contacts_matched: "abbinamento recapiti Excel", owners_linked: "sospensione soggetti correlati",
    verified: "verifica finale", completed: "lavorazione completa",
  };
  return labels[step] ?? step.replaceAll("_", " ");
}

function updateKeepAliveState(result: SisterKeepAliveResult) {
  const previousStatus = sisterKeepAlive.statusLabel;
  sisterKeepAlive = {
    ...result,
    nextAttemptAt: sisterKeepAlive.nextAttemptAt,
    statusLabel: result.ok ? "active" : result.sessionExpired ? "expired" : "error",
  };
  if (!result.ok && previousStatus !== sisterKeepAlive.statusLabel) {
    pushActivity(result.message, result.sessionExpired ? "error" : "warning");
  }
  void publishState();
}

function scheduleDesktopKeepAlive(delayMs?: number) {
  if (keepAliveTimer) clearTimeout(keepAliveTimer);
  let config: WorkerConfig;
  try {
    config = workerConfig();
  } catch {
    keepAliveTimer = setTimeout(() => scheduleDesktopKeepAlive(), 120_000);
    keepAliveTimer.unref?.();
    return;
  }
  if (!config.SISTER_KEEPALIVE_ENABLED) {
    sisterKeepAlive = { ...sisterKeepAlive, statusLabel: "disabled", message: "Mantenimento sessione disattivato", nextAttemptAt: null };
    void publishState();
    return;
  }
  const delay = delayMs ?? nextKeepAliveDelay(config.SISTER_KEEPALIVE_MIN_SECONDS, config.SISTER_KEEPALIVE_MAX_SECONDS);
  sisterKeepAlive = { ...sisterKeepAlive, nextAttemptAt: new Date(Date.now() + delay).toISOString() };
  keepAliveTimer = setTimeout(() => void runDesktopKeepAlive(), delay);
  keepAliveTimer.unref?.();
  void publishState();
}

async function runDesktopKeepAlive() {
  try {
    const config = workerConfig();
    const tabs = await connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH);
    try {
      updateKeepAliveState(await pingSisterSession(tabs.sisterPage, config.SISTER_KEEPALIVE_URL));
    } finally {
      await tabs.browser.close().catch(() => undefined);
    }
  } catch (error) {
    updateKeepAliveState({
      ok: false,
      sessionExpired: false,
      status: null,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleDesktopKeepAlive();
  }
}

async function resetCrmAfterSkippedCase() {
  const config = workerConfig();
  const tabs = await connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH);
  try {
    const result = await new PlaywrightCrmAdapter(tabs.crmPage, false).resetToCrmHome();
    pushActivity(
      result.mergeDismissed
        ? "Caso chiuso e gestionale riportato alla home; avvio il nominativo successivo"
        : "Gestionale riportato alla home; avvio il nominativo successivo",
      "warning",
    );
    return result;
  } finally {
    await tabs.browser.close().catch(() => undefined);
  }
}

async function runWorker(input: { mode: WorkerMode; dryRun: boolean; jobId?: string }) {
  if (active || requestImportActive || mandateImportActive || streetRunActive) throw new Error("È già presente una lavorazione in esecuzione");
  clearAutoRetry();
  active = true;
  cancellingJobId = null;
  pausingJobId = null;
  lastError = null;
  currentStep = null;
  propertyProgress = null;
  activeJobId = input.jobId ?? null;
  preferences = { ...preferences, mode: input.mode, dryRun: input.dryRun };
  await persistPreferences();
  activePrompts = new DesktopPromptController(publishPrompt);
  const runner = new PropertyWorkerRunner(workerConfig(preferences), {
    prompts: activePrompts,
    onEvent: handleRunnerEvent,
    keepAlive: false,
    isCancellationRequested: (jobId) => cancellingJobId === jobId,
    isPauseRequested: (jobId) => pausingJobId === jobId,
    isPropertySkipRequested: (jobId, propertyId) => activeJobId === jobId && skippingPropertyId === propertyId,
  });
  pushActivity(input.jobId ? "Ripresa lavorazione richiesta" : "Nuova lavorazione richiesta");
  await publishState();
  const runPromise = runner.run({ mode: input.mode, jobId: input.jobId, createNew: !input.jobId })
    .then(() => undefined)
    .catch((error) => {
      if (cancellingJobId && cancellingJobId === activeJobId) return;
      if (pausingJobId && pausingJobId === activeJobId) return;
      const message = error instanceof Error ? error.message : String(error);
      const alreadyReported = lastError === message;
      lastError = message;
      pushActivity(message, "error");
      if (!alreadyReported) {
        void recordDiagnosticErrorSafely({
          source: "worker",
          status: "failed",
          message,
          jobId: activeJobId,
          details: { operation: "worker-start-or-run" },
        }, { publish: true });
      }
    })
    .finally(async () => {
      const cancelledJobId = cancellingJobId && cancellingJobId === activeJobId ? cancellingJobId : null;
      if (cancelledJobId) {
        try {
          const cleanup = await purgeJob(cancelledJobId);
          activeJobId = null;
          currentStep = null;
          propertyProgress = null;
          lastError = null;
          prompt = null;
          pushActivity(
            cleanup.removed
              ? `Lavorazione annullata e rimossa con ${cleanup.removed} screenshot`
              : "Lavorazione annullata e dati rimossi",
            "success",
          );
        } catch (error) {
          lastError = `Annullamento non completato: ${error instanceof Error ? error.message : String(error)}`;
          pushActivity(lastError, "error");
        } finally {
          cancellingJobId = null;
        }
      }
      active = false;
      pausingJobId = null;
      skippingPropertyId = null;
      activePrompts = null;
      activeRunPromise = null;
      await publishState();
    });
  activeRunPromise = runPromise;
  void runPromise;
}

async function healthChecks() {
  const config = workerConfig();
  const checks: Array<{ id: string; label: string; ok: boolean; detail: string }> = [];
  try {
    await access(config.CONTACTS_EXCEL_PATH);
    const excel = new ExcelContactsAdapter(config.CONTACTS_EXCEL_PATH);
    await excel.load();
    checks.push({ id: "excel", label: "File recapiti", ok: true, detail: `${REQUIRED_CONTACT_COLUMNS.length} colonne riconosciute` });
  } catch (error) {
    checks.push({ id: "excel", label: "File recapiti", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  try {
    await repository(config).healthCheck();
    checks.push({ id: "supabase", label: "Supabase", ok: true, detail: "Connesso" });
  } catch (error) {
    checks.push({ id: "supabase", label: "Supabase", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  try {
    const tabs = await connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH);
    checks.push({ id: "chrome", label: "Chrome dedicato", ok: true, detail: `${tabs.pages.length} schede aperte` });
    checks.push({ id: "sister", label: "SISTER", ok: isPresumablyAuthenticated(tabs.sisterPage), detail: await tabs.sisterPage.title() });
    checks.push({ id: "crm", label: "Gestionale", ok: isPresumablyAuthenticated(tabs.crmPage), detail: await tabs.crmPage.title() });
    const [sisterPage, crmPage] = await Promise.all([
      new PlaywrightSisterAdapter(tabs.sisterPage).detectOperationalPage().catch(() => null),
      new PlaywrightCrmAdapter(tabs.crmPage, true).detectPage().catch(() => false),
    ]);
    checks.push({
      id: "results",
      label: "SISTER pronto",
      ok: sisterPage !== null,
      detail: sisterPage === "results"
        ? "Risultati pronti per l'acquisizione singola"
        : sisterPage === "address-list"
          ? "Elenco indirizzi pronto per acquisire una via completa"
          : "Apri i risultati oppure l'Elenco indirizzi",
    });
    if (!crmPage) checks.find((item) => item.id === "crm")!.detail = "Pagina gestionale non riconosciuta";
  } catch (error) {
    checks.push({ id: "chrome", label: "Chrome e schede", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  pushActivity(checks.every((item) => item.ok) ? "Controlli completati" : "Alcuni controlli richiedono attenzione", checks.every((item) => item.ok) ? "success" : "warning");
  await publishState();
  return checks;
}

function findChromeExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.find((candidate) => candidate && path.isAbsolute(candidate) && existsSync(candidate));
}

async function createWindow() {
  const preloadPath = app.isPackaged
    ? path.join(process.resourcesPath, "preload.cjs")
    : path.join(workerRoot, "src", "desktop", "preload.cjs");
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(workerRoot, "assets", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f2efe4",
    title: "Property Data Worker",
    icon: iconPath,
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.removeMenu();
  const rendererPath = app.isPackaged
    ? path.join(process.resourcesPath, "renderer", "index.html")
    : path.join(workerRoot, "src", "desktop", "renderer", "index.html");
  await mainWindow.loadFile(rendererPath);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
}

function registerIpc() {
  ipcMain.handle("desktop:get-state", () => stateSnapshot());
  ipcMain.handle("desktop:record-ui-action", async (_event, rawValues: unknown) => {
    const values = uiActionSchema.parse(rawValues);
    const suffix = values.detail ? ` · ${values.detail}` : "";
    if (values.status === "started") pushActivity(`Comando ricevuto: ${values.label}`);
    else if (values.status === "completed") pushActivity(`Comando eseguito: ${values.label}`, "success");
    else if (values.status === "cancelled") pushActivity(`Comando annullato: ${values.label}`, "warning");
    else {
      const message = `Comando fallito: ${values.label}${suffix}`;
      pushActivity(message, "error");
      await recordDiagnosticErrorSafely({
        source: "desktop-ui",
        status: "failed",
        message,
        jobId: activeJobId,
        details: { action: values.action, operationLabel: values.label, detail: values.detail ?? null },
      }, { publish: false });
    }
    return true;
  });
  ipcMain.handle("desktop:run-checks", () => healthChecks());
  ipcMain.handle("desktop:choose-excel", async () => {
    const selection = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "File Excel", extensions: ["xlsx", "xls"] }] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    preferences = { ...preferences, contactsExcelPath: selection.filePaths[0] };
    await persistPreferences();
    await publishState();
    return selection.filePaths[0];
  });
  ipcMain.handle("desktop:choose-environment", async () => {
    const selection = await dialog.showOpenDialog({ properties: ["openFile"], title: "Seleziona worker/.env" });
    if (selection.canceled || !selection.filePaths[0]) return null;
    preferences = { ...preferences, environmentFilePath: selection.filePaths[0] };
    const imported = readEnvironmentFiles(selection.filePaths[0]);
    if (imported.SUPABASE_SERVICE_ROLE_KEY && safeStorage.isEncryptionAvailable()) {
      preferences.encryptedEnvironment = safeStorage.encryptString(JSON.stringify(imported)).toString("base64");
    }
    await persistPreferences();
    await publishState();
    return selection.filePaths[0];
  });
  ipcMain.handle("desktop:save-preferences", async (_event, values: Partial<Preferences>) => {
    preferences = { ...preferences, ...values, dryRun: values.dryRun ?? preferences.dryRun };
    await persistPreferences();
    await publishState();
    return preferences;
  });
  ipcMain.handle("desktop:save-internal-configuration", async (_event, rawValues: unknown) => {
    const values = internalConfigurationSchema.parse(rawValues);
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows non rende disponibile la protezione delle credenziali");
    const existing = internalEnvironment();
    const secured = {
      ...existing,
      NEXT_PUBLIC_SUPABASE_URL: values.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: values.serviceRoleKey,
      CONTACTS_EXCEL_PATH: values.contactsExcelPath,
      SISTER_TAB_MATCH: values.sisterTabMatch,
      CRM_TAB_MATCH: values.crmTabMatch,
    };
    preferences = {
      ...preferences,
      contactsExcelPath: values.contactsExcelPath,
      encryptedEnvironment: safeStorage.encryptString(JSON.stringify(secured)).toString("base64"),
    };
    await persistPreferences();
    initializeDesktopUpdater();
    pushActivity("Configurazione salvata e protetta da Windows", "success");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:open-chrome", async () => {
    const executable = findChromeExecutable();
    if (!executable) throw new Error("Google Chrome non trovato");
    spawn(executable, ["--remote-debugging-port=9222", "--user-data-dir=C:\\ChromeListingRadar"], { detached: true, stdio: "ignore" }).unref();
    pushActivity("Chrome dedicato avviato", "success");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:start-job", async (_event, values: { mode?: WorkerMode; dryRun?: boolean }) => {
    await runWorker({ mode: values.mode === "automatic" ? "automatic" : "assisted", dryRun: values.dryRun !== false });
    return true;
  });
  ipcMain.handle("desktop:start-street-run", async (_event, values: { street?: string; resume?: boolean; dryRun?: boolean }) => {
    await runSisterStreet({ street: String(values.street ?? ""), resume: values.resume === true, dryRun: values.dryRun !== false });
    return true;
  });
  ipcMain.handle("desktop:cancel-street-run", async () => {
    if (!streetRunActive) return false;
    streetRunCancellationRequested = true;
    pushActivity("Pausa run via richiesta: completo il passaggio corrente e salvo il cursore", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:start-request-archive-import", async (_event, resumeRunId?: string) => {
    await runRequestArchiveImport(resumeRunId || undefined);
    return true;
  });
  ipcMain.handle("desktop:cancel-request-archive-import", async () => {
    if (!requestImportActive) return false;
    requestImportCancellationRequested = true;
    pushActivity("Interruzione sincronizzazione richieste richiesta", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:start-mandate-archive-import", async (_event, resumeRunId?: string) => {
    await runMandateArchiveImport(resumeRunId || undefined);
    return true;
  });
  ipcMain.handle("desktop:cancel-mandate-archive-import", async () => {
    if (!mandateImportActive) return false;
    mandateImportCancellationRequested = true;
    pushActivity("Interruzione sincronizzazione incarichi richiesta", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:resume-job", async (_event, jobId: string) => {
    clearAutoRetry();
    const repo = repository();
    const job = await repo.getJob(jobId);
    if (job.saved_at) await repo.markImportStarted(jobId);
    await runWorker({ mode: job.mode, dryRun: preferences.dryRun, jobId });
    return true;
  });
  ipcMain.handle("desktop:set-auto-retry-enabled", async (_event, enabled: boolean) => {
    preferences = { ...preferences, autoRetryEnabled: Boolean(enabled) };
    await persistPreferences();
    if (!preferences.autoRetryEnabled) {
      clearAutoRetry();
      pushActivity("Riprova automatico fermato. Ripartirà soltanto quando lo riattivi.", "warning");
    } else {
      pushActivity("Riprova automatico riattivato", "success");
      if (activeJobId && lastError && !active) await scheduleAutoRetry(activeJobId);
    }
    await publishState();
    return preferences.autoRetryEnabled;
  });
  ipcMain.handle("desktop:pause-job", async () => {
    clearAutoRetry();
    if (!activeJobId) return false;
    const jobId = activeJobId;
    if (pausingJobId === jobId) return true;
    pausingJobId = jobId;
    activePrompts?.cancel("Pausa richiesta dall'utente");
    pushActivity("Pausa acquisita: termino soltanto l'operazione atomica già iniziata", "warning");
    await publishState();
    await repository().updateJob(jobId, { status: "paused" });
    return true;
  });
  ipcMain.handle("desktop:cancel-job", async (_event, jobId: string) => {
    clearAutoRetry();
    if (!jobId) throw new Error("Identificativo lavorazione mancante");
    if (active) {
      if (activeJobId !== jobId) throw new Error("Attendi la fine della lavorazione attiva prima di annullarne un'altra");
      if (cancellingJobId !== jobId) {
        cancellingJobId = jobId;
        activePrompts?.cancel("Annullamento definitivo richiesto");
        pushActivity("Annullamento in corso: arresto sicuro del worker", "warning");
        await publishState();
      }
      const pendingRun = activeRunPromise;
      if (!pendingRun) return { deleted: false, pending: true };
      await pendingRun;
      if (activeJobId === jobId) throw new Error(lastError ?? "Annullamento non completato");
      return { deleted: true };
    }

    const cleanup = await purgeJob(jobId);
    if (activeJobId === jobId) {
      activeJobId = null;
      currentStep = null;
      propertyProgress = null;
      lastError = null;
      prompt = null;
    }
    pushActivity("Lavorazione annullata e dati rimossi", "success");
    await publishState();
    return { deleted: true, screenshotsRemoved: cleanup.removed };
  });
  ipcMain.handle("desktop:answer-prompt", (_event, values: { promptId: string; decision?: PromptResponse }) => {
    activePrompts?.respond(values.promptId, values.decision);
    return true;
  });
  ipcMain.handle("desktop:get-job-details", async (_event, jobId: string) => {
    const repo = repository();
    const [job, graph] = await Promise.all([repo.getJob(jobId), repo.loadGraph(jobId)]);
    return { job, properties: graph.properties, people: graph.people, ownerships: graph.ownerships };
  });
  ipcMain.handle("desktop:skip-property", async (_event, values: { jobId: string; propertyId: string }) => {
    if (!values.jobId || !values.propertyId) throw new Error("Immobile da saltare non riconosciuto");
    const repo = repository();
    if (active) {
      if (activeJobId !== values.jobId) throw new Error("La riga indicata non appartiene alla lavorazione attiva");
      if (propertyProgress?.propertyId !== values.propertyId) throw new Error("La riga indicata non Ã¨ piÃ¹ quella corrente");
      if (skippingPropertyId && skippingPropertyId !== values.propertyId) throw new Error("Attendi il completamento dello skip giÃ  richiesto");
      skippingPropertyId = values.propertyId;
      pushActivity(
        currentStep === "owners_extracted"
          ? `Skip richiesto per la riga ${propertyProgress.index}: terminerÃ² in sicurezza il passaggio corrente e continuerÃ²`
          : "Skip richiesto per l'immobile corrente: terminerÃ² in sicurezza il passaggio corrente e continuerÃ²",
        "warning",
      );
      await publishState();
      return { pending: true };
    }
    await resetCrmAfterSkippedCase();
    const skipped = await markCaseSkipped(values.jobId, values.propertyId, {
      source: "manual",
      reason: "Saltato manualmente dall'utente",
      attempts: 0,
    });
    skippingPropertyId = skipped.property.id;
    pushActivity(`Immobile e nominativi annotati come saltati: ${skipped.property.address ?? skipped.property.cadastral_key}`, "warning");
    if (!active) {
      const job = await repo.getJob(values.jobId);
      lastError = null;
      await runWorker({ mode: job.mode, dryRun: preferences.dryRun, jobId: job.id });
    }
    await publishState();
    return { pending: false };
  });
  ipcMain.handle("desktop:load-more-completed", async () => {
    completedImportsLimit += 6;
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:save-manual-corrections", async (_event, rawValues: unknown) => {
    const values = manualCorrectionSchema.parse(rawValues);
    const repo = repository();
    const graph = await repo.loadGraph(values.jobId);
    const allowedProperties = new Set(graph.properties.map((row) => row.id));
    const allowedPeople = new Set(graph.people.map((row) => row.id));
    const allowedOwnerships = new Map(graph.ownerships.map((row) => [row.id, row]));
    for (const property of values.properties) {
      if (!allowedProperties.has(property.id)) throw new Error("Immobile non appartenente alla lavorazione");
      await repo.updatePropertyProcessing(property.id, {
        sheet: property.sheet, parcel: property.parcel, subaltern: property.subaltern,
        cadastral_key: [graph.properties.find((row) => row.id === property.id)?.municipality, property.sheet, property.parcel, property.subaltern].join("|"),
        address: property.address ?? null, category: property.category, class: property.class ?? null,
        consistency: property.consistency ?? null, cadastral_income: property.cadastralIncome ?? null,
        processing_status: "normalized",
      });
    }
    for (const person of values.people) {
      if (!allowedPeople.has(person.id)) throw new Error("Nominativo non appartenente alla lavorazione");
      await repo.updatePersonProcessing(person.id, {
        full_name: person.fullName, tax_code: person.taxCode?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null,
        birth_place: person.birthPlace ?? null, birth_province: person.birthProvince ?? null,
        birth_date: person.birthDate || null, share_original: person.shareOriginal,
        share_percentage: person.sharePercentage ?? null, processing_status: "normalized",
      });
      if (person.ownershipId) {
        const ownership = allowedOwnerships.get(person.ownershipId);
        if (!ownership || ownership.person_id !== person.id) throw new Error("Quota non appartenente al nominativo indicato");
        await repo.updateOwnership(ownership.id, { share_percentage: person.sharePercentage ?? null, processing_status: "extracted" });
      } else {
        const related = graph.ownerships.filter((row) => row.person_id === person.id);
        for (const ownership of related) await repo.updateOwnership(ownership.id, { share_percentage: person.sharePercentage ?? null, processing_status: "extracted" });
      }
    }
    await repo.updateJob(values.jobId, { status: "paused", error_message: null, error_details: { manualCorrection: true } });
    lastError = null;
    pushActivity("Correzioni manuali salvate. La lavorazione può ripartire.", "success");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:remove-job-property", async (_event, rawValues: unknown) => {
    const values = removeJobPropertySchema.parse(rawValues);
    if (active && activeJobId === values.jobId) {
      throw new Error("Metti prima in pausa la lavorazione, poi rimuovi l'immobile.");
    }
    const repo = repository();
    const result = await repo.removePropertyFromJob(values.jobId, values.propertyId);
    await repo.updateJob(values.jobId, {
      status: "paused",
      error_message: null,
      error_details: { manualRemoval: true, removedPropertyId: values.propertyId },
    });
    if (activeJobId === values.jobId) lastError = null;
    pushActivity(
      result.removedPersonIds.length
        ? `Immobile rimosso insieme a ${result.removedPersonIds.length} nominativ${result.removedPersonIds.length === 1 ? "o" : "i"} non collegati ad altri immobili.`
        : "Immobile rimosso. I nominativi collegati ad altri immobili sono stati conservati.",
      "success",
    );
    await publishState();
    return result;
  });
  ipcMain.handle("desktop:reveal-file", (_event, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle("desktop:check-update", async () => {
    if (!desktopUpdater) initializeDesktopUpdater();
    return desktopUpdater?.check();
  });
  ipcMain.handle("desktop:download-update", () => desktopUpdater?.download());
  ipcMain.handle("desktop:install-update", () => desktopUpdater?.install());
}

app.whenReady().then(async () => {
  app.setAppUserModelId("it.listingradar.propertyworker");
  await loadPreferences();
  await loadStreetRunCheckpoint();
  await loadDiagnosticErrors();
  registerIpc();
  await createWindow();
  scheduleDesktopKeepAlive(3_000);
  initializeDesktopUpdater();
});

app.on("before-quit", () => {
  if (keepAliveTimer) clearTimeout(keepAliveTimer);
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
