import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
import { PropertyWorkerRunner, type RunnerEvent } from "../services/runner.js";
import { connectToChrome, isPresumablyAuthenticated } from "../services/chrome.js";
import { nextKeepAliveDelay, pingSisterSession, type SisterKeepAliveResult } from "../services/sister-keepalive.js";
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
  encryptedEnvironment?: string;
};

type ActivityItem = { at: string; tone: "info" | "success" | "warning" | "error"; message: string };
type KeepAliveState = SisterKeepAliveResult & { nextAttemptAt: string | null; statusLabel: "waiting" | "active" | "expired" | "error" | "disabled" };

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(moduleDirectory, "../..");
const defaultPreferences: Preferences = { mode: "assisted", dryRun: true };
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
const internalConfigurationSchema = z.object({
  supabaseUrl: z.string().url(),
  serviceRoleKey: z.string().min(20),
  contactsExcelPath: z.string().min(1),
  sisterTabMatch: z.string().min(1),
  crmTabMatch: z.string().min(1),
});

let mainWindow: BrowserWindow | null = null;
let preferences: Preferences = defaultPreferences;
let activePrompts: DesktopPromptController | null = null;
let activeJobId: string | null = null;
let active = false;
let activeRunPromise: Promise<void> | null = null;
let cancellingJobId: string | null = null;
let prompt: DesktopPrompt | null = null;
let currentStep: string | null = null;
let propertyProgress: { propertyId: string; index: number; total: number; address: string | null; stage: string; message: string } | null = null;
let lastError: string | null = null;
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

function pushActivity(message: string, tone: ActivityItem["tone"] = "info") {
  activity.unshift({ at: new Date().toISOString(), tone, message });
  activity.splice(80);
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "desktop-preferences.json");
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
  let configError: string | null = null;
  let publicConfig: Record<string, unknown> = {};
  try {
    const config = workerConfig();
    publicConfig = {
      configurationReady: true,
      configurationSource: preferences.encryptedEnvironment ? "Protetta da Windows" : "Inclusa nell'app",
      contactsExcelPath: config.CONTACTS_EXCEL_PATH,
      chromeCdpUrl: config.CHROME_CDP_URL,
      screenshotDirectory: config.ERROR_SCREENSHOT_DIR,
      sisterKeepAliveEnabled: config.SISTER_KEEPALIVE_ENABLED,
      sisterKeepAliveInterval: `${config.SISTER_KEEPALIVE_MIN_SECONDS}-${config.SISTER_KEEPALIVE_MAX_SECONDS} secondi`,
    };
    jobs = await repository(config).listJobs();
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  return {
    active,
    activeJobId,
    cancellingJobId,
    currentStep,
    propertyProgress,
    prompt,
    lastError,
    sisterKeepAlive,
    softwareUpdate: desktopUpdater?.snapshot() ?? {
      status: "unavailable", currentVersion: app.getVersion(), availableVersion: null, percent: null,
      transferred: null, total: null, message: "Controllo aggiornamenti non inizializzato", checkedAt: null,
    },
    activity,
    preferences,
    config: publicConfig,
    configError,
    jobs,
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
      isWorkerActive: () => active,
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

async function publishState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:state", await stateSnapshot());
}

function publishPrompt(value: DesktopPrompt | null) {
  prompt = value;
  void publishState();
}

function handleRunnerEvent(event: RunnerEvent) {
  if (event.type === "job-ready") {
    activeJobId = event.job.id;
    pushActivity(`Lavorazione ${event.job.id.slice(0, 8)} pronta`, "success");
  } else if (event.type === "step-started") {
    currentStep = event.step;
    pushActivity(`Inizio: ${friendlyStepLabel(event.step)}`);
  } else if (event.type === "step-completed") {
    currentStep = event.next;
    pushActivity(`Terminato: ${friendlyStepLabel(event.step)}`, "success");
  } else if (event.type === "job-completed") {
    currentStep = "completed";
    propertyProgress = null;
    pushActivity("Lavorazione completata", "success");
  } else if (event.type === "sister-keepalive") {
    updateKeepAliveState(event.result);
  } else if (event.type === "property-progress") {
    propertyProgress = { propertyId: event.propertyId, index: event.index, total: event.total, address: event.address, stage: event.stage, message: event.message };
    pushActivity(`Immobile ${event.index}/${event.total}: ${event.message}`);
  } else if (event.details.cancelled === true && cancellingJobId === event.jobId) {
    pushActivity("Arresto del processo completato", "warning");
  } else {
    lastError = event.message;
    pushActivity(event.message, "error");
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
    contacts_matched: "abbinamento recapiti Excel", owners_linked: "collegamento comproprietari",
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

async function runWorker(input: { mode: WorkerMode; dryRun: boolean; jobId?: string }) {
  if (active) throw new Error("È già presente una lavorazione in esecuzione");
  active = true;
  cancellingJobId = null;
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
  });
  pushActivity(input.jobId ? "Ripresa lavorazione richiesta" : "Nuova lavorazione richiesta");
  await publishState();
  const runPromise = runner.run({ mode: input.mode, jobId: input.jobId, createNew: !input.jobId })
    .then(() => undefined)
    .catch((error) => {
      if (cancellingJobId && cancellingJobId === activeJobId) return;
      lastError = error instanceof Error ? error.message : String(error);
      pushActivity(lastError, "error");
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
      new PlaywrightSisterAdapter(tabs.sisterPage).detectPage().catch(() => false),
      new PlaywrightCrmAdapter(tabs.crmPage, true).detectPage().catch(() => false),
    ]);
    checks.push({ id: "results", label: "Risultati pronti", ok: sisterPage, detail: sisterPage ? "Pagina riconosciuta" : "Completa via, civico e ricerca" });
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f2efe4",
    title: "Property Data Worker",
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
  ipcMain.handle("desktop:resume-job", async (_event, jobId: string) => {
    const job = await repository().getJob(jobId);
    await runWorker({ mode: job.mode, dryRun: preferences.dryRun, jobId });
    return true;
  });
  ipcMain.handle("desktop:pause-job", async () => {
    if (!activeJobId) return false;
    await repository().updateJob(activeJobId, { status: "paused" });
    activePrompts?.cancel();
    pushActivity("Pausa richiesta", "warning");
    await publishState();
    return true;
  });
  ipcMain.handle("desktop:cancel-job", async (_event, jobId: string) => {
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
  ipcMain.handle("desktop:save-manual-corrections", async (_event, rawValues: unknown) => {
    const values = manualCorrectionSchema.parse(rawValues);
    const repo = repository();
    const graph = await repo.loadGraph(values.jobId);
    const allowedProperties = new Set(graph.properties.map((row) => row.id));
    const allowedPeople = new Set(graph.people.map((row) => row.id));
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
      const related = graph.ownerships.filter((row) => row.person_id === person.id);
      for (const ownership of related) await repo.updateOwnership(ownership.id, { share_percentage: person.sharePercentage ?? null, processing_status: "extracted" });
    }
    await repo.updateJob(values.jobId, { status: "paused", error_message: null, error_details: { manualCorrection: true } });
    lastError = null;
    pushActivity("Correzioni manuali salvate. La lavorazione può ripartire.", "success");
    await publishState();
    return true;
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
  await loadPreferences();
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
