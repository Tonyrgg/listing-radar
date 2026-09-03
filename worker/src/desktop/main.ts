import { existsSync, readFileSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import dotenv from "dotenv";
import { z } from "zod";

import { REQUIRED_CONTACT_COLUMNS, verifyContactsFile } from "../adapters/excel/index.js";
import { PlaywrightCrmAdapter } from "../adapters/crm/index.js";
import { PlaywrightSisterAdapter } from "../adapters/sister/index.js";
import { sisterSelectors } from "../adapters/sister/selectors.js";
import { loadConfig, type WorkerConfig } from "../config.js";
import { sanitizeSensitiveText } from "../logger.js";
import { automaticRetryAttempts, buildAutomaticSkipImpact, canAutomaticallyRecoverPropertyFailure } from "../core/automatic-skip.js";
import { inspectAcquisitionQueue } from "../services/acquisition-queue.js";
import { PropertyWorkerRunner, type RunnerEvent } from "../services/runner.js";
import { connectToChrome } from "../services/chrome.js";
import { MandateArchiveImporter, type MandateArchiveImportEvent } from "../services/mandate-archive-importer.js";
import { RequestArchiveImporter, type RequestArchiveImportEvent } from "../services/request-archive-importer.js";
import { nextKeepAliveDelay, pingSisterSession, type SisterKeepAliveResult } from "../services/sister-keepalive.js";
import {
  SisterStreetRun,
  type SisterStreetRunCheckpoint,
  type SisterStreetRunProgress,
} from "../services/sister-street-run.js";
import {
  SisterNetworkRun,
  type SisterNetworkRunCheckpoint,
  type SisterNetworkRunProgress,
} from "../services/sister-network-run.js";
import {
  normalizeNetworkSettings,
  normalizeStreetPropertyFilters,
  type NetworkExplorationSettings,
  type StreetPropertyFilters,
} from "../core/network-exploration.js";
import type { RetryTelemetry } from "../core/retry-telemetry.js";
import { indexJobGraph } from "../services/job-graph.js";
import type { PropertyActivityMode } from "../services/property-activities.js";
import { collectCrmPersonSeeds } from "../adapters/crm/people.js";
import { runTecnocloudV2ReadOnlyDiagnostic } from "../import-v2/diagnostics.js";
import { WorkerRepository } from "../services/repository.js";
import {
  StreetRegistryService,
  streetRunRegistryOutcome,
  type StreetRegistryOutcome,
  type StreetRegistryQueueItem,
  type StreetRegistryZoneOption,
} from "../services/street-registry.js";
import { describeSupabaseOperationalError } from "../services/supabase-errors.js";
import { runStreetRegistrySequence } from "../services/street-registry-sequence.js";
import { removeDiagnosticScreenshots } from "../services/screenshots.js";
import type { PromptResponse } from "../services/prompts.js";
import type { WorkerMode } from "../types.js";
import {
  EMPTY_BROWSER_CONNECTION_STABILITY,
  detectBrowserConnections,
  stabilizeBrowserConnections,
  unreachableBrowserConnections,
  type BrowserConnectionCheck,
  type BrowserConnectionStability,
} from "./connection-detection.js";
import { DesktopPromptController, type DesktopPrompt } from "./prompts.js";
import {
  projectStreetCheckpointForRenderer,
  summarizeCompletedGraph,
  type CompletedImportSummary,
} from "./state-projection.js";
import { DesktopUpdater, type DesktopUpdateState } from "./updater.js";

type Preferences = {
  environmentFilePath?: string;
  contactsExcelPath?: string;
  mode: WorkerMode;
  /* Il simulatore: il worker percorre tutto senza scrivere nel gestionale.
   * Resta perche' il runner lo usa in una quarantina di punti; a comandarlo
   * adesso e' `keepAcquisition`, che e' l'unica scelta esposta all'operatore. */
  dryRun: boolean;
  /* La run si ferma al riepilogo e conserva l'acquisizione: l'import lo fa
   * partire una persona, dall'archivio, quando ha controllato i dati. */
  keepAcquisition: boolean;
  autoRetryEnabled: boolean;
  /* Cosa scrivere nel diario del gestionale: vedi PropertyActivityMode. */
  propertyActivityMode: PropertyActivityMode;
  /* Ambito dell'ultima Rete proprietari: null significa tutta Bitonto. */
  streetRegistryZoneId: string | null;
  encryptedEnvironment?: string;
};

type ActivityItem = { at: string; tone: "info" | "success" | "warning" | "error"; message: string };
type DiagnosticErrorItem = {
  id: string;
  at: string;
  source: "worker" | "street-run" | "request-archive" | "mandate-archive" | "desktop-ui" | "import-v2-diagnostics";
  status: string;
  message: string;
  jobId: string | null;
  details: Record<string, unknown>;
};
type KeepAliveState = SisterKeepAliveResult & { nextAttemptAt: string | null; statusLabel: "waiting" | "active" | "expired" | "error" | "disabled" };
type RetryMonitorState = RetryTelemetry & {
  runType: "import" | "street" | "network" | "requests" | "mandates";
  updatedAt: string;
};

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(moduleDirectory, "../..");
const defaultPreferences: Preferences = { mode: "assisted", dryRun: true, keepAcquisition: true, autoRetryEnabled: true, propertyActivityMode: "direct_contact", streetRegistryZoneId: null };
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
let activeRunner: PropertyWorkerRunner | null = null;
let cancellingJobId: string | null = null;
let pausingJobId: string | null = null;
let prompt: DesktopPrompt | null = null;
let activityModeOverride: PropertyActivityMode | null = null;
let currentStep: string | null = null;
let propertyProgress: { propertyId: string; index: number; total: number; address: string | null; stage: string; message: string } | null = null;
let lastError: string | null = null;
let skippingPropertyId: string | null = null;
let autoRetryTimer: ReturnType<typeof setTimeout> | null = null;
let autoRetryAt: string | null = null;
let autoRetryJobId: string | null = null;
let autoRetryAttemptNumber: number | null = null;
let automaticRetryInFlight: { jobId: string; propertyId: string; attempt: number } | null = null;
let retryMonitor: RetryMonitorState | null = null;
let attentionTimer: ReturnType<typeof setTimeout> | null = null;
let completedImportsLimit = 6;
let requestImportActive = false;
let requestImportCancellationRequested = false;
let activeRequestImporter: RequestArchiveImporter | null = null;
let requestImportPromise: Promise<void> | null = null;
let requestImportError: string | null = null;
let requestImportProgress: { runId: string | null; index: number; total: number; title: string; externalId: string | null; failed: number; phase: "index" | "detail" } | null = null;
type DesktopOperationCompletion = {
  kind: "acquisition" | "requests" | "mandates" | "street" | "network";
  title: string;
  summary: string;
  completedAt: string;
  stats: Array<{ label: string; value: number }>;
};
let operationCompletion: DesktopOperationCompletion | null = null;
let mandateImportActive = false;
let mandateImportCancellationRequested = false;
let activeMandateImporter: MandateArchiveImporter | null = null;
let mandateImportPromise: Promise<void> | null = null;
let mandateImportError: string | null = null;
let mandateImportProgress: { runId: string | null; index: number; total: number; title: string; externalId: string | null; failed: number; phase: "index" | "detail" } | null = null;
/* La via in lavorazione arriva dallo Street Registry con un lease: finche' la
 * run e' viva questo riferimento tiene insieme la lavorazione remota e quella
 * locale, cosi' la chiusura sa sempre quale voce di coda liberare. */
let streetRegistryClaim: StreetRegistryQueueItem | null = null;
let streetRegistryPreview: StreetRegistryQueueItem[] = [];
let streetRegistryError: string | null = null;
let streetRegistryLoading = false;
let streetRegistryZones: StreetRegistryZoneOption[] = [];
let streetRegistrySelectedZoneId: string | null = null;
let streetRegistryLeaseTimer: ReturnType<typeof setTimeout> | null = null;
let streetRegistryLastOutcome: StreetRegistryOutcome | null = null;
type StreetRegistryNetworkProgress = {
  startedAt: string;
  processedStreets: number;
  completedStreets: number;
  recheckStreets: number;
  failedStreets: number;
  currentStreet: string | null;
};
let streetRegistryNetworkProgress: StreetRegistryNetworkProgress | null = null;

let streetRunActive = false;
let streetRunCancellationRequested = false;
let streetRunAbandonRequested = false;
let activeStreetBrowser: { close: () => Promise<void> } | null = null;
let streetRunPromise: Promise<void> | null = null;
let streetRunCheckpoint: SisterStreetRunCheckpoint | null = null;
let streetRunError: string | null = null;
let streetRunProgress: SisterStreetRunProgress | null = null;
let networkRunActive = false;
let networkRunCancellationRequested = false;
let activeNetworkBrowser: { close: () => Promise<void> } | null = null;
let networkRunPromise: Promise<void> | null = null;
let networkRunCheckpoint: SisterNetworkRunCheckpoint | null = null;
let networkRunError: string | null = null;
let networkRunProgress: SisterNetworkRunProgress | null = null;
let stopAfterNextImportRequested = false;
let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
let healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
let healthCheckPromise: Promise<ConnectionCheck[]> | null = null;
let browserCheckTimer: ReturnType<typeof setTimeout> | null = null;
let browserCheckPromise: Promise<BrowserConnectionCheck[]> | null = null;
let browserConnectionStability: BrowserConnectionStability = EMPTY_BROWSER_CONNECTION_STABILITY;
let connectionChecks: ConnectionCheck[] = [];
let connectionChecksAt: string | null = null;
let updateCheckTimer: ReturnType<typeof setTimeout> | null = null;
let desktopUpdater: DesktopUpdater | null = null;
let stoppingAll = false;
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
let activityLogBuffer: string[] = [];
let activityLogFlushTimer: ReturnType<typeof setTimeout> | null = null;
let activityLogDirectoryReady = false;
let diagnosticErrors: DiagnosticErrorItem[] = [];

type SnapshotRemoteData = {
  jobs: Awaited<ReturnType<WorkerRepository["listJobs"]>>;
  completedImports: Array<CompletedImportSummary & {
    job: Awaited<ReturnType<WorkerRepository["getJob"]>>;
  }>;
  completedImportsHasMore: boolean;
  publicConfig: Record<string, unknown>;
  configError: string | null;
  cloudError: string | null;
  latestRequestImport: Awaited<ReturnType<WorkerRepository["latestRequestImportRun"]>>;
  requestImportSchemaError: string | null;
  latestMandateImport: Awaited<ReturnType<WorkerRepository["latestMandateImportRun"]>>;
  mandateImportSchemaError: string | null;
};

const emptySnapshotRemoteData = (): SnapshotRemoteData => ({
  jobs: [], completedImports: [], completedImportsHasMore: false, publicConfig: {}, configError: null, cloudError: null,
  latestRequestImport: null, requestImportSchemaError: null, latestMandateImport: null, mandateImportSchemaError: null,
});
let snapshotRemoteData = emptySnapshotRemoteData();
let snapshotRemoteLoadedAt = 0;
let snapshotRemotePromise: Promise<SnapshotRemoteData> | null = null;
let snapshotRemoteRevision = 0;
let repositoryCache: { url: string; serviceRoleKey: string; value: WorkerRepository } | null = null;
const completedSummaryCache = new Map<string, {
  version: string;
  summary: CompletedImportSummary;
}>();
let publishStatePromise: Promise<void> | null = null;
let publishStateQueued = false;
let operationReservation: "worker" | "street" | "network" | "requests" | "mandates" | "import-v2-diagnostics" | null = null;

type ConnectionCheck = BrowserConnectionCheck | {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  state?: "ready" | "missing" | "login" | "unreachable" | "configuration";
};

async function withOperationTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: tempo massimo superato`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resetStaleOperationState() {
  if (operationReservation) return;
  if (active && !activeRunPromise) active = false;
  if (requestImportActive && !requestImportPromise) requestImportActive = false;
  if (mandateImportActive && !mandateImportPromise) mandateImportActive = false;
  if (streetRunActive && !streetRunPromise) streetRunActive = false;
  if (networkRunActive && !networkRunPromise) networkRunActive = false;
  refreshStoppingAll();
}

function reserveOperation(kind: NonNullable<typeof operationReservation>) {
  resetStaleOperationState();
  if (operationReservation || active || requestImportActive || mandateImportActive || streetRunActive || networkRunActive) {
    throw new Error("Attendi la fine della lavorazione già in esecuzione");
  }
  operationReservation = kind;
}

function releaseOperationReservation(kind: NonNullable<typeof operationReservation>) {
  if (operationReservation === kind) operationReservation = null;
}

function flushActivityLog() {
  if (activityLogFlushTimer) clearTimeout(activityLogFlushTimer);
  activityLogFlushTimer = null;
  if (!activityLogBuffer.length) return activityLogWrite;
  const batch = activityLogBuffer.join("");
  activityLogBuffer = [];
  activityLogWrite = activityLogWrite
    .then(async () => {
      if (!activityLogDirectoryReady) {
        await mkdir(path.dirname(operationLogPath()), { recursive: true });
        activityLogDirectoryReady = true;
      }
      await appendFile(operationLogPath(), batch, "utf8");
    })
    .catch(() => undefined);
  return activityLogWrite;
}

function pushActivity(message: string, tone: ActivityItem["tone"] = "info") {
  const entry = { at: new Date().toISOString(), tone, message: sanitizeSensitiveText(message) } satisfies ActivityItem;
  activity.unshift(entry);
  activity.splice(300);
  activityLogBuffer.push(`${JSON.stringify(entry)}\n`);
  if (tone !== "info" || activityLogBuffer.length >= 50) void flushActivityLog();
  else if (!activityLogFlushTimer) {
    activityLogFlushTimer = setTimeout(() => void flushActivityLog(), 250);
    activityLogFlushTimer.unref?.();
  }
  return entry;
}

function publishTransientUpdate(update: {
  propertyProgress?: typeof propertyProgress;
  retryMonitor?: typeof retryMonitor;
  requestImportProgress?: typeof requestImportProgress;
  mandateImportProgress?: typeof mandateImportProgress;
  networkRunProgress?: typeof networkRunProgress;
  streetRunCheckpoint?: typeof streetRunCheckpoint;
  networkRunCheckpoint?: typeof networkRunCheckpoint;
  sisterKeepAlive?: typeof sisterKeepAlive;
  connections?: { checks: ConnectionCheck[]; checkedAt: string | null; checking: boolean };
  activityItem?: ActivityItem;
}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:transient-update", update);
}

function updateRetryMonitor(runType: RetryMonitorState["runType"], telemetry: RetryTelemetry) {
  retryMonitor = { ...telemetry, runType, updatedAt: new Date().toISOString() };
  publishTransientUpdate({ retryMonitor });
}

function beginRetryMonitor(runType: RetryMonitorState["runType"], operation: string) {
  updateRetryMonitor(runType, { operation, attempt: 1, maximumAttempts: 3, status: "running", nextRetryAt: null });
}

function clearRetryMonitor() {
  retryMonitor = null;
}

function bringWorkerToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (attentionTimer) clearTimeout(attentionTimer);
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.moveTop();
  mainWindow.focus();
  mainWindow.flashFrame(true);
  attentionTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.flashFrame(false);
  }, 1_200);
  attentionTimer.unref?.();
}

function reportRunInterruption(runType: RetryMonitorState["runType"], operation: string) {
  const current = retryMonitor?.runType === runType ? retryMonitor : null;
  updateRetryMonitor(runType, {
    operation,
    attempt: current?.attempt ?? 3,
    maximumAttempts: current?.maximumAttempts ?? 3,
    status: "exhausted",
    nextRetryAt: null,
  });
  bringWorkerToFront();
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "desktop-preferences.json");
}

function streetRunCheckpointPath() {
  return path.join(app.getPath("userData"), "sister-street-run.json");
}

function networkRunCheckpointPath() {
  return path.join(app.getPath("userData"), "sister-network-run.json");
}

function diagnosticErrorsPath() {
  return path.join(app.getPath("userData"), "worker-errors.json");
}

function operationLogPath() {
  return path.join(app.getPath("userData"), "worker-operations.ndjson");
}

function importV2DiagnosticPath() {
  return path.join(app.getPath("userData"), "tecnocloud-import-v2-diagnostic.json");
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
    if (typeof entry === "string") return sanitizeSensitiveText(entry);
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
    message: sanitizeSensitiveText(values.message),
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

async function loadNetworkRunCheckpoint() {
  try {
    networkRunCheckpoint = JSON.parse(await readFile(networkRunCheckpointPath(), "utf8")) as SisterNetworkRunCheckpoint;
  } catch {
    networkRunCheckpoint = null;
  }
}

async function persistNetworkRunCheckpoint(checkpoint: SisterNetworkRunCheckpoint) {
  const target = networkRunCheckpointPath();
  const temporary = `${target}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, JSON.stringify(checkpoint, null, 2), "utf8");
  await rename(temporary, target);
  networkRunCheckpoint = checkpoint;
}

async function archiveStreetRunCheckpoint(reason: string) {
  const checkpoint = streetRunCheckpoint;
  if (!checkpoint) return null;
  if (checkpoint.importJobId) {
    try {
      await repository().updateJob(checkpoint.importJobId, {
        status: "paused",
        saved_at: new Date().toISOString(),
        error_message: reason,
        error_details: { action: "street-run-abandoned", checkpointStatus: checkpoint.status },
      });
    } catch {
      pushActivity("Checkpoint locale archiviato; lo stato cloud del job non era raggiungibile", "warning");
    }
  }
  const source = streetRunCheckpointPath();
  const archived = path.join(path.dirname(source), `sister-street-run.abandoned.${Date.now()}.json`);
  try {
    await rename(source, archived);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  streetRunCheckpoint = null;
  streetRunProgress = null;
  streetRunError = null;
  pushActivity(`Checkpoint via abbandonato e archiviato: ${checkpoint.requestedStreet}`, "success");
  return archived;
}

function refreshStoppingAll() {
  if (!active && !requestImportActive && !mandateImportActive && !streetRunActive && !networkRunActive) stoppingAll = false;
}

/**
 * Fino alla 0.14 la scelta era un interruttore: `autoFillDirectContact`.
 * Adesso le modalità sono tre, e il vecchio valore va tradotto — chi aveva
 * spento l'interruttore voleva l'attività generica, non «nessuna attività».
 */
function migratePreferences(stored: Partial<Preferences> & { autoFillDirectContact?: boolean }): Preferences {
  const { autoFillDirectContact, ...rest } = stored;
  const mode = rest.propertyActivityMode
    ?? (autoFillDirectContact === false ? "plain" : "direct_contact");
  return { ...defaultPreferences, ...rest, propertyActivityMode: mode };
}

async function loadPreferences() {
  try {
    preferences = migratePreferences(JSON.parse(await readFile(preferencesPath(), "utf8")));
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
  streetRegistrySelectedZoneId = preferences.streetRegistryZoneId ?? null;
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
  Object.assign(values, readBundledEnvironment());
  return values;
}

function readBundledEnvironment(): Record<string, string> {
  const bundledPath = app.isPackaged
    ? path.join(process.resourcesPath, "worker-config.json")
    : path.join(workerRoot, "generated", "worker-config.json");
  if (!existsSync(bundledPath)) return {};
  try {
    return JSON.parse(readFileSync(bundledPath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function internalEnvironment(): Record<string, string> {
  if (preferences.encryptedEnvironment && safeStorage.isEncryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(preferences.encryptedEnvironment, "base64"))) as Record<string, string>;
    } catch { /* Prova le origini di migrazione. */ }
  }
  return readEnvironmentFiles(preferences.environmentFilePath);
}

function normalizedSupabaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/$/, "").toLowerCase() ?? "";
}

/**
 * Le preferenze cifrate sopravvivono a disinstallazione e aggiornamento per
 * non chiedere a ogni release una nuova configurazione. Se però il prodotto
 * passa a un altro progetto Supabase, riutilizzare URL e chiave precedenti è
 * pericoloso e porta a un errore generico. Il pacchetto contiene il nuovo URL
 * pubblico, non la service-role: rileviamo il cambio e chiediamo la chiave al
 * proprietario invece di copiarla o esporla nel binario.
 */
function archivedDatabaseConfigurationNeedsRefresh() {
  if (!app.isPackaged || !preferences.encryptedEnvironment) return false;
  const bundledUrl = normalizedSupabaseUrl(readBundledEnvironment().NEXT_PUBLIC_SUPABASE_URL);
  const configuredUrl = normalizedSupabaseUrl(internalEnvironment().NEXT_PUBLIC_SUPABASE_URL);
  return Boolean(bundledUrl && configuredUrl && bundledUrl !== configuredUrl);
}

const ARCHIVED_DATABASE_CONFIGURATION_MESSAGE =
  "L’archivio dati è stato spostato. Questa installazione conserva ancora il collegamento al progetto precedente. "
  + "Apri Impostazioni → Configurazione avanzata e inserisci la chiave service-role del nuovo archivio; il worker non la include nell’installer per sicurezza.";

/**
 * La configurazione, ricostruita solo quando cambia.
 *
 * `workerConfig()` sembrava una lettura da niente, ed e' il pezzo di codice
 * piu' chiamato dell'app: il controllo di Chrome la chiede ogni due secondi,
 * il riepilogo cloud ogni dieci, i controlli ogni trenta. Ogni volta faceva
 * per intero il lavoro piu' caro che ci sia qui dentro: decifrare la
 * configurazione protetta da Windows, rileggere e sgranare i file `.env`, e
 * rivalidare con Zod tutte le variabili d'ambiente del processo. Tutto
 * sincrono, nel processo che disegna la finestra.
 *
 * La chiave tiene solo cio' da cui la configurazione dipende davvero: appena
 * una preferenza cambia, la chiave cambia con lei e si rilegge.
 */
let configurazioneInCache: { chiave: string; valore: WorkerConfig } | null = null;

function workerConfig(overrides: Partial<Preferences> = {}): WorkerConfig {
  const merged = { ...preferences, ...overrides };
  const chiave = JSON.stringify([
    merged.contactsExcelPath ?? null,
    merged.mode,
    merged.dryRun,
    merged.keepAcquisition,
    merged.environmentFilePath ?? null,
    merged.encryptedEnvironment ?? null,
  ]);
  if (configurazioneInCache?.chiave === chiave) return configurazioneInCache.valore;

  const fileEnvironment = internalEnvironment();
  const valore = loadConfig({
    ...process.env,
    ...fileEnvironment,
    ...(merged.contactsExcelPath ? { CONTACTS_EXCEL_PATH: merged.contactsExcelPath } : {}),
    WORKER_MODE: merged.mode,
    WORKER_DRY_RUN: String(merged.dryRun),
    WORKER_KEEP_ACQUISITION: String(merged.keepAcquisition),
  });
  configurazioneInCache = { chiave, valore };
  return valore;
}

function repository(config = workerConfig()) {
  if (
    repositoryCache?.url === config.NEXT_PUBLIC_SUPABASE_URL
    && repositoryCache.serviceRoleKey === config.SUPABASE_SERVICE_ROLE_KEY
  ) return repositoryCache.value;
  const value = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  repositoryCache = { url: config.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY, value };
  completedSummaryCache.clear();
  return value;
}

/* Il lease della coda vive sul database, quindi l'identita' del Worker deve
 * restare la stessa fra un avvio e l'altro: altrimenti dopo un riavvio nessuno
 * potrebbe piu' chiudere la lavorazione che aveva preso in carico. */
function streetRegistryWorkerId() {
  return `worker-desktop:${hostname()}`;
}

function streetRegistryService(config = workerConfig()) {
  return new StreetRegistryService(repository(config).client);
}

/* Le vie senza geometria non hanno rank e restano in fondo: si vedono
 * comunque, perche' nascondere meta' dell'inventario sarebbe peggio che
 * mostrarlo in un ordine imperfetto. */
async function refreshStreetRegistryPreview(limit = 12, zoneId = streetRegistrySelectedZoneId) {
  streetRegistryLoading = true;
  try {
    const service = streetRegistryService();
    const zones = streetRegistryZones.length ? streetRegistryZones : await service.zones();
    const validZoneId = zoneId && zones.some((zone) => zone.id === zoneId) ? zoneId : null;
    streetRegistrySelectedZoneId = validZoneId;
    const [activeClaim, pending] = await Promise.all([
      streetRegistryClaim ? Promise.resolve(streetRegistryClaim) : service.activeClaim(streetRegistryWorkerId()),
      service.list({ status: "pending", zoneId: validZoneId ?? undefined, scope: validZoneId ? "zone" : "city", limit }),
    ]);
    streetRegistryClaim = activeClaim;
    streetRegistryPreview = pending;
    streetRegistryZones = zones;
    streetRegistryError = null;
  } catch (error) {
    streetRegistryPreview = [];
    streetRegistryError = error instanceof Error ? error.message : String(error);
  } finally {
    streetRegistryLoading = false;
  }
}

function stopStreetRegistryLeaseHeartbeat() {
  if (streetRegistryLeaseTimer) clearTimeout(streetRegistryLeaseTimer);
  streetRegistryLeaseTimer = null;
}

function scheduleStreetRegistryLeaseHeartbeat(delayMs = 5 * 60_000) {
  stopStreetRegistryLeaseHeartbeat();
  if (!streetRegistryClaim) return;
  streetRegistryLeaseTimer = setTimeout(async () => {
    const claim = streetRegistryClaim;
    if (!claim) return;
    try {
      streetRegistryClaim = await streetRegistryService().renew({
        workItemId: claim.work_item_id,
        workerId: streetRegistryWorkerId(),
        leaseSeconds: 1800,
      });
      streetRegistryError = null;
      scheduleStreetRegistryLeaseHeartbeat();
    } catch (error) {
      streetRegistryError = `Rinnovo della via ${claim.canonical_name} fallito: ${error instanceof Error ? error.message : String(error)}`;
      pushActivity(streetRegistryError, "warning");
      streetRegistryLeaseTimer = null;
    }
    await publishState();
  }, delayMs);
  streetRegistryLeaseTimer.unref?.();
}

function describeRegistryStreet(item: StreetRegistryQueueItem) {
  const posizione = item.city_rank == null
    ? "senza posizione geografica"
    : `${item.city_rank}ª dal centro${item.city_distance_m == null ? "" : `, ${Math.round(item.city_distance_m)} m`}`;
  return `${item.canonical_name} (${posizione}${item.zone_name ? `, ${item.zone_name}` : ""})`;
}

/* La chiusura non deve mai far fallire la run: se il registro non risponde la
 * lavorazione resta con il lease, che scade da solo e la rimette in coda. */
async function closeStreetRegistryClaim(
  outcome: StreetRegistryOutcome,
  details: { jobId?: string | null; result?: Record<string, unknown>; error?: Record<string, unknown> },
) {
  const claim = streetRegistryClaim;
  if (!claim) return;
  stopStreetRegistryLeaseHeartbeat();
  streetRegistryClaim = null;
  streetRegistryLastOutcome = outcome;
  try {
    await streetRegistryService().complete({
      workItemId: claim.work_item_id,
      workerId: streetRegistryWorkerId(),
      outcome,
      propertyWorkerJobId: details.jobId ?? undefined,
      result: details.result,
      error: details.error,
    });
    pushActivity(`Via ${claim.canonical_name} chiusa nel registro come ${outcome}`, outcome === "completed" ? "success" : "warning");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streetRegistryLastOutcome = "to_recheck";
    streetRegistryError = `Chiusura della via nel registro non riuscita: ${message}`;
    pushActivity(`${streetRegistryError} Il lease scadra' da solo e la via tornera' in coda.`, "warning");
  }
  await refreshStreetRegistryPreview().catch(() => undefined);
}

/**
 * Una run che si ferma prima di acquisire qualcosa non è un'acquisizione.
 *
 * La lavorazione nasce all'inizio della run e `setJobContext` la porta subito
 * a «running». Se poi la run muore al primo passo — SISTER non preparato,
 * nessun seme da cui partire — quella riga resta lì, e il pannello la mostra
 * fra le «Pronte da importare» con zero immobili: importarla non farebbe
 * niente. Qui la riga vuota viene tolta.
 *
 * Se invece qualcosa era già stato raccolto, la lavorazione resta e prende i
 * totali veri: è da lì che si riprende. I totali arrivano dal database
 * perché durante la run non vengono aggiornati riga per riga, e una
 * lavorazione interrotta a metà mostrerebbe altrimenti zero immobili pur
 * avendone.
 */
async function chiudiAcquisizioneInterrotta(jobId: string | null, motivo: string) {
  if (!jobId) return;
  try {
    const repo = repository(workerConfig({ dryRun: false }));
    const totali = await repo.countAcquisition(jobId);
    if (!totali.properties) {
      await repo.deleteJob(jobId);
      pushActivity("Nessun immobile acquisito: la lavorazione vuota non resta fra le acquisizioni.", "info");
      return;
    }
    await repo.updateJob(jobId, {
      total_properties: totali.properties,
      total_people: totali.people,
      status: "paused",
      saved_at: new Date().toISOString(),
      error_message: motivo,
    });
    pushActivity(`Acquisizione interrotta con ${totali.properties} immobili già raccolti: resta salvata e riprendibile.`, "warning");
  } catch (error) {
    pushActivity(
      `Lavorazione interrotta non ripulita: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}

async function purgeJob(jobId: string) {
  const config = workerConfig();
  const repo = repository(config);
  const screenshotPaths = await repo.listJobScreenshotPaths(jobId);
  await repo.deleteJob(jobId);
  snapshotRemoteRevision += 1;
  snapshotRemoteData = {
    ...snapshotRemoteData,
    jobs: snapshotRemoteData.jobs.filter((job) => job.id !== jobId),
    completedImports: snapshotRemoteData.completedImports.filter(({ job }) => job.id !== jobId),
  };
  snapshotRemoteLoadedAt = Date.now();
  completedSummaryCache.delete(jobId);
  const cleanup = await removeDiagnosticScreenshots(config.ERROR_SCREENSHOT_DIR, screenshotPaths);
  if (cleanup.failed.length) {
    pushActivity(`${cleanup.failed.length} screenshot non rimossi; verranno gestiti dalla pulizia automatica`, "warning");
  }
  return cleanup;
}

async function refreshSnapshotRemoteData() {
  if (snapshotRemotePromise) return snapshotRemotePromise;
  const revision = snapshotRemoteRevision;
  snapshotRemotePromise = (async (): Promise<SnapshotRemoteData> => {
    const next = emptySnapshotRemoteData();
    let config: WorkerConfig;
    try {
      config = workerConfig();
      next.publicConfig = {
        configurationReady: true,
        configurationSource: preferences.encryptedEnvironment ? "Protetta da Windows" : "Inclusa nell'app",
        contactsExcelPath: config.CONTACTS_EXCEL_PATH,
        chromeCdpUrl: config.CHROME_CDP_URL,
        screenshotDirectory: config.ERROR_SCREENSHOT_DIR,
        operationLogPath: operationLogPath(),
        sisterKeepAliveEnabled: config.SISTER_KEEPALIVE_ENABLED,
        sisterKeepAliveInterval: `${config.SISTER_KEEPALIVE_MIN_SECONDS}-${config.SISTER_KEEPALIVE_MAX_SECONDS} secondi`,
      };
      if (archivedDatabaseConfigurationNeedsRefresh()) {
        next.cloudError = ARCHIVED_DATABASE_CONFIGURATION_MESSAGE;
        if (snapshotRemoteRevision === revision) {
          snapshotRemoteData = next;
          snapshotRemoteLoadedAt = Date.now();
        }
        return next;
      }
    } catch (error) {
      next.configError = error instanceof Error ? error.message : String(error);
      if (snapshotRemoteRevision === revision) {
        snapshotRemoteData = next;
        snapshotRemoteLoadedAt = Date.now();
      }
      return next;
    }
    try {
      const repo = repository(config);

      /* Le due sincronizzazioni d'archivio non dipendono dai job: aspettarle in
       * fila costava quattro andate e ritorni al cloud, uno dopo l'altro, a
       * ogni aggiornamento della plancia. Partono adesso, insieme al resto. */
      const richieste = (async () => {
        try {
          await withOperationTimeout(repo.requestArchiveHealthCheck(), 8_000, "Verifica archivio richieste");
          return {
            run: await withOperationTimeout(repo.latestRequestImportRun(), 8_000, "Ultima sincronizzazione richieste"),
            error: null as string | null,
          };
        } catch (error) {
          return { run: null, error: error instanceof Error ? error.message : String(error) };
        }
      })();
      const incarichi = (async () => {
        try {
          await withOperationTimeout(repo.mandateArchiveHealthCheck(), 8_000, "Verifica archivio incarichi");
          return {
            run: await withOperationTimeout(repo.latestMandateImportRun(), 8_000, "Ultima sincronizzazione incarichi"),
            error: null as string | null,
          };
        } catch (error) {
          return { run: null, error: error instanceof Error ? error.message : String(error) };
        }
      })();

      const [savedJobs, completedJobsPage] = await withOperationTimeout(
        Promise.all([repo.listSavedJobs(), repo.listCompletedJobs(completedImportsLimit + 1)]),
        12_000,
        "Aggiornamento riepilogo cloud",
      );
      const completedJobs = completedJobsPage.slice(0, completedImportsLimit);
      next.completedImportsHasMore = completedJobsPage.length > completedImportsLimit;
      next.jobs = savedJobs;
      const visibleCompletedJobIds = new Set(completedJobs.map((job) => job.id));
      for (const jobId of completedSummaryCache.keys()) {
        if (!visibleCompletedJobIds.has(jobId)) completedSummaryCache.delete(jobId);
      }
      next.completedImports = await withOperationTimeout(
        Promise.all(completedJobs.map(async (job) => {
          const version = job.updated_at ?? job.completed_at ?? job.created_at ?? "";
          const cached = completedSummaryCache.get(job.id);
          const summary = cached?.version === version
            ? cached.summary
            : summarizeCompletedGraph(await repo.loadGraph(job.id));
          if (cached?.version !== version) completedSummaryCache.set(job.id, { version, summary });
          return { job, ...summary };
        })),
        15_000,
        "Aggiornamento cronologia import",
      );
      const [esitoRichieste, esitoIncarichi] = await Promise.all([richieste, incarichi]);
      next.latestRequestImport = esitoRichieste.run;
      next.requestImportSchemaError = esitoRichieste.error;
      next.latestMandateImport = esitoIncarichi.run;
      next.mandateImportSchemaError = esitoIncarichi.error;
      if (activeJobId) {
        const activeJob = completedJobs.find((job) => job.id === activeJobId)
          ?? savedJobs.find((job) => job.id === activeJobId)
          ?? await withOperationTimeout(repo.getJob(activeJobId), 8_000, "Verifica lavorazione attiva").catch(() => null);
        if (activeJob?.status === "completed") {
          currentStep = "completed";
          propertyProgress = null;
          prompt = null;
          lastError = null;
        }
      }
    } catch (error) {
      next.cloudError = describeSupabaseOperationalError(error);
    }
    if (snapshotRemoteRevision === revision) {
      snapshotRemoteData = next;
      snapshotRemoteLoadedAt = Date.now();
    }
    return next;
  })().finally(() => {
    snapshotRemotePromise = null;
  });
  return snapshotRemotePromise;
}

async function stateSnapshot() {
  /* La plancia non aspetta il cloud per comparire.
   *
   * Al primo disegno il riepilogo remoto veniva atteso: finche' Supabase non
   * rispondeva — e se e' lento o irraggiungibile puo' volerci parecchio — la
   * finestra restava vuota, e sembrava che il programma non partisse. Adesso
   * la plancia si disegna subito con quello che c'e' in casa, e le sezioni
   * che vengono dal cloud si riempiono da sole appena arrivano: la lettura
   * chiama `publishState()` quando ha finito. */
  if (!snapshotRemoteLoadedAt || Date.now() - snapshotRemoteLoadedAt > 10_000) {
    void refreshSnapshotRemoteData().then(() => publishState()).catch(() => undefined);
  }
  const {
    jobs, completedImports, completedImportsHasMore, publicConfig, configError, cloudError,
    latestRequestImport, requestImportSchemaError, latestMandateImport, mandateImportSchemaError,
  } = snapshotRemoteData;
  return {
    active,
    stoppingAll,
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
    retryMonitor,
    prompt,
    lastError,
    operationCompletion,
    sisterKeepAlive,
    connections: { checks: connectionChecks, checkedAt: connectionChecksAt, checking: Boolean(healthCheckPromise) },
    softwareUpdate: desktopUpdater?.snapshot() ?? {
      status: "unavailable", currentVersion: app.getVersion(), availableVersion: null, percent: null,
      transferred: null, total: null, message: "Controllo aggiornamenti non inizializzato", checkedAt: null,
    },
    activity,
    diagnosticErrors,
    preferences,
    config: publicConfig,
    configError,
    cloudError,
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
      checkpoint: streetRunActive ? projectStreetCheckpointForRenderer(streetRunCheckpoint) : null,
      progress: streetRunProgress,
      lastError: streetRunError,
      checkpointPath: streetRunCheckpointPath(),
    },
    streetRegistry: {
      claim: streetRegistryClaim,
      queue: streetRegistryPreview,
      loading: streetRegistryLoading,
      lastError: streetRegistryError,
      workerId: streetRegistryWorkerId(),
      zones: streetRegistryZones,
      selectedZoneId: streetRegistrySelectedZoneId,
      network: {
        active: networkRunActive,
        stopping: networkRunCancellationRequested,
        progress: streetRegistryNetworkProgress,
        lastError: networkRunError,
      },
    },
    networkRun: {
      active: networkRunActive,
      cancelling: networkRunCancellationRequested,
      checkpoint: networkRunActive ? networkRunCheckpoint : null,
      progress: networkRunProgress,
      lastError: networkRunError,
      checkpointPath: networkRunCheckpointPath(),
    },
    stopAfterNextImport: stopAfterNextImportRequested,
    version: app.getVersion(),
  };
}

function scheduleUpdateCheck(delayMs = 12_000) {
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  updateCheckTimer = setTimeout(async () => {
    try {
      await desktopUpdater?.check();
    } finally {
      scheduleUpdateCheck(6 * 60 * 60 * 1_000);
    }
  }, delayMs);
  updateCheckTimer.unref?.();
}

function initializeDesktopUpdater() {
  let previousStatus: DesktopUpdateState["status"] | null = null;
  desktopUpdater = new DesktopUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    updateDirectory: path.join(app.getPath("temp"), "PropertyDataWorkerUpdates"),
    isWorkerActive: () => active || requestImportActive || mandateImportActive || streetRunActive || networkRunActive,
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
}

async function handleRequestImportEvent(event: RequestArchiveImportEvent) {
  let activityItem: ActivityItem | undefined;
  if (event.type === "index") {
    requestImportProgress = { runId: null, index: event.page, total: 0, title: `${event.discovered} richieste individuate`, externalId: null, failed: 0, phase: "index" };
    activityItem = pushActivity(`Archivio richieste: pagina ${event.page}, ${event.discovered} voci individuate`);
  } else if (event.type === "retry") {
    requestImportProgress = { runId: event.runId, index: event.index, total: event.total, title: event.title, externalId: event.externalId, failed: requestImportProgress?.failed ?? 0, phase: "detail" };
    updateRetryMonitor("requests", event.telemetry);
  } else if (event.type === "progress") {
    requestImportProgress = { runId: event.runId, index: event.index, total: event.total, title: event.title, externalId: event.externalId, failed: event.failed, phase: "detail" };
    activityItem = pushActivity(`Archivio richieste: voce ${event.index}/${event.total} · ${event.title}`);
  } else {
    requestImportProgress = { runId: event.run.id, index: event.run.processed_requests + event.run.failed_requests, total: event.run.total_requests, title: "Sincronizzazione conclusa", externalId: null, failed: event.run.failed_requests, phase: "detail" };
  }
  publishTransientUpdate({ requestImportProgress, activityItem });
}

async function runRequestArchiveImport(resumeRunId?: string) {
  reserveOperation("requests");
  try {
    requireCloudAvailable(await healthChecks({ silent: true }));
  } catch (error) {
    releaseOperationReservation("requests");
    throw error;
  }
  requestImportActive = true;
  operationCompletion = null;
  requestImportCancellationRequested = false;
  requestImportError = null;
  requestImportProgress = null;
  beginRetryMonitor("requests", "Sincronizzazione richieste CRM");
  pushActivity(resumeRunId ? "Ripresa sincronizzazione archivio richieste" : "Sincronizzazione archivio richieste avviata");
  await publishState();
  const importer = new RequestArchiveImporter(workerConfig(), repository(), {
    isCancelled: () => requestImportCancellationRequested,
    isStopAfterNextImportRequested: () => stopAfterNextImportRequested,
    onEvent: handleRequestImportEvent,
  });
  activeRequestImporter = importer;
  const runPromise = importer.run(resumeRunId).then((run) => {
    clearRetryMonitor();
    if (run.status === "cancelled") pushActivity("Sincronizzazione richieste interrotta: l’avanzamento è stato salvato", "warning");
    else if (run.failed_requests) pushActivity(`Sincronizzazione conclusa con ${run.failed_requests} richieste da riprovare`, "warning");
    else if (run.status === "completed") {
      operationCompletion = {
        kind: "requests",
        title: "Sincronizzazione richieste completata",
        summary: "L’archivio richieste è aggiornato e non ci sono elementi da riprovare.",
        completedAt: run.completed_at ?? run.updated_at ?? new Date().toISOString(),
        stats: [
          { label: "Richieste sincronizzate", value: run.processed_requests },
          { label: "Da riprovare", value: 0 },
        ],
      };
      pushActivity(`${run.processed_requests} richieste immobiliari sincronizzate`, "success");
    } else pushActivity("Sincronizzazione richieste conclusa senza conferma completa: controlla il riepilogo prima di proseguire", "warning");
  }).catch((error) => {
    if (requestImportCancellationRequested) {
      clearRetryMonitor();
      pushActivity("Sincronizzazione richieste interrotta dall'operatore", "warning");
      return;
    }
    requestImportError = error instanceof Error ? error.message : String(error);
    reportRunInterruption("requests", "Sincronizzazione richieste interrotta");
    pushActivity(requestImportError, "error");
    void recordDiagnosticErrorSafely({
      source: "request-archive",
      status: "failed",
      message: requestImportError,
      jobId: resumeRunId ?? null,
      details: { operation: "request-archive-import", resume: Boolean(resumeRunId) },
    }, { publish: true });
  }).finally(async () => {
    requestImportPromise = null;
    activeRequestImporter = null;
    requestImportActive = false;
    requestImportCancellationRequested = false;
    stopAfterNextImportRequested = false;
    refreshStoppingAll();
    await publishState();
  });
  requestImportPromise = runPromise;
  releaseOperationReservation("requests");
  void runPromise;
}

async function handleMandateImportEvent(event: MandateArchiveImportEvent) {
  let activityItem: ActivityItem | undefined;
  if (event.type === "index") {
    mandateImportProgress = { runId: null, index: event.page, total: 0, title: `${event.discovered} incarichi individuati`, externalId: null, failed: 0, phase: "index" };
    activityItem = pushActivity(`Archivio incarichi: pagina ${event.page}, ${event.discovered} voci individuate`);
  } else if (event.type === "retry") {
    mandateImportProgress = { runId: event.runId, index: event.index, total: event.total, title: event.title, externalId: event.externalId, failed: mandateImportProgress?.failed ?? 0, phase: "detail" };
    updateRetryMonitor("mandates", event.telemetry);
  } else if (event.type === "progress") {
    mandateImportProgress = { runId: event.runId, index: event.index, total: event.total, title: event.title, externalId: event.externalId, failed: event.failed, phase: "detail" };
    activityItem = pushActivity(`Archivio incarichi: voce ${event.index}/${event.total} · ${event.title}`);
  } else {
    mandateImportProgress = { runId: event.run.id, index: event.run.processed_mandates + event.run.failed_mandates, total: event.run.total_mandates, title: "Sincronizzazione conclusa", externalId: null, failed: event.run.failed_mandates, phase: "detail" };
  }
  publishTransientUpdate({ mandateImportProgress, activityItem });
}

async function runMandateArchiveImport(resumeRunId?: string) {
  reserveOperation("mandates");
  try {
    requireCloudAvailable(await healthChecks({ silent: true }));
  } catch (error) {
    releaseOperationReservation("mandates");
    throw error;
  }
  mandateImportActive = true;
  operationCompletion = null;
  mandateImportCancellationRequested = false;
  mandateImportError = null;
  mandateImportProgress = null;
  beginRetryMonitor("mandates", "Sincronizzazione incarichi CRM");
  pushActivity(resumeRunId ? "Ripresa sincronizzazione archivio incarichi" : "Sincronizzazione archivio incarichi avviata");
  await publishState();
  const importer = new MandateArchiveImporter(workerConfig(), repository(), {
    isCancelled: () => mandateImportCancellationRequested,
    isStopAfterNextImportRequested: () => stopAfterNextImportRequested,
    onEvent: handleMandateImportEvent,
  });
  activeMandateImporter = importer;
  const runPromise = importer.run(resumeRunId).then((run) => {
    clearRetryMonitor();
    if (run.status === "cancelled") pushActivity("Sincronizzazione incarichi interrotta: l'avanzamento è stato salvato", "warning");
    else if (run.failed_mandates) pushActivity(`Sincronizzazione conclusa con ${run.failed_mandates} incarichi da riprovare`, "warning");
    else if (run.status === "completed") {
      operationCompletion = {
        kind: "mandates",
        title: "Sincronizzazione incarichi completata",
        summary: "Il portafoglio incarichi è aggiornato e non ci sono elementi da riprovare.",
        completedAt: run.completed_at ?? run.updated_at ?? new Date().toISOString(),
        stats: [
          { label: "Incarichi sincronizzati", value: run.processed_mandates },
          { label: "Da riprovare", value: 0 },
        ],
      };
      pushActivity(`${run.processed_mandates} immobili con incarico sincronizzati`, "success");
    } else pushActivity("Sincronizzazione incarichi conclusa senza conferma completa: controlla il riepilogo prima di proseguire", "warning");
  }).catch((error) => {
    if (mandateImportCancellationRequested) {
      clearRetryMonitor();
      pushActivity("Sincronizzazione incarichi interrotta dall'operatore", "warning");
      return;
    }
    mandateImportError = error instanceof Error ? error.message : String(error);
    reportRunInterruption("mandates", "Sincronizzazione incarichi interrotta");
    pushActivity(mandateImportError, "error");
    void recordDiagnosticErrorSafely({
      source: "mandate-archive",
      status: "failed",
      message: mandateImportError,
      jobId: resumeRunId ?? null,
      details: { operation: "mandate-archive-import", resume: Boolean(resumeRunId) },
    }, { publish: true });
  }).finally(async () => {
    mandateImportPromise = null;
    activeMandateImporter = null;
    mandateImportActive = false;
    mandateImportCancellationRequested = false;
    stopAfterNextImportRequested = false;
    refreshStoppingAll();
    await publishState();
  });
  mandateImportPromise = runPromise;
  releaseOperationReservation("mandates");
  void runPromise;
}

async function runSisterStreet(input: {
  street: string;
  resume: boolean;
  dryRun: boolean;
  filters?: Partial<StreetPropertyFilters>;
  registryNetwork?: boolean;
}) {
  const street = input.street.replace(/\s+/g, " ").trim();
  const filters = normalizeStreetPropertyFilters(input.filters);
  if (street.length < 4) throw new Error("Inserisci il nome completo della via");
  const resumeCheckpoint = input.resume ? streetRunCheckpoint ?? undefined : undefined;
  if (input.resume && !resumeCheckpoint) throw new Error("Non esiste una scansione da riprendere");
  const longRunMode = input.resume && resumeCheckpoint
    ? (resumeCheckpoint.mode === "live" ? "live" : "dry_run")
    : (input.dryRun ? "dry_run" : "live");
  const ownsOperationReservation = !input.registryNetwork;
  if (ownsOperationReservation) reserveOperation("street");
  try {
    const checks = await healthChecks({ silent: true });
    if (longRunMode === "live") requireCloudAvailable(checks);
    if (!input.resume && streetRunCheckpoint) {
      await archiveStreetRunCheckpoint("Checkpoint precedente archiviato prima di una nuova run via");
    }
  } catch (error) {
    if (ownsOperationReservation) releaseOperationReservation("street");
    throw error;
  }
  streetRunActive = true;
  operationCompletion = null;
  streetRunCancellationRequested = false;
  streetRunAbandonRequested = false;
  streetRunError = null;
  streetRunProgress = null;
  beginRetryMonitor("street", "Acquisizione via SISTER");
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
  let registryOutcome: StreetRegistryOutcome | null = null;
  let registryResult: Record<string, unknown> | undefined;
  let registryError: Record<string, unknown> | undefined;
  const runPromise = connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH).then(async (tabs) => {
    activeStreetBrowser = tabs.browser;
    try {
      if (streetRunAbandonRequested) return;
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
        filters,
        acquireOwners: true,
        /* La via la cerca il worker. Prima toccava all'operatore portare SISTER
         * fino all'Elenco indirizzi, e una run avviata su una pagina qualsiasi
         * moriva al primo passo. La preparazione sceglie BITONTO, il toponimo
         * che corrisponde e la dizione esatta: le omonimie restano filtrate
         * dalla stessa regola di prima, quindi traverse, vie private e contrade
         * continuano a non entrare. Vale anche a run avviata: se la pagina si
         * perde per strada, viene rifatta invece di fermare tutto. */
        prepareSearchAutomatically: true,
        isCancelled: () => streetRunCancellationRequested,
        onPropertyAcquired: liveRepository && importJobId ? async (variant, property, owners) => {
          const [savedProperty] = await liveRepository.insertProperties(importJobId!, [{
            ...property,
            rawPayload: {
              ...property.rawPayload,
              long_run: { strategy: "bulk_exact_variants", variantId: variant.sourceId, filters, acquiredAt: new Date().toISOString() },
            },
          }], { updateJobTotal: false });
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
        onRetryTelemetry: (telemetry) => updateRetryMonitor("street", telemetry),
        onCheckpoint: async (checkpoint) => {
          await persistStreetRunCheckpoint(checkpoint);
          publishTransientUpdate({
            streetRunCheckpoint: projectStreetCheckpointForRenderer(checkpoint),
          });
        },
      });
      const result = await scanner.run(street, resumeCheckpoint);
      if (["completed", "paused"].includes(result.status)) clearRetryMonitor();
      if (liveRepository && result.importJobId) {
        const graph = await liveRepository.loadGraph(result.importJobId);
        const queue = inspectAcquisitionQueue(graph);
        let { activeProperties, activePeople } = queue;
        const { incompleteProperties, incompletePeople, propertiesWithoutOwners, invalidOwnerships, missingPersonIds,
          invalidProperties: invalidLongRunProperties } = queue;
        for (const [propertyId, reason] of invalidLongRunProperties) {
          await markCaseSkipped(result.importJobId, propertyId, { source: "automatic", reason, attempts: 0, status: "acquisition_skipped" }, liveRepository);
        }
        if (invalidLongRunProperties.size) {
          const refreshedGraph = await liveRepository.loadGraph(result.importJobId);
          ({ activeProperties, activePeople } = inspectAcquisitionQueue(refreshedGraph));
          pushActivity(`${invalidLongRunProperties.size} immobili esclusi dalla long run per dati incompleti; continuo con gli elementi validi`, "warning");
        }

        if (result.status === "completed" && graph.properties.length === 0) {
          await liveRepository.deleteJob(result.importJobId);
          streetImportJobId = null;
          streetRunError = null;
        } else {
          await liveRepository.markGraphNormalized(activeProperties, activePeople);
          const totals = { total_properties: graph.properties.length, total_people: graph.people.length };
          if (result.status === "completed" && activeProperties.length && activePeople.length) {
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
            streetRunError = null;
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
                invalidOwnershipIds: invalidOwnerships.map(ownership => ownership.id), missingPersonIds,
              },
            });
            streetRunError = message;
          }
        }
      }
      pushActivity(
        result.status === "completed"
          ? `${longRunMode === "dry_run" ? "Dry-run" : "Acquisizione reale"} via completata: ${result.totalAcceptedProperties} immobili unici e ${result.totalOwnersRead} proprietari letti`
          : `${longRunMode === "dry_run" ? "Dry-run" : "Run reale"} via sospesa dopo ${result.currentVariantIndex} varianti`,
        result.status === "completed" ? "success" : "warning",
      );
      /* Una run sospesa non e' una via fallita: torna in coda come da
       * ricontrollare, cosi' la ripresa non consuma un tentativo per niente. */
      registryOutcome = streetRunRegistryOutcome({ status: result.status, lastError: result.lastError, runError: streetRunError });
      registryResult = {
        status: result.status,
        mode: longRunMode,
        accepted_properties: result.totalAcceptedProperties,
        owners_read: result.totalOwnersRead,
      };
      registryError = streetRunError ? { message: streetRunError } : undefined;
      if (result.status === "completed" && !result.lastError && !streetRunError) {
        operationCompletion = {
          kind: "street",
          title: longRunMode === "dry_run" ? "Dry-run della via completato" : "Acquisizione della via completata",
          summary: jobToImport
            ? "La raccolta è conclusa. Ora completo automaticamente l’import nel gestionale."
            : "La run ha concluso tutte le varianti esatte previste.",
          completedAt: result.completedAt ?? result.updatedAt ?? new Date().toISOString(),
          stats: [
            { label: "Immobili distinti", value: result.totalAcceptedProperties },
            { label: "Proprietari letti", value: result.totalOwnersRead },
          ],
        };
      }
    } finally {
      activeStreetBrowser = null;
      await tabs.browser.close().catch(() => undefined);
    }
  }).catch(async (error) => {
    if (streetRunAbandonRequested) {
      clearRetryMonitor();
      pushActivity("Run via arrestata dall'operatore", "warning");
      return;
    }
    streetRunError = error instanceof Error ? error.message : String(error);
    registryOutcome = "failed";
    registryError = { message: streetRunError };
    reportRunInterruption("street", "Acquisizione via interrotta");
    pushActivity(streetRunError, "error");
    await chiudiAcquisizioneInterrotta(streetImportJobId, streetRunError);
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
    if (streetRunAbandonRequested) {
      await archiveStreetRunCheckpoint("Run via interrotta e abbandonata dall'operatore").catch((error) => {
        streetRunError = `Checkpoint non archiviato: ${error instanceof Error ? error.message : String(error)}`;
      });
      streetRunAbandonRequested = false;
      jobToImport = null;
      /* Anche fermare la run a mano puo' lasciare una lavorazione senza
       * niente dentro: vale lo stesso rimedio del fallimento. */
      await chiudiAcquisizioneInterrotta(streetImportJobId, "Run via interrotta dall'operatore.");
    }
    refreshStoppingAll();
    await publishState();
    if (jobToImport) {
      try {
        pushActivity("Acquisizione bulk completata: avvio l'import automatico degli immobili salvati", "success");
        await repository(config).markImportStarted(jobToImport);
        await runWorker({ mode: "automatic", dryRun: false, jobId: jobToImport, registryNetwork: input.registryNetwork });
        const importPromise = activeRunPromise;
        if (importPromise) await importPromise;
        const importedJob = await repository(config).getJob(jobToImport);
        if (importedJob.status !== "completed") {
          registryOutcome = "to_recheck";
          registryError = { message: importedJob.error_message ?? lastError ?? "Import CRM non completato" };
        } else {
          registryOutcome = "completed";
          registryResult = { ...registryResult, import_status: "completed" };
        }
      } catch (error) {
        operationCompletion = null;
        const message = `Acquisizione salvata, ma avvio import non riuscito: ${error instanceof Error ? error.message : String(error)}`;
        streetRunError = message;
        registryOutcome = "to_recheck";
        registryError = { message };
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
    /* La via e' completata solo dopo l'eventuale import CRM. Qualunque uscita
     * non classificata torna da ricontrollare e non resta bloccata nel lease. */
    await closeStreetRegistryClaim(registryOutcome ?? "to_recheck", {
      jobId: streetImportJobId,
      result: registryResult ?? { status: "interrupted", mode: longRunMode },
      error: registryError,
    });
    streetRunPromise = null;
  });
  streetRunPromise = runPromise;
  if (ownsOperationReservation) releaseOperationReservation("street");
  void runPromise;
}

/**
 * Prende dal registro la prossima via e ci avvia sopra la run.
 *
 * L'ordine lo decide il database, non l'interfaccia: prima le vie con rank
 * geografico, dal centro verso fuori, poi quelle senza geometria in ordine di
 * Codvia. La presa in carico e' atomica e lascia un lease, quindi due Worker
 * sulla stessa coda non possono ricevere la stessa via.
 *
 * Solo run reali: una prova a vuoto consumerebbe un tentativo della coda
 * durevole senza portare a casa niente.
 */
async function runNextStreetFromRegistry(input: {
  filters?: Partial<StreetPropertyFilters>;
  registryNetwork?: boolean;
  zoneId?: string | null;
} = {}) {
  /* Il controllo del cloud viene prima della presa in carico: prenderla e poi
   * fallire brucerebbe un tentativo senza aver aperto neanche il browser. */
  requireCloudAvailable(await healthChecks({ silent: true }));
  const service = streetRegistryService();
  const claim = await service.claim({
    workerId: streetRegistryWorkerId(),
    zoneId: input.zoneId ?? undefined,
    scope: input.zoneId ? "zone" : "city",
    leaseSeconds: 1800,
  });
  if (!claim) {
    streetRegistryError = null;
    pushActivity(
      "Nessuna via disponibile nel registro: la coda è esaurita oppure le lavorazioni rimaste sono già prese in carico.",
      "warning",
    );
    await refreshStreetRegistryPreview().catch(() => undefined);
    await publishState();
    return null;
  }
  streetRegistryClaim = claim;
  streetRegistryLastOutcome = null;
  scheduleStreetRegistryLeaseHeartbeat();
  pushActivity(`Presa in carico dal registro: ${describeRegistryStreet(claim)}`, "info");

  const checkpointMatches = Boolean(
    streetRunCheckpoint
    && streetRunCheckpoint.mode === "live"
    && streetRunCheckpoint.requestedStreet === claim.sister_search_name
    && ["running", "paused", "failed"].includes(streetRunCheckpoint.status),
  );

  /* Se l'acquisizione della via era già finita e si era fermato soltanto
   * l'import CRM, si riparte dal job collegato senza interrogare SISTER una
   * seconda volta. Un checkpoint ancora aperto ha invece la precedenza. */
  if (claim.last_job_id && !checkpointMatches) {
    try {
      const linkedJob = await repository().getJob(claim.last_job_id);
      if (linkedJob.status === "completed") {
        await closeStreetRegistryClaim("completed", {
          jobId: linkedJob.id,
          result: { status: "completed", resumed_from_job: true },
        });
        return claim;
      }
      pushActivity(`Riprendo l'import CRM già acquisito per ${claim.canonical_name}`, "info");
      await runWorker({ mode: linkedJob.mode, dryRun: false, jobId: linkedJob.id, registryNetwork: input.registryNetwork });
      const importPromise = activeRunPromise;
      if (importPromise) await importPromise;
      const completedJob = await repository().getJob(linkedJob.id);
      await closeStreetRegistryClaim(completedJob.status === "completed" ? "completed" : "to_recheck", {
        jobId: completedJob.id,
        result: { status: completedJob.status, resumed_from_job: true },
        error: completedJob.status === "completed" ? undefined : { message: completedJob.error_message ?? lastError ?? "Import CRM non completato" },
      });
      return claim;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await closeStreetRegistryClaim("to_recheck", { jobId: claim.last_job_id, error: { message } });
      throw error;
    }
  }

  try {
    await runSisterStreet({
      street: claim.sister_search_name,
      resume: checkpointMatches,
      dryRun: false,
      filters: input.filters,
      registryNetwork: input.registryNetwork,
    });
  } catch (error) {
    /* La run non e' neanche partita: la via torna subito in coda invece di
     * restare bloccata fino alla scadenza del lease. */
    await closeStreetRegistryClaim("to_recheck", {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
  return claim;
}

async function runStreetRegistryNetwork(input: { filters?: Partial<StreetPropertyFilters>; zoneId?: string | null } = {}) {
  reserveOperation("network");
  try {
    requireCloudAvailable(await healthChecks({ silent: true }));
  } catch (error) {
    releaseOperationReservation("network");
    throw error;
  }

  networkRunActive = true;
  networkRunCancellationRequested = false;
  networkRunError = null;
  streetRegistryNetworkProgress = {
    startedAt: new Date().toISOString(),
    processedStreets: 0,
    completedStreets: 0,
    recheckStreets: 0,
    failedStreets: 0,
    currentStreet: streetRegistryClaim?.canonical_name ?? null,
  };
  operationCompletion = null;
  streetRegistrySelectedZoneId = input.zoneId ?? null;
  const selectedZone = streetRegistryZones.find((zone) => zone.id === streetRegistrySelectedZoneId);
  pushActivity(
    selectedZone
      ? `Rete proprietari avviata in ${selectedZone.name}: procedo dal centro della zona verso l'esterno`
      : "Rete proprietari avviata: procedo sulle vie dal centro città verso l'esterno",
    "info",
  );
  await publishState();

  const runPromise = (async () => {
    await runStreetRegistrySequence({
      isCancelled: () => networkRunCancellationRequested,
      next: () => runNextStreetFromRegistry({ filters: input.filters, registryNetwork: true, zoneId: input.zoneId }),
      onClaim: async (claim) => {
        streetRegistryNetworkProgress = { ...streetRegistryNetworkProgress!, currentStreet: claim.canonical_name };
        await publishState();
      },
      waitForStreet: async () => {
        const pendingStreetRun = streetRunPromise;
        if (pendingStreetRun) await pendingStreetRun;
      },
      outcome: () => streetRegistryLastOutcome,
      onFinished: async (claim, outcome) => {
        streetRegistryNetworkProgress = {
          ...streetRegistryNetworkProgress!,
          processedStreets: streetRegistryNetworkProgress!.processedStreets + 1,
          completedStreets: streetRegistryNetworkProgress!.completedStreets + (outcome === "completed" ? 1 : 0),
          recheckStreets: streetRegistryNetworkProgress!.recheckStreets + (outcome === "to_recheck" ? 1 : 0),
          failedStreets: streetRegistryNetworkProgress!.failedStreets + (outcome === "failed" ? 1 : 0),
          currentStreet: null,
        };
        await publishState();

        /* Un problema richiede attenzione umana. Continuare prenderebbe subito
         * la stessa via da ricontrollare e consumerebbe tutti i tentativi. */
        if (outcome !== "completed") {
          networkRunError = `${claim.canonical_name} richiede un controllo prima di continuare la rete.`;
          pushActivity(networkRunError, "warning");
        }
      },
    });

    if (!networkRunCancellationRequested && !networkRunError) {
      operationCompletion = {
        kind: "network",
        title: "Rete proprietari completata",
        summary: streetRegistryNetworkProgress?.processedStreets
          ? "Le vie disponibili sono state lavorate nell'ordine del registro."
          : "Non risultano vie disponibili da lavorare.",
        completedAt: new Date().toISOString(),
        stats: [
          { label: "Vie completate", value: streetRegistryNetworkProgress?.completedStreets ?? 0 },
          { label: "Da ricontrollare", value: streetRegistryNetworkProgress?.recheckStreets ?? 0 },
        ],
      };
    }
  })().catch((error) => {
    networkRunError = error instanceof Error ? error.message : String(error);
    pushActivity(networkRunError, "error");
    void recordDiagnosticErrorSafely({
      source: "street-run",
      status: "failed",
      message: networkRunError,
      jobId: activeJobId,
      details: { operation: "street-registry-network" },
    }, { publish: true });
  }).finally(async () => {
    stopStreetRegistryLeaseHeartbeat();
    networkRunActive = false;
    networkRunCancellationRequested = false;
    networkRunPromise = null;
    refreshStoppingAll();
    await refreshStreetRegistryPreview().catch(() => undefined);
    await publishState();
  });
  networkRunPromise = runPromise;
  releaseOperationReservation("network");
  void runPromise;
}

async function runSisterNetwork(input: { settings: Partial<NetworkExplorationSettings> }) {
  reserveOperation("network");
  /* Tutto quello che puo' fallire sta dentro il try: la prenotazione
   * dell'operazione va restituita anche se a saltare e' la lettura della
   * configurazione, non solo il controllo del cloud. */
  let settings: NetworkExplorationSettings;
  let config: WorkerConfig;
  let seeds: string[];
  try {
    settings = normalizeNetworkSettings(input.settings);
    config = workerConfig({ dryRun: false });
    requireCloudAvailable(await healthChecks({ silent: true }));
    /* I punti di partenza noti si leggono prima di aprire il browser: sono
     * le persone che un'acquisizione precedente ha già portato nel gestionale.
     * Se non bastano, il resto lo sorteggia il gestionale stesso, ma per
     * quello serve la scheda aperta e quindi si fa più avanti. */
    seeds = await repository(config).listVerifiedNetworkSeedTaxCodes(settings.seedCount);
  } catch (error) {
    releaseOperationReservation("network");
    throw error;
  }
  networkRunActive = true;
  operationCompletion = null;
  networkRunCancellationRequested = false;
  networkRunError = null;
  networkRunProgress = null;
  beginRetryMonitor("network", "Esplorazione rete proprietaria");
  pushActivity("Nuova esplorazione rete proprietaria avviata", "info");
  await publishState();

  let networkImportJobId: string | null = null;
  let jobToImport: string | null = null;
  const runPromise = connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH).then(async (tabs) => {
    activeNetworkBrowser = tabs.browser;
    try {
      const liveRepository = repository(config);
      if (seeds.length < settings.seedCount) {
        /* Ad archivio corto i punti di partenza si sorteggiano fra i Clienti
         * del gestionale: di persone ne ha già, e senza questo la rete non si
         * poteva avviare finché non era stata importata almeno
         * un'acquisizione. Il sorteggio serve a non ripartire ogni volta dalle
         * stesse persone, che vorrebbe dire ribattere la stessa porzione di
         * rete senza scoprire niente di nuovo. */
        pushActivity("Punti di partenza insufficienti in archivio: li sorteggio fra i Clienti del gestionale.", "info");
        const sorteggiati = await collectCrmPersonSeeds(tabs.crmPage, {
          wanted: settings.seedCount - seeds.length,
          isCancelled: () => networkRunCancellationRequested,
          onProgress: ({ pagina, persone }) => pushActivity(`Elenco Clienti: pagina ${pagina}, ${persone} persone lette`),
        });
        const nuovi = sorteggiati.filter((seme) => !seeds.includes(seme.taxCode));
        seeds = [...seeds, ...nuovi.map((seme) => seme.taxCode)];
        if (nuovi.length) {
          pushActivity(
            `Punti di partenza sorteggiati dal gestionale: ${nuovi.map((seme) => seme.label).filter(Boolean).join(", ") || nuovi.length}`,
            "success",
          );
        }
      }
      if (!seeds.length) {
        throw new Error(
          "Non ho trovato nessun codice fiscale da cui partire, né fra le persone già acquisite né nell'elenco Clienti del gestionale. Controlla che l'elenco Clienti sia raggiungibile e che le anagrafiche abbiano il codice fiscale.",
        );
      }
      let erroriSisterVisti = 0;
      let erroriCrmVisti = 0;
      let erroriSalvataggioVisti = 0;
      const jobId = (await liveRepository.createJob("automatic")).id;
      networkImportJobId = jobId;
      await liveRepository.setJobContext(jobId, {
        municipality: "BITONTO", street: null, civicNumber: null, sourceUrl: tabs.sisterPage.url(),
      });
      const scanner = new SisterNetworkRun(
        new PlaywrightSisterAdapter(tabs.sisterPage, sisterSelectors, {
          isCancelled: () => networkRunCancellationRequested,
        }),
        new PlaywrightCrmAdapter(tabs.crmPage, false),
        liveRepository,
      );
      const result = await scanner.run(jobId, {
        settings,
        seeds,
        isCancelled: () => networkRunCancellationRequested,
        /* Coda finita e obiettivo non raggiunto: si torna a pescare fra i
         * Clienti del gestionale, saltando chi e' gia' stato visitato. */
        refillSeeds: async (escludi) => {
          pushActivity(`Coda esaurita senza raggiungere l'obiettivo: ripesco altri nominativi dal gestionale (${escludi.length} gia' visti).`, "info");
          const altri = await collectCrmPersonSeeds(tabs.crmPage, {
            wanted: settings.seedCount,
            escludi,
            isCancelled: () => networkRunCancellationRequested,
          });
          pushActivity(
            altri.length
              ? `Altri punti di partenza dal gestionale: ${altri.map((seme) => seme.label).filter(Boolean).join(", ")}`
              : "Nel gestionale non restano altri nominativi da cui ripartire.",
            altri.length ? "success" : "warning",
          );
          return altri.map((seme) => seme.taxCode);
        },
        onProgress: (progress) => {
          networkRunProgress = progress;
          publishTransientUpdate({ networkRunProgress });
        },
        onRetryTelemetry: (telemetry) => updateRetryMonitor("network", telemetry),
        onCheckpoint: async (checkpoint) => {
          /* Una persona non letta da SISTER non lasciava traccia: il
           * contatore saliva in silenzio e la run chiudeva dicendo soltanto
           * che nessun immobile aveva superato le barriere. */
          if (checkpoint.skipped.sister_error > erroriSisterVisti) {
            erroriSisterVisti = checkpoint.skipped.sister_error;
            pushActivity(`Persona non letta da SISTER: ${checkpoint.lastError ?? "motivo non riportato"}`, "warning");
          }
          if (checkpoint.skipped.crm_error > erroriCrmVisti) {
            erroriCrmVisti = checkpoint.skipped.crm_error;
            pushActivity(`Immobile escluso dal controllo CRM: ${checkpoint.lastError ?? "identità non verificabile"}`, "warning");
          }
          if (checkpoint.skipped.save_error > erroriSalvataggioVisti) {
            erroriSalvataggioVisti = checkpoint.skipped.save_error;
            pushActivity(`Immobile escluso dalla coda: ${checkpoint.lastError ?? "proprietari non salvati integralmente"}`, "warning");
          }
          await persistNetworkRunCheckpoint(checkpoint);
          publishTransientUpdate({ networkRunCheckpoint });
        },
      });
      const graph = await liveRepository.loadGraph(jobId);
      if (["completed", "paused"].includes(result.status)) clearRetryMonitor();
      const provenienza = {
        kind: "network" as const,
        collectedAt: new Date().toISOString(),
        activityMode: preferences.propertyActivityMode,
        dryRun: false,
        settings: result.settings,
        skipped: result.skipped,
        peopleVisited: result.visitedTaxCodes?.length ?? null,
        completionReason: result.completionReason,
      };
      if (result.status === "completed" && graph.properties.length) {
        await liveRepository.markGraphNormalized(graph.properties, graph.people);
        await liveRepository.updateJob(jobId, {
          total_properties: graph.properties.length,
          total_people: graph.people.length,
          status: "saved",
          saved_at: new Date().toISOString(),
          last_completed_step: "acquisition_reviewed",
          current_step: "properties_processed",
          error_message: result.completionReason === "target_reached"
            ? null
            : `Esplorazione conclusa prima dell'obiettivo: ${result.acceptedProperties}/${result.settings.targetProperties} immobili.`,
          error_details: result.completionReason === "target_reached"
            ? null
            : { action: "network-exploration-partial", completionReason: result.completionReason, skipped: result.skipped },
          acquisition: provenienza,
        });
        if (result.completionReason === "target_reached" && !preferences.keepAcquisition) {
          jobToImport = jobId;
          pushActivity(`Esplorazione conclusa: obiettivo raggiunto con ${graph.properties.length} immobili verificati. Avvio l'import automatico.`, "success");
        } else if (result.completionReason === "target_reached") {
          operationCompletion = {
            kind: "network",
            title: "Traguardo della rete raggiunto",
            summary: "Gli immobili richiesti sono stati verificati e la raccolta è pronta per l’import.",
            completedAt: result.updatedAt ?? new Date().toISOString(),
            stats: [
              { label: "Immobili ottenuti", value: graph.properties.length },
              { label: "Persone visitate", value: result.visitedTaxCodes.length },
            ],
          };
          pushActivity(`Esplorazione conclusa: ${graph.properties.length} immobili verificati e conservati per l'import.`, "success");
        } else {
          pushActivity(
            `Esplorazione conclusa prima dell'obiettivo: ${graph.properties.length}/${result.settings.targetProperties} immobili verificati. La coda resta salvata e non parte automaticamente.`,
            "warning",
          );
        }
      } else if (result.status === "completed") {
        await liveRepository.updateJob(jobId, {
          status: "saved", saved_at: new Date().toISOString(), last_completed_step: "acquisition_reviewed", current_step: "properties_processed",
          error_message: "Esplorazione conclusa senza immobili importabili.", error_details: { action: "network-exploration-empty", skipped: result.skipped },
          acquisition: provenienza,
        });
        const motivi = Object.entries(result.skipped)
          .filter(([, quanti]) => quanti > 0)
          .map(([motivo, quanti]) => `${motivo}: ${quanti}`)
          .join(", ");
        pushActivity(
          `Esplorazione conclusa senza immobili. Persone visitate: ${result.visitedTaxCodes.length}.`
          + (motivi ? ` Scarti — ${motivi}.` : "")
          + (result.lastError ? ` Ultimo errore: ${result.lastError}` : ""),
          "warning",
        );
      } else {
        await liveRepository.updateJob(jobId, { status: "paused", saved_at: new Date().toISOString(), error_message: "Esplorazione rete messa in pausa: la coda è salvata.", error_details: { action: "network-exploration-paused" } });
      }
    } finally {
      activeNetworkBrowser = null;
      await tabs.browser.close().catch(() => undefined);
    }
  }).catch(async (error) => {
    networkRunError = error instanceof Error ? error.message : String(error);
    reportRunInterruption("network", "Esplorazione rete interrotta");
    pushActivity(networkRunError, "error");
    await chiudiAcquisizioneInterrotta(networkImportJobId, networkRunError);
  }).finally(async () => {
    networkRunPromise = null;
    networkRunActive = false;
    networkRunCancellationRequested = false;
    networkRunProgress = null;
    refreshStoppingAll();
    await publishState();
    if (jobToImport) {
      try {
        await repository(config).markImportStarted(jobToImport);
        await runWorker({ mode: "automatic", dryRun: false, jobId: jobToImport });
      } catch (error) {
        operationCompletion = null;
        const message = `Rete acquisita e salvata, ma avvio import non riuscito: ${error instanceof Error ? error.message : String(error)}`;
        networkRunError = message;
        pushActivity(message, "error");
        await recordDiagnosticErrorSafely({
          source: "worker",
          status: "failed",
          message,
          jobId: jobToImport,
          details: { operation: "network-run-import-start" },
        });
        await publishState();
      }
    }
  });
  networkRunPromise = runPromise;
  releaseOperationReservation("network");
  void runPromise;
}

async function publishState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (publishStatePromise) {
    publishStateQueued = true;
    return publishStatePromise;
  }
  publishStatePromise = (async () => {
    mainWindow?.webContents.send("desktop:state", await stateSnapshot());
  })().finally(() => {
    publishStatePromise = null;
    if (publishStateQueued) {
      publishStateQueued = false;
      void publishState();
    }
  });
  return publishStatePromise;
}

function publishPrompt(value: DesktopPrompt | null) {
  prompt = value;
  if (value) bringWorkerToFront();
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
  values: { source: "automatic" | "manual"; reason: string; attempts: number; status?: "skipped" | "acquisition_skipped" },
  repo = repository(),
) {
  const graph = await repo.loadGraph(jobId);
  const graphIndex = indexJobGraph(graph);
  const property = graphIndex.propertiesById.get(propertyId);
  if (!property) throw new Error("Immobile da saltare non appartenente alla lavorazione");
  const impact = buildAutomaticSkipImpact(graph, propertyId);
  const relatedOwnerships = graphIndex.ownershipsByPropertyId.get(propertyId) ?? [];
  const relatedPersonIds = impact.personIds;
  const skippedAt = new Date().toISOString();
  const skipStatus = values.status ?? "skipped";
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
    processing_status: skipStatus,
    raw_payload: property.raw_payload,
  });
  for (const ownership of relatedOwnerships) {
    await repo.updateOwnership(ownership.id, { processing_status: skipStatus });
  }
  for (const personId of relatedPersonIds) {
    const person = graphIndex.peopleById.get(personId);
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
      ...(!hasAnotherActiveProperty ? { processing_status: skipStatus } : {}),
      raw_payload: person.raw_payload,
    });
  }
  return { property, peopleCount: relatedPersonIds.length };
}

async function repairLongRunJobForImport(jobId: string) {
  const repo = repository();
  const graph = await repo.loadGraph(jobId);
  const queue = inspectAcquisitionQueue(graph);
  let { activeProperties, activePeople } = queue;
  const { invalidProperties } = queue;
  for (const [propertyId, reason] of invalidProperties) {
    await markCaseSkipped(jobId, propertyId, { source: "automatic", reason, attempts: 0, status: "acquisition_skipped" }, repo);
  }
  if (invalidProperties.size) {
    const refreshedGraph = await repo.loadGraph(jobId);
    ({ activeProperties, activePeople } = inspectAcquisitionQueue(refreshedGraph));
  }
  await repo.markGraphNormalized(activeProperties, activePeople);
  if (!(activeProperties.length && activePeople.length)) return false;
  await repo.updateJob(jobId, {
    total_properties: graph.properties.length,
    total_people: graph.people.length,
    status: "saved",
    saved_at: new Date().toISOString(),
    last_completed_step: "acquisition_reviewed",
    current_step: "properties_processed",
    error_message: null,
    error_details: null,
  });
  pushActivity(
    invalidProperties.size
      ? `Job long run ripristinato: ${invalidProperties.size} immobili esclusi, avvio gli elementi validi`
      : "Job long run ripristinato, avvio l'import degli elementi acquisiti",
    "success",
  );
  return true;
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
  updateRetryMonitor("import", {
    operation: "Recupero automatico dell'immobile",
    attempt: autoRetryAttemptNumber,
    maximumAttempts: 3,
    status: "waiting",
    nextRetryAt: autoRetryAt,
  });
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
      updateRetryMonitor("import", {
        operation: "Recupero automatico dell'immobile", attempt, maximumAttempts: 3,
        status: "running", nextRetryAt: null,
      });
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
    clearRetryMonitor();
    automaticRetryInFlight = null;
    currentStep = "completed";
    propertyProgress = null;
    prompt = null;
    lastError = null;
    pushActivity("Import eseguito con successo", "success");
  } else if (event.type === "job-archived") {
    clearAutoRetry();
    clearRetryMonitor();
    automaticRetryInFlight = null;
    currentStep = "properties_processed";
    propertyProgress = null;
    activeJobId = null;
    operationCompletion = {
      kind: "acquisition",
      title: "Acquisizione completata",
      summary: "Immobili e proprietari sono stati raccolti e salvati. Potrai avviare l’import dalla cronologia quando vuoi.",
      completedAt: new Date().toISOString(),
      stats: [],
    };
    pushActivity("Ricerca SISTER salvata nell'archivio", "success");
  } else if (event.type === "sister-keepalive") {
    updateKeepAliveState(event.result);
    return;
  } else if (event.type === "property-progress") {
    propertyProgress = { propertyId: event.propertyId, index: event.index, total: event.total, address: event.address, stage: event.stage, message: event.message };
    const activityItem = pushActivity(`Immobile ${event.index}/${event.total}: ${event.message}`);
    publishTransientUpdate({ propertyProgress, activityItem });
    return;
  } else if (event.details.cancelled === true && cancellingJobId === event.jobId) {
    clearRetryMonitor();
    pushActivity("Arresto del processo completato", "warning");
  } else if (event.details.pauseRequested === true && pausingJobId === event.jobId) {
    clearRetryMonitor();
    prompt = null;
    propertyProgress = null;
    pushActivity("Lavorazione messa in pausa: il checkpoint è stato salvato", "warning");
  } else {
    lastError = event.message;
    bringWorkerToFront();
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
      reportRunInterruption("import", "Tentativi automatici esauriti");
      void skipAfterAutomaticRetries(event.jobId, retry.propertyId, event.message, retry.attempt);
    } else if (preferences.autoRetryEnabled && failedPropertyId && canAutomaticallyRecoverPropertyFailure(event.status, event.details)) {
      void scheduleAutoRetry(event.jobId);
    } else {
      reportRunInterruption("import", "Import interrotto: serve attenzione");
      pushActivity(
        preferences.autoRetryEnabled
          ? "Questo arresto richiede un intervento manuale: pausa, sessione o salvataggio non verificato non vengono forzati"
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
  const activityItem = !result.ok && previousStatus !== sisterKeepAlive.statusLabel
    ? pushActivity(result.message, result.sessionExpired ? "error" : "warning")
    : undefined;
  publishTransientUpdate({ sisterKeepAlive, activityItem });
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
    publishTransientUpdate({ sisterKeepAlive });
    return;
  }
  const delay = delayMs ?? nextKeepAliveDelay(config.SISTER_KEEPALIVE_MIN_SECONDS, config.SISTER_KEEPALIVE_MAX_SECONDS);
  sisterKeepAlive = { ...sisterKeepAlive, nextAttemptAt: new Date(Date.now() + delay).toISOString() };
  keepAliveTimer = setTimeout(() => void runDesktopKeepAlive(), delay);
  keepAliveTimer.unref?.();
  publishTransientUpdate({ sisterKeepAlive });
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

async function reanalyzePropertyFromScratch(jobId: string, propertyId: string) {
  if (active) throw new Error("Attendi che il passaggio corrente si fermi prima di rianalizzarlo");
  const repo = repository();
  const [job, graph] = await Promise.all([repo.getJob(jobId), repo.loadGraph(jobId)]);
  const property = graph.properties.find((candidate) => candidate.id === propertyId);
  if (!property) throw new Error("Immobile da rianalizzare non trovato nella lavorazione");
  if (["completed", "skipped", "acquisition_skipped", "acquisition_failed"].includes(property.processing_status)) {
    throw new Error("Questo immobile non è più rianalizzabile nella lavorazione corrente");
  }

  // Reset only this property's workflow checkpoint. CRM IDs, activity proof,
  // contacts and ownership links stay intact: they are verified again and the
  // worker writes only the pieces that Tecnocloud still lacks.
  const payload = { ...(property.raw_payload ?? {}) };
  delete payload.automatic_retry;
  payload.property_flow = {
    version: 3,
    stage: "ready",
    dryRun: preferences.dryRun,
    reanalyzedAt: new Date().toISOString(),
    reanalysisSource: "operator",
  };
  await repo.updatePropertyProcessing(property.id, {
    processing_status: "normalized",
    raw_payload: payload,
  });
  await repo.updateJob(job.id, { status: "paused", error_message: null, error_details: null });
  clearAutoRetry();
  lastError = null;
  propertyProgress = {
    propertyId: property.id,
    index: 0,
    total: job.total_properties ?? graph.properties.length,
    address: property.address,
    stage: "reanalyzing",
    message: "Rianalizzo l’immobile: verifico ciò che esiste e completo solo ciò che manca",
  };
  pushActivity(`Rianalisi richiesta per ${property.address ?? property.cadastral_key}: mantengo i dati CRM esistenti e controllo ogni passaggio`, "warning");
  await publishState();
  await runWorker({ mode: job.mode, dryRun: preferences.dryRun, jobId: job.id });
}

async function runWorker(input: { mode: WorkerMode; dryRun: boolean; jobId?: string; registryNetwork?: boolean }) {
  const ownsOperationReservation = !input.registryNetwork;
  if (ownsOperationReservation) reserveOperation("worker");
  try {
    requireCloudAvailable(await healthChecks({ silent: true }));
  } catch (error) {
    if (ownsOperationReservation) releaseOperationReservation("worker");
    throw error;
  }
  clearAutoRetry();
  updateRetryMonitor("import", {
    operation: "Importazione immobile nel CRM",
    attempt: automaticRetryInFlight?.attempt ?? 1,
    maximumAttempts: 3,
    status: "running",
    nextRetryAt: null,
  });
  let forceLiveImport = false;
  try {
    if (input.jobId) {
      const pendingJob = await repository().getJob(input.jobId);
      if (pendingJob.error_details?.action === "long-run-acquisition-validation") {
        await repairLongRunJobForImport(input.jobId);
        forceLiveImport = true;
      }
    }
  } catch (error) {
    if (ownsOperationReservation) releaseOperationReservation("worker");
    throw error;
  }
  active = true;
  operationCompletion = null;
  cancellingJobId = null;
  pausingJobId = null;
  lastError = null;
  currentStep = null;
  propertyProgress = null;
  activeJobId = input.jobId ?? null;
  preferences = { ...preferences, mode: input.mode, dryRun: forceLiveImport ? false : input.dryRun };
  await persistPreferences();
  activePrompts = new DesktopPromptController(publishPrompt);
  const runner = new PropertyWorkerRunner(workerConfig(preferences), {
    prompts: activePrompts,
    onEvent: handleRunnerEvent,
    keepAlive: false,
    isCancellationRequested: (jobId) => cancellingJobId === jobId,
    isPauseRequested: (jobId) => pausingJobId === jobId,
    isStopAfterNextImportRequested: () => stopAfterNextImportRequested,
    propertyActivityMode: () => activityModeOverride ?? preferences.propertyActivityMode,
    isPropertySkipRequested: (jobId, propertyId) => activeJobId === jobId && skippingPropertyId === propertyId,
  });
  activeRunner = runner;
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
      activeRunner = null;
      activeRunPromise = null;
      stopAfterNextImportRequested = false;
      refreshStoppingAll();
      await publishState();
    });
  activeRunPromise = runPromise;
  if (ownsOperationReservation) releaseOperationReservation("worker");
  void runPromise;
}

async function abandonStreetRun() {
  if (streetRunActive) {
    streetRunAbandonRequested = true;
    streetRunCancellationRequested = true;
    pushActivity("Arresto definitivo della run via richiesto: il checkpoint verrà archiviato", "warning");
    await activeStreetBrowser?.close().catch(() => undefined);
    await publishState();
    return { stopped: true, pending: true, archivedPath: null };
  }
  const archivedPath = await archiveStreetRunCheckpoint("Run via abbandonata dall'operatore");
  await publishState();
  return { stopped: Boolean(archivedPath), pending: false, archivedPath };
}

async function stopEverything() {
  clearAutoRetry();
  clearRetryMonitor();
  const actions: string[] = [];
  const hadActiveOperation = active || requestImportActive || mandateImportActive || streetRunActive || networkRunActive;
  stoppingAll = hadActiveOperation;

  if (active && activeJobId) {
    pausingJobId = activeJobId;
    activePrompts?.cancel("Arresto globale richiesto dall'utente");
    try {
      await repository().updateJob(activeJobId, { status: "paused" });
    } catch {
      pushActivity("Arresto locale acquisito; stato cloud non raggiungibile", "warning");
    }
    actions.push("lavorazione immobili in pausa");
  }
  if (requestImportActive) {
    requestImportCancellationRequested = true;
    actions.push("archivio richieste interrotto");
  }
  if (mandateImportActive) {
    mandateImportCancellationRequested = true;
    actions.push("archivio incarichi interrotto");
  }
  if (streetRunActive) {
    streetRunCancellationRequested = true;
    streetRunAbandonRequested = true;
    actions.push("run via arrestata");
  }
  if (networkRunActive) {
    networkRunCancellationRequested = true;
    actions.push("esplorazione rete arrestata");
  }
  if (!streetRunActive && streetRunCheckpoint && ["paused", "failed", "running"].includes(streetRunCheckpoint.status)) {
    await archiveStreetRunCheckpoint("Checkpoint via abbandonato da Ferma tutto");
    actions.push("checkpoint via archiviato");
  }
  if (desktopUpdater?.cancelDownload()) actions.push("download aggiornamento interrotto");

  await Promise.all([
    activeRunner?.interrupt().catch(() => undefined),
    activeRequestImporter?.interrupt().catch(() => undefined),
    activeMandateImporter?.interrupt().catch(() => undefined),
    streetRunAbandonRequested ? activeStreetBrowser?.close().catch(() => undefined) : undefined,
    networkRunCancellationRequested ? activeNetworkBrowser?.close().catch(() => undefined) : undefined,
  ]);
  const pendingOperations = [activeRunPromise, requestImportPromise, mandateImportPromise, streetRunPromise, networkRunPromise]
    .filter((promise): promise is Promise<void> => Boolean(promise));
  if (pendingOperations.length) {
    try {
      await withOperationTimeout(Promise.allSettled(pendingOperations).then(() => undefined), 15_000, "Arresto processi");
    } catch (error) {
      pushActivity(error instanceof Error ? error.message : String(error), "warning");
    }
  }
  resetStaleOperationState();
  refreshStoppingAll();
  if (actions.length) pushActivity(`Ferma tutto eseguito: ${actions.join(", ")}`, "warning");
  await publishState();
  return { stopped: actions.length > 0, pending: stoppingAll, actions };
}

async function readBrowserConnections(config: WorkerConfig): Promise<BrowserConnectionCheck[]> {
  try {
    const response = await withOperationTimeout(
      fetch(`${config.CHROME_CDP_URL.replace(/\/$/, "")}/json/list`, { cache: "no-store" }),
      3_000,
      "Controllo Chrome",
    );
    if (!response.ok) throw new Error(`Chrome ha risposto HTTP ${response.status}`);
    return detectBrowserConnections(
      await response.json() as Array<{ title?: string; url?: string; type?: string }>,
      config.SISTER_TAB_MATCH,
      config.CRM_TAB_MATCH,
    );
  } catch (error) {
    return unreachableBrowserConnections(error instanceof Error ? error.message : String(error));
  }
}

function mergeBrowserConnections(browserChecks: BrowserConnectionCheck[]) {
  const browserIds = new Set(["chrome", "sister", "crm"]);
  connectionChecks = [
    ...browserChecks,
    ...connectionChecks.filter((check) => !browserIds.has(check.id)),
  ];
  connectionChecksAt = new Date().toISOString();
}

async function refreshBrowserConnections() {
  if (browserCheckPromise) return browserCheckPromise;
  browserCheckPromise = readBrowserConnections(workerConfig()).then((candidateChecks) => {
    browserConnectionStability = stabilizeBrowserConnections(browserConnectionStability, candidateChecks);
    const browserChecks = browserConnectionStability.confirmed;
    mergeBrowserConnections(browserChecks);
    publishTransientUpdate({
      connections: { checks: connectionChecks, checkedAt: connectionChecksAt, checking: false },
    });
    return browserChecks;
  }).finally(() => {
    browserCheckPromise = null;
  });
  return browserCheckPromise;
}

async function healthChecks(options: { silent?: boolean } = {}) {
  if (healthCheckPromise) return healthCheckPromise;
  let activityItem: ActivityItem | undefined;
  healthCheckPromise = (async () => {
    const config = workerConfig();
    const databaseConfigurationNeedsRefresh = archivedDatabaseConfigurationNeedsRefresh();
    const [browserChecks, contactsCheck, cloudCheck] = await Promise.all([
      refreshBrowserConnections(),
      withOperationTimeout((async () => {
        await access(config.CONTACTS_EXCEL_PATH);
        /* Solo l'intestazione: sgranare tutte le righe qui bloccava la
         * finestra per il tempo della lettura, ogni trenta secondi. Le righe
         * le legge la run, quando servono davvero. */
        await verifyContactsFile(config.CONTACTS_EXCEL_PATH);
        return { id: "excel", label: "Recapiti", ok: true, detail: `${REQUIRED_CONTACT_COLUMNS.length} colonne riconosciute` } satisfies ConnectionCheck;
      })(), 12_000, "Controllo file recapiti").catch((error) => ({
        id: "excel", label: "Recapiti", ok: false, detail: error instanceof Error ? error.message : String(error),
      }) satisfies ConnectionCheck),
      databaseConfigurationNeedsRefresh
        ? Promise.resolve({
          id: "supabase", label: "Cloud", ok: false, state: "configuration", detail: ARCHIVED_DATABASE_CONFIGURATION_MESSAGE,
        } satisfies ConnectionCheck)
        : withOperationTimeout(repository(config).healthCheck(), 12_000, "Controllo Supabase")
          .then(() => ({ id: "supabase", label: "Cloud", ok: true, detail: "Connesso" }) satisfies ConnectionCheck)
          .catch((error) => ({ id: "supabase", label: "Cloud", ok: false, detail: describeSupabaseOperationalError(error) }) satisfies ConnectionCheck),
    ]);
    const checks: ConnectionCheck[] = [...browserChecks, contactsCheck, cloudCheck];
    connectionChecks = checks;
    connectionChecksAt = new Date().toISOString();
    if (!options.silent) {
      activityItem = pushActivity(checks.every((item) => item.ok) ? "Controlli completati" : "Alcuni controlli richiedono attenzione", checks.every((item) => item.ok) ? "success" : "warning");
    }
    return checks;
  })().finally(() => {
    healthCheckPromise = null;
    publishTransientUpdate({
      connections: { checks: connectionChecks, checkedAt: connectionChecksAt, checking: false },
      activityItem,
    });
  });
  return healthCheckPromise;
}

function requireCloudAvailable(checks: ConnectionCheck[]) {
  const cloud = checks.find((check) => check.id === "supabase");
  if (!cloud?.ok) {
    throw new Error(cloud?.detail ?? "Cloud non raggiungibile: la run non e stata avviata.");
  }
}

function scheduleHealthChecks(delayMs = 2_000) {
  if (healthCheckTimer) clearTimeout(healthCheckTimer);
  healthCheckTimer = setTimeout(async () => {
    await healthChecks({ silent: true }).catch(() => undefined);
    scheduleHealthChecks(30_000);
  }, delayMs);
  healthCheckTimer.unref?.();
}

function scheduleBrowserChecks(delayMs = 500) {
  if (browserCheckTimer) clearTimeout(browserCheckTimer);
  browserCheckTimer = setTimeout(async () => {
    const checks = await refreshBrowserConnections().catch(() => []);
    const ready = checks.length === 3 && checks.every((check) => check.ok);
    scheduleBrowserChecks(ready ? 10_000 : 2_000);
  }, delayMs);
  browserCheckTimer.unref?.();
}

function findChromeExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.find((candidate) => candidate && path.isAbsolute(candidate) && existsSync(candidate));
}

async function runImportV2Diagnostics() {
  reserveOperation("import-v2-diagnostics");
  let tabs: Awaited<ReturnType<typeof connectToChrome>> | null = null;
  try {
    pushActivity("Diagnostica Import V2 avviata in sola lettura");
    const config = workerConfig();
    tabs = await connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH);
    const report = await runTecnocloudV2ReadOnlyDiagnostic(tabs.crmPage);
    const target = importV2DiagnosticPath();
    const temporary = `${target}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, JSON.stringify(report, null, 2), "utf8");
    await rename(temporary, target);
    pushActivity(
      `Diagnostica Import V2 completata: ${report.snapshots.length} viste e ${report.network.length} contratti di rete`,
      "success",
    );
    return { path: target, snapshots: report.snapshots.length, networkContracts: report.network.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushActivity(`Diagnostica Import V2 non completata: ${message}`, "error");
    await recordDiagnosticErrorSafely({
      source: "import-v2-diagnostics",
      status: "failed",
      message,
      jobId: null,
      details: { readOnly: true },
    }, { publish: false });
    throw error;
  } finally {
    await tabs?.browser.close().catch(() => undefined);
    releaseOperationReservation("import-v2-diagnostics");
    await publishState();
  }
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
    const keep = values.keepAcquisition ?? preferences.keepAcquisition;
    preferences = {
      ...preferences,
      ...values,
      keepAcquisition: keep,
      /* Se la run si ferma prima dell'import, nel gestionale non finisce
       * niente comunque: i due flag non possono divergere. */
      dryRun: values.keepAcquisition != null ? keep : (values.dryRun ?? preferences.dryRun),
    };
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
    pushActivity("Configurazione salvata e protetta da Windows", "success");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:open-chrome", async () => {
    const executable = findChromeExecutable();
    if (!executable) throw new Error("Google Chrome non trovato");
    spawn(executable, ["--remote-debugging-port=9222", "--user-data-dir=C:\\ChromeListingRadar"], { detached: true, stdio: "ignore" }).unref();
    pushActivity("Chrome dedicato avviato", "success");
    scheduleBrowserChecks(250);
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:start-job", async (_event, values: { mode?: WorkerMode; dryRun?: boolean }) => {
    await runWorker({ mode: values.mode === "automatic" ? "automatic" : "assisted", dryRun: values.dryRun !== false });
    return true;
  });
  ipcMain.handle("desktop:set-stop-after-next-import", async (_event, enabled: boolean) => {
    stopAfterNextImportRequested = Boolean(enabled);
    pushActivity(stopAfterNextImportRequested
      ? "Stop programmato: eseguirò ancora un import, poi salverò il resto e metterò in pausa la run"
      : "Stop dopo il prossimo import disattivato");
    await publishState();
    return stopAfterNextImportRequested;
  });
  ipcMain.handle("desktop:start-street-run", async (_event, values: { street?: string; resume?: boolean; dryRun?: boolean; filters?: Partial<StreetPropertyFilters> }) => {
    await runSisterStreet({ street: String(values.street ?? ""), resume: false, dryRun: values.dryRun !== false, filters: values.filters });
    return true;
  });
  ipcMain.handle("desktop:refresh-street-registry", async (_event, values: { zoneId?: string | null } = {}) => {
    await refreshStreetRegistryPreview(12, values?.zoneId ?? null);
    preferences = { ...preferences, streetRegistryZoneId: streetRegistrySelectedZoneId };
    await persistPreferences();
    await publishState();
    return !streetRegistryError;
  });
  ipcMain.handle("desktop:start-registry-street-run", async (_event, values: { filters?: Partial<StreetPropertyFilters> } = {}) => {
    const claim = await runNextStreetFromRegistry({ filters: values?.filters });
    return claim ? { started: true, street: claim.canonical_name } : { started: false, street: null };
  });
  ipcMain.handle("desktop:start-network-run", async (_event, values: { filters?: Partial<StreetPropertyFilters>; zoneId?: string | null } = {}) => {
    await runStreetRegistryNetwork({ filters: values?.filters, zoneId: values?.zoneId });
    return true;
  });
  ipcMain.handle("desktop:run-import-v2-diagnostics", () => runImportV2Diagnostics());
  ipcMain.handle("desktop:cancel-network-run", async () => {
    if (!networkRunActive) return false;
    networkRunCancellationRequested = true;
    pushActivity("Pausa Rete proprietari richiesta: termino la via corrente e non ne prendo un'altra", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:cancel-street-run", async () => {
    if (!streetRunActive) return false;
    streetRunCancellationRequested = true;
    pushActivity("Pausa run via richiesta: completo il passaggio corrente e salvo il cursore", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:abandon-street-run", () => abandonStreetRun());
  ipcMain.handle("desktop:stop-all", () => stopEverything());
  ipcMain.handle("desktop:start-request-archive-import", async (_event, resumeRunId?: string) => {
    await runRequestArchiveImport(resumeRunId || undefined);
    return true;
  });
  ipcMain.handle("desktop:cancel-request-archive-import", async () => {
    if (!requestImportActive) return false;
    requestImportCancellationRequested = true;
    await activeRequestImporter?.interrupt().catch(() => undefined);
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
    await activeMandateImporter?.interrupt().catch(() => undefined);
    pushActivity("Interruzione sincronizzazione incarichi richiesta", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:resume-job", async (_event, values: string | { jobId: string; activityMode?: PropertyActivityMode }) => {
    const jobId = typeof values === "string" ? values : values.jobId;
    const chosen = typeof values === "string" ? null : values.activityMode ?? null;
    clearAutoRetry();
    const repo = repository();
    const job = await repo.getJob(jobId);
    if (job.saved_at) await repo.markImportStarted(jobId);
    activityModeOverride = chosen;
    try {
      /* Un import dall'archivio e' sempre vero: e' il gesto per cui
       * l'acquisizione era stata conservata. Se qui passasse la preferenza,
       * con «Acquisisci e conserva» acceso girerebbe in simulazione e non
       * scriverebbe niente, dicendo di aver importato. */
      await runWorker({ mode: job.mode, dryRun: false, jobId });
    } finally {
      activityModeOverride = null;
    }
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
  ipcMain.handle("desktop:reanalyze-property", async (_event, values: { jobId: string; propertyId: string }) => {
    if (!values.jobId || !values.propertyId) throw new Error("Immobile da rianalizzare non riconosciuto");
    await reanalyzePropertyFromScratch(values.jobId, values.propertyId);
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
      await activeRunner?.interrupt().catch(() => undefined);
      await withOperationTimeout(pendingRun, 15_000, "Annullamento lavorazione");
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
    const graphIndex = indexJobGraph(graph);
    const allowedProperties = new Set(graphIndex.propertiesById.keys());
    const allowedPeople = new Set(graphIndex.peopleById.keys());
    const allowedOwnerships = new Map(graph.ownerships.map((row) => [row.id, row]));
    for (const property of values.properties) {
      if (!allowedProperties.has(property.id)) throw new Error("Immobile non appartenente alla lavorazione");
      await repo.updatePropertyProcessing(property.id, {
        sheet: property.sheet, parcel: property.parcel, subaltern: property.subaltern,
        cadastral_key: [graphIndex.propertiesById.get(property.id)?.municipality, property.sheet, property.parcel, property.subaltern].join("|"),
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
        const related = graphIndex.ownershipsByPersonId.get(person.id) ?? [];
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
  ipcMain.handle("desktop:cancel-update-download", () => desktopUpdater?.cancelDownload());
  ipcMain.handle("desktop:install-update", () => desktopUpdater?.install());
}

app.whenReady().then(async () => {
  app.setAppUserModelId("it.listingradar.propertyworker");
  await loadPreferences();
  await loadStreetRunCheckpoint();
  await loadNetworkRunCheckpoint();
  await loadDiagnosticErrors();
  registerIpc();
  await createWindow();
  scheduleDesktopKeepAlive(3_000);
  /* La coda si carica in sottofondo: se il registro non risponde la finestra
   * si apre lo stesso e l'errore si legge nel pannello, non blocca l'avvio. */
  void refreshStreetRegistryPreview().then(() => publishState()).catch(() => undefined);
  scheduleHealthChecks();
  scheduleBrowserChecks();
  initializeDesktopUpdater();
});

app.on("before-quit", () => {
  stopStreetRegistryLeaseHeartbeat();
  if (keepAliveTimer) clearTimeout(keepAliveTimer);
  if (healthCheckTimer) clearTimeout(healthCheckTimer);
  if (browserCheckTimer) clearTimeout(browserCheckTimer);
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  if (attentionTimer) clearTimeout(attentionTimer);
  void flushActivityLog();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
