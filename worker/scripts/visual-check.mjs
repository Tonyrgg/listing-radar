import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(workerRoot, "..", ".runtime", "worker-ui-check");
await mkdir(output, { recursive: true });

const baseState = {
  active: false, activeJobId: null, cancellingJobId: null, currentStep: "ready", prompt: null, lastError: null,
  sisterKeepAlive: { statusLabel: "active", ok: true, checkedAt: new Date().toISOString(), message: "Sessione attiva" },
  activity: [{ at: new Date().toISOString(), tone: "success", message: "Configurazione importata e protetta da Windows" }],
  preferences: { mode: "assisted", dryRun: true, contactsExcelPath: "C:\\Dati\\Book1.xlsx" },
  config: { configurationReady: true, configurationSource: "Protetta da Windows", contactsExcelPath: "C:\\Dati\\Book1.xlsx", screenshotDirectory: "C:\\ListingRadar\\worker-errors" },
  configError: null, jobs: [], version: "0.5.0",
  softwareUpdate: { status: "up_to_date", currentVersion: "0.6.0", availableVersion: null, percent: null, transferred: null, total: null, message: "Il programma è aggiornato", checkedAt: new Date().toISOString() },
};
const graph = {
  job: {},
  properties: [{ id: "11111111-1111-4111-8111-111111111111", municipality: "BITONTO", sheet: "58", parcel: "1234", subaltern: "", category: "A/3", address: "Via Borgo San Francesco 29 [2]", class: "3", consistency: "5 vani", cadastral_income: 540.22 }],
  people: [{ id: "22222222-2222-4222-8222-222222222222", full_name: "Mario Rossi", tax_code: null, birth_place: "BITONTO", birth_province: "BA", birth_date: "1970-01-01", share_original: "500/1000", share_percentage: 50 }],
  ownerships: [],
};

const chromePath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.addInitScript(({ initialState, details }) => {
  let state = initialState;
  let listener = null;
  window.propertyWorker = {
    getState: async () => state,
    onState: (callback) => { listener = callback; return () => {}; },
    runChecks: async () => [
      { id: "chrome", ok: false, detail: "Chrome non raggiungibile su http://127.0.0.1:9222. Avvialo con il pulsante in alto." },
      { id: "sister", ok: false, detail: "La scheda SISTER non è ancora disponibile nel Chrome di lavoro." },
      { id: "crm", ok: true, detail: "Gestionale collegato" },
      { id: "excel", ok: true, detail: "File Excel pronto" },
      { id: "supabase", ok: true, detail: "Connesso" },
    ],
    openChrome: async () => true, chooseExcel: async () => null, savePreferences: async () => true,
    startJob: async () => true, resumeJob: async () => true, pauseJob: async () => true, cancelJob: async () => true,
    answerPrompt: async () => true, getJobDetails: async () => details, saveManualCorrections: async () => true,
    saveInternalConfiguration: async () => true, revealFile: async () => true,
    checkUpdate: async () => true, downloadUpdate: async () => true, installUpdate: async () => true,
  };
  window.__showErrorState = () => {
    state = { ...state, activeJobId: "33333333-3333-4333-8333-333333333333", currentStep: "person_searched", lastError: "Codice fiscale mancante", jobs: [{ id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "data_incomplete", current_step: "person_searched", last_completed_step: "acquisition_reviewed", municipality: "BITONTO", street: "Via Borgo San Francesco", civic_number: "29", error_message: "Codice fiscale mancante", updated_at: new Date().toISOString() }] };
    listener?.(state);
  };
  window.__showPropertyState = () => {
    state = { ...state, active: true, activeJobId: "33333333-3333-4333-8333-333333333333", currentStep: "properties_processed", lastError: null,
      propertyProgress: { propertyId: "11111111-1111-4111-8111-111111111111", index: 2, total: 7, address: "Via Borgo San Francesco 29 [2]", stage: "activity", message: "Creo l'attività dalla scheda dell'immobile" },
      jobs: [{ id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "running", current_step: "properties_processed", last_completed_step: "acquisition_reviewed", municipality: "BITONTO", street: "Via Borgo San Francesco", civic_number: "29", updated_at: new Date().toISOString() }] };
    listener?.(state);
  };
  window.__showUpdateState = () => {
    state = { ...state, active: false, softwareUpdate: { status: "available", currentVersion: "0.6.0", availableVersion: "0.7.0", percent: null, transferred: null, total: null, message: "Versione 0.7.0 disponibile", checkedAt: new Date().toISOString() } };
    listener?.(state);
  };
}, { initialState: baseState, details: graph });
await page.goto(pathToFileURL(path.join(workerRoot, "src", "desktop", "renderer", "index.html")).href);
await page.screenshot({ path: path.join(output, "ready.png"), fullPage: true });
const readyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.getByRole("button", { name: "Controlla se è tutto pronto" }).click();
await page.screenshot({ path: path.join(output, "connections.png"), fullPage: false });
await page.evaluate(() => window.__showPropertyState());
await page.screenshot({ path: path.join(output, "property-progress.png"), fullPage: false });
await page.evaluate(() => window.__showUpdateState());
await page.screenshot({ path: path.join(output, "update-available.png"), fullPage: true });
await page.evaluate(() => window.__showErrorState());
await page.getByRole("button", { name: "Correggi dati qui sotto" }).click();
await page.screenshot({ path: path.join(output, "recovery.png"), fullPage: true });
const recoveryOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log(JSON.stringify({ errors, readyOverflow, recoveryOverflow, output }, null, 2));
await browser.close();
