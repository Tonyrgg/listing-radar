import { existsSync, readFileSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import dotenv from "dotenv";

import { ExcelContactsAdapter, REQUIRED_CONTACT_COLUMNS } from "../adapters/excel/index.js";
import { PlaywrightCrmAdapter } from "../adapters/crm/index.js";
import { PlaywrightSisterAdapter } from "../adapters/sister/index.js";
import { loadConfig, type WorkerConfig } from "../config.js";
import { PropertyWorkerRunner, type RunnerEvent } from "../services/runner.js";
import { connectToChrome, isPresumablyAuthenticated } from "../services/chrome.js";
import { nextKeepAliveDelay, pingSisterSession, type SisterKeepAliveResult } from "../services/sister-keepalive.js";
import { WorkerRepository } from "../services/repository.js";
import type { AssistedDecision } from "../services/prompts.js";
import type { WorkerMode } from "../types.js";
import { DesktopPromptController, type DesktopPrompt } from "./prompts.js";

type Preferences = {
  environmentFilePath?: string;
  contactsExcelPath?: string;
  mode: WorkerMode;
  dryRun: boolean;
};

type ActivityItem = { at: string; tone: "info" | "success" | "warning" | "error"; message: string };
type KeepAliveState = SisterKeepAliveResult & { nextAttemptAt: string | null; statusLabel: "waiting" | "active" | "expired" | "error" | "disabled" };

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(moduleDirectory, "../..");
const defaultPreferences: Preferences = { mode: "assisted", dryRun: true };

let mainWindow: BrowserWindow | null = null;
let preferences: Preferences = defaultPreferences;
let activePrompts: DesktopPromptController | null = null;
let activeJobId: string | null = null;
let active = false;
let prompt: DesktopPrompt | null = null;
let currentStep: string | null = null;
let lastError: string | null = null;
let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
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
}

async function persistPreferences() {
  await writeFile(preferencesPath(), JSON.stringify(preferences, null, 2), "utf8");
}

function workerConfig(overrides: Partial<Preferences> = {}): WorkerConfig {
  const merged = { ...preferences, ...overrides };
  const fileEnvironment: Record<string, string> = {};
  if (merged.environmentFilePath && existsSync(merged.environmentFilePath)) {
    const rootEnvironment = path.resolve(path.dirname(merged.environmentFilePath), "..", ".env.local");
    if (existsSync(rootEnvironment)) Object.assign(fileEnvironment, dotenv.parse(readFileSync(rootEnvironment)));
    Object.assign(fileEnvironment, dotenv.parse(readFileSync(merged.environmentFilePath)));
  }
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

async function stateSnapshot() {
  let jobs: Awaited<ReturnType<WorkerRepository["listJobs"]>> = [];
  let configError: string | null = null;
  let publicConfig: Record<string, unknown> = {};
  try {
    const config = workerConfig();
    publicConfig = {
      environmentFilePath: preferences.environmentFilePath ?? null,
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
    currentStep,
    prompt,
    lastError,
    sisterKeepAlive,
    activity,
    preferences,
    config: publicConfig,
    configError,
    jobs,
    version: app.getVersion(),
  };
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
    pushActivity(`Avvio: ${event.step}`);
  } else if (event.type === "step-completed") {
    currentStep = event.next;
    pushActivity(`Completato: ${event.step}`, "success");
  } else if (event.type === "job-completed") {
    currentStep = "completed";
    pushActivity("Lavorazione completata", "success");
  } else if (event.type === "sister-keepalive") {
    updateKeepAliveState(event.result);
  } else {
    lastError = event.message;
    pushActivity(event.message, "error");
  }
  void publishState();
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
  lastError = null;
  currentStep = null;
  activeJobId = input.jobId ?? null;
  preferences = { ...preferences, mode: input.mode, dryRun: input.dryRun };
  await persistPreferences();
  activePrompts = new DesktopPromptController(publishPrompt);
  const runner = new PropertyWorkerRunner(workerConfig(preferences), { prompts: activePrompts, onEvent: handleRunnerEvent, keepAlive: false });
  pushActivity(input.jobId ? "Ripresa lavorazione richiesta" : "Nuova lavorazione richiesta");
  await publishState();
  void runner.run({ mode: input.mode, jobId: input.jobId, createNew: !input.jobId })
    .catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      pushActivity(lastError, "error");
    })
    .finally(() => {
      active = false;
      activePrompts = null;
      void publishState();
    });
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
  ipcMain.handle("desktop:answer-prompt", (_event, values: { promptId: string; decision?: AssistedDecision }) => {
    activePrompts?.respond(values.promptId, values.decision);
    return true;
  });
  ipcMain.handle("desktop:get-job-details", async (_event, jobId: string) => {
    const repo = repository();
    const [job, graph] = await Promise.all([repo.getJob(jobId), repo.loadGraph(jobId)]);
    return { job, properties: graph.properties, people: graph.people, ownerships: graph.ownerships };
  });
  ipcMain.handle("desktop:reveal-file", (_event, filePath: string) => shell.showItemInFolder(filePath));
}

app.whenReady().then(async () => {
  await loadPreferences();
  registerIpc();
  await createWindow();
  scheduleDesktopKeepAlive(3_000);
});

app.on("before-quit", () => {
  if (keepAliveTimer) clearTimeout(keepAliveTimer);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
