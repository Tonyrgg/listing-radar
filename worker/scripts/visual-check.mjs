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
  configError: null, cloudError: null, jobs: [{
    id: "55555555-5555-4555-8555-555555555555", mode: "automatic", status: "paused",
    current_step: "properties_processed", last_completed_step: "acquisition_reviewed",
    municipality: "BITONTO", street: "Via Test", civic_number: null,
    total_properties: 3, processed_properties: 2, total_people: 1,
    saved_at: new Date().toISOString(), import_started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    acquisition: { kind: "street", importOptions: { activityMode: "plain", importCoOwners: true, parallelCrmWindows: false } },
  }, {
    id: "77777777-7777-4777-8777-777777777777", mode: "automatic", status: "paused",
    current_step: "ready", last_completed_step: null,
    municipality: "BITONTO", street: "Via Raffaele Comes", civic_number: null,
    total_properties: 2, processed_properties: 0, total_people: 2,
    saved_at: new Date().toISOString(), import_started_at: null, updated_at: new Date().toISOString(),
    acquisition: {
      engine: "lavorazione", strategy: "bulk_exact_variants",
      runSettings: { street: "Via Raffaele Comes", expandAllOwners: true, keepAcquisition: true, filters: { residentialOnly: true } },
      importOptions: { activityMode: "killer", importCoOwners: true, parallelCrmWindows: true },
      acquisitionProgress: {
        state: "paused", position: 3, total: 150, totalIsFinal: true,
        completed: 2, completedWithAnomalies: 0, skipped: 0, remaining: 148,
        currentLabel: "Via Raffaele Comes 8 · F. 42 · P. 180 · S. 3",
        currentOwnerNames: ["Mario Rossi"], variant: 1, variants: 1,
      },
      acquisitionCheckpoint: { results: [{ recordLedger: [] }] },
    },
  }], completedImports: [], version: "0.5.0",
  streetRun: { active: false, cancelling: false, checkpoint: null, lastError: null },
  refinement: {
    active: false, street: null, phase: "idle", progress: null, lastError: null,
    jobs: [{
      id: "66666666-6666-4666-8666-666666666666", mode: "automatic", status: "paused",
      municipality: "BITONTO", street: "Via Luigi Castellucci", civic_number: null,
      total_properties: 30, total_people: 42, processed_properties: 9,
      saved_at: new Date().toISOString(), import_started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      acquisition: { engine: "rifinitura", strategy: "street_refinement", street: "Via Luigi Castellucci", activityMode: "plain", importCoOwners: true, parallelCrmWindows: false },
      import_progress: { total: 30, handled: 9, completed: 8, completedWithAnomalies: 1, skipped: 0 },
    }], completedImports: [], completedImportsHasMore: false, diagnosticErrors: [],
  },
  portoni: { active: false, cancelling: false, progress: null, lastError: null, sheets: [{
    id: "portoni-demo", street: "Via Luigi Castellucci", municipality: "BITONTO", status: "draft",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), generatedAt: null, documentPath: null,
    rows: [{ id: "BITONTO|1|2|3", cadastralKey: "1/2/3", sisterNames: "Mario Rossi · Proprietà 1/2 · 12/03/1970\nLucia Bianchi · Proprietà 1/2 · 08/09/1972", actualNames: "",
      civicAndStair: "Civico 12 · Scala B", floorAndInternal: "Piano 2 · Interno 4", telephone: "3331234567",
      outcome: "", visitedAt: "", notes: "", category: "A/3", ownership: "" }],
  }] },
  retryMonitor: null,
  softwareUpdate: { status: "up_to_date", currentVersion: "0.6.0", availableVersion: null, percent: null, transferred: null, total: null, message: "Il programma è aggiornato", checkedAt: new Date().toISOString() },
};
const graph = {
  job: {},
  progress: { state: "stopped", handled: 2, total: 3, nextRow: 1 },
  properties: [
    { id: "11111111-1111-4111-8111-111111111111", municipality: "BITONTO", sheet: "58", parcel: "1234", subaltern: "7", cadastral_key: "BITONTO|58|1234|7", category: "A/3", address: "Via Borgo San Francesco 29 [2]", class: "3", consistency: "5 vani", cadastral_income: 540.22, processing_status: "normalized", raw_payload: { property_flow: { version: 4, stage: "property_ready" } } },
    { id: "11111111-1111-4111-8111-111111111112", municipality: "BITONTO", sheet: "58", parcel: "1235", subaltern: "8", cadastral_key: "BITONTO|58|1235|8", category: "A/3", address: "Via Borgo San Francesco 31", class: "3", consistency: "5 vani", cadastral_income: 520.1, processing_status: "completed", raw_payload: { property_flow: { version: 4, stage: "completed" } } },
    { id: "11111111-1111-4111-8111-111111111113", municipality: "BITONTO", sheet: "58", parcel: "1236", subaltern: "9", cadastral_key: "BITONTO|58|1236|9", category: "A/2", address: "Via Borgo San Francesco 33", class: "2", consistency: "6 vani", cadastral_income: 610.4, processing_status: "completed", raw_payload: { property_flow: { version: 4, stage: "completed" } } },
  ],
  people: [{ id: "22222222-2222-4222-8222-222222222222", full_name: "Mario Rossi", tax_code: null, birth_place: "BITONTO", birth_province: "BA", birth_date: "1970-01-01", share_original: "500/1000", share_percentage: 50 }],
  ownerships: [{ id: "44444444-4444-4444-8444-444444444444", property_id: "11111111-1111-4111-8111-111111111111", person_id: "22222222-2222-4222-8222-222222222222", share_percentage: 50 }],
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
  window.confirm = () => true;
  let state = initialState;
  const listeners = [];
  const transientUpdateListeners = [];
  const streetRunProgressListeners = [];
  const calls = {};
  const called = (name, result = true) => { calls[name] = (calls[name] ?? 0) + 1; return result; };
  window.propertyWorker = {
    getState: async () => state,
    recordUiAction: async (entry) => { (calls.uiActions ??= []).push(entry); return true; },
    onState: (callback) => { listeners.push(callback); return () => {}; },
    onTransientUpdate: (callback) => { transientUpdateListeners.push(callback); return () => {}; },
    runChecks: async () => [
      { id: "chrome", ok: false, detail: "Chrome non raggiungibile su http://127.0.0.1:9222. Avvialo con il pulsante in alto." },
      { id: "sister", ok: false, detail: "La scheda SISTER non è ancora disponibile nel Chrome di lavoro." },
      { id: "crm", ok: true, detail: "Gestionale collegato" },
      { id: "excel", ok: true, detail: "File Excel pronto" },
      { id: "supabase", ok: true, detail: "Connesso" },
    ],
    openChrome: async () => called("openChrome"), chooseExcel: async () => { called("chooseExcel"); return null; }, savePreferences: async (values) => {
      called("savePreferences");
      state = { ...state, preferences: { ...state.preferences, ...values } };
      return state.preferences;
    },
    startJob: async () => called("startJob"), resumeJob: async (values) => { calls.resumeJobValues = values; return called("resumeJob"); }, pauseJob: async () => called("pauseJob"), cancelJob: async () => called("cancelJob"),
    startStreetRun: async () => called("startStreetRun"), cancelStreetRun: async () => called("cancelStreetRun"),
    startRefinement: async () => called("startRefinement"),
    startPortoni: async () => called("startPortoni"), cancelPortoni: async () => called("cancelPortoni"),
    createBlankPortoni: async () => called("createBlankPortoni"),
    savePortoni: async () => called("savePortoni"), generatePortoni: async () => called("generatePortoni", "C:\\Dati\\portoni.pdf"),
    abandonStreetRun: async () => called("abandonStreetRun"), stopAll: async () => called("stopAll"),
    startRequestArchiveImport: async () => called("startRequestArchiveImport"), cancelRequestArchiveImport: async () => called("cancelRequestArchiveImport"),
    startMandateArchiveImport: async () => called("startMandateArchiveImport"), cancelMandateArchiveImport: async () => called("cancelMandateArchiveImport"),
    setAutoRetryEnabled: async () => called("setAutoRetryEnabled"), skipProperty: async () => { called("skipProperty"); return { pending: true }; },
    loadMoreCompleted: async () => true,
    answerPrompt: async () => true, getJobDetails: async () => details, saveManualCorrections: async () => true,
    removeJobProperty: async () => ({ propertyId: details.properties[0].id, removedPersonIds: [details.people[0].id], remainingProperties: 0 }),
    saveInternalConfiguration: async () => true, revealFile: async () => true,
    checkUpdate: async () => true, downloadUpdate: async () => true, installUpdate: async () => true,
    cancelUpdateDownload: async () => called("cancelUpdateDownload"),
    onStreetRunProgress: (callback) => { streetRunProgressListeners.push(callback); return () => {}; },
  };
  window.__workerCalls = () => structuredClone(calls);
  window.__showErrorState = () => {
    state = { ...state, activeJobId: "33333333-3333-4333-8333-333333333333", currentStep: "person_searched", lastError: "Codice fiscale mancante", jobs: [{ id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "data_incomplete", current_step: "person_searched", last_completed_step: "acquisition_reviewed", municipality: "BITONTO", street: "Via Borgo San Francesco", civic_number: "29", error_message: "Codice fiscale mancante", updated_at: new Date().toISOString() }] };
    listeners.forEach((callback) => callback(state));
  };
  window.__showPropertyState = () => {
    state = { ...state, active: true, requestArchive: { active: false }, mandateArchive: { active: false }, activeJobId: "33333333-3333-4333-8333-333333333333", currentStep: "properties_processed", lastError: null,
      propertyProgress: { propertyId: "11111111-1111-4111-8111-111111111111", index: 2, total: 7, address: "Via Borgo San Francesco 29 [2]", stage: "activity", message: "Creo l'attività dalla scheda dell'immobile" },
      jobs: [{ id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "running", current_step: "properties_processed", last_completed_step: "acquisition_reviewed", municipality: "BITONTO", street: "Via Borgo San Francesco", civic_number: "29", updated_at: new Date().toISOString() }] };
    listeners.forEach((callback) => callback(state));
  };
  window.__showUpdateState = () => {
    state = { ...state, active: false, softwareUpdate: { status: "available", currentVersion: "0.6.0", availableVersion: "0.7.0", percent: null, transferred: null, total: null, message: "Versione 0.7.0 disponibile", checkedAt: new Date().toISOString() } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showCloudRestrictedState = () => {
    state = {
      ...state,
      active: false,
      configError: null,
      cloudError: "Supabase ha limitato temporaneamente il progetto (HTTP 402/quota).",
      softwareUpdate: { status: "available", currentVersion: "0.15.1", availableVersion: "0.16.0", percent: null, transferred: null, total: null, message: "Versione 0.16.0 disponibile", checkedAt: new Date().toISOString() },
    };
    listeners.forEach((callback) => callback(state));
  };
  window.__showStreetRunState = () => {
    state = { ...state, streetRun: { active: true, cancelling: false, lastError: null, checkpoint: {
      version: 2, requestedStreet: "VIA BORGO SAN FRANCESCO", municipality: "BITONTO", status: "running",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
      nextCivicNumber: 36, currentVariantIndex: 0, emptyWindow: 50,
      consecutiveEmptyByVariant: { "542250:1": 4, "557509:1": 1 },
      variants: [
        { key: "542250:1", value: "542250#236#VIA BORGO SAN FRANCESCO", text: "VIA BORGO SAN FRANCESCO", sourceId: "542250", occurrence: 1 },
        { key: "557509:1", value: "557509#236#VIA BORGO SAN FRANCESCO", text: "VIA BORGO SAN FRANCESCO", sourceId: "557509", occurrence: 1 },
      ],
      results: [], totalRawRecords: 70, totalAcceptedOccurrences: 70, totalAcceptedProperties: 68, uniquePropertyKeys: [], totalOwnersRead: 117,
      totalSkippedPropertyRows: 0, lastError: null, inferredLastUsefulCivic: null,
    } } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showRetryState = () => {
    state = { ...state, active: true, retryMonitor: {
      runType: "import", operation: "Attività immobile", attempt: 2, maximumAttempts: 3,
      status: "waiting", nextRetryAt: new Date(Date.now() + 45_000).toISOString(), updatedAt: new Date().toISOString(),
    } };
    transientUpdateListeners.forEach((callback) => callback({ retryMonitor: state.retryMonitor }));
  };
  window.__showStreetRunProgress = () => {
    streetRunProgressListeners.forEach((callback) => callback({
      phase: "reading-owners", variantIndex: 0, variantTotal: 2, variantSourceId: "542250",
      current: 413, total: 1743, address: "VIA BORGO SAN FRANCESCO n. 29",
    }));
  };
  window.__showPausedStreetRunState = () => {
    state = { ...state, streetRun: { ...state.streetRun, active: false, cancelling: false, checkpoint: { ...state.streetRun.checkpoint, status: "paused" } } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showPartialArchives = () => {
    state = { ...state, streetRun: { active: false, cancelling: false, checkpoint: null, lastError: null }, requestArchive: { active: false, cancelling: false, latestRun: { id: "request-run", status: "cancelled", processed_requests: 12, failed_requests: 0 } }, mandateArchive: { active: false, cancelling: false, latestRun: { id: "mandate-run", status: "failed", processed_mandates: 5, failed_mandates: 1 } } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showDownloadingUpdate = () => {
    state = { ...state, active: false, softwareUpdate: { status: "downloading", currentVersion: "0.12.0", availableVersion: "0.13.0", percent: 42, transferred: 42, total: 100, message: "Scaricamento 42%" } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showRequestProgress = () => {
    state = { ...state, active: false, streetRun: { ...state.streetRun, active: false }, requestArchive: { active: true, cancelling: false, progress: { phase: "detail", index: 413, total: 1000, title: "Richiesta Via Roma", failed: 2 } }, mandateArchive: { active: false } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showMandateProgress = () => {
    state = { ...state, active: false, requestArchive: { active: false }, mandateArchive: { active: true, cancelling: false, progress: { phase: "detail", index: 88, total: 250, title: "Incarico Via Traetta", failed: 0 } } };
    listeners.forEach((callback) => callback(state));
  };
  window.__showCompletedState = () => {
    const completedJob = { id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "completed", current_step: "completed", last_completed_step: "completed", municipality: "BITONTO", street: "Via Borgo San Francesco", civic_number: "29", total_properties: 1, processed_properties: 1, total_people: 1, processed_people: 1, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const completedGraph = { ...details, job: completedJob, properties: details.properties.map((property) => ({ ...property, cadastral_key: "BITONTO|58|1234|7", raw_payload: { worker_activity: { state: "created" } }, processing_status: "synced" })), people: details.people.map((person) => ({ ...person, mobiles: ["3331234567"], landlines: [], emails: ["mario@example.test"] })) };
    state = { ...state, active: false, cloudError: null, activeJobId: completedJob.id, currentStep: "completed", lastError: "Vecchio errore che non deve essere mostrato", jobs: [], completedImports: [{ ...completedGraph, job: completedJob }] };
    listeners.forEach((callback) => callback(state));
  };
}, { initialState: baseState, details: graph });
await page.goto(pathToFileURL(path.join(workerRoot, "src", "desktop", "renderer", "index.html")).href);
await page.screenshot({ path: path.join(output, "ready.png"), fullPage: true });
const readyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: path.join(output, "ready-mobile.png"), fullPage: true });
const readyMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.setViewportSize({ width: 1440, height: 1000 });
const sideNavigationVisible = await page.locator(".side-nav-shell").isVisible();
const initialTheme = await page.locator("html").getAttribute("data-theme");
await page.locator("#themeToggle").click();
const darkThemeApplied = await page.locator("html").getAttribute("data-theme") === "dark";
await page.locator("#themeToggle").click();
await page.locator('[data-record-id="55555555-5555-4555-8555-555555555555"] .ledger-place').click();
const inspectorSelectionVisible = await page.locator("#inspectorTitle").getByText("BITONTO · Via Test", { exact: true }).count();
const stoppedRunVisible = await page.getByText(/Interrotta · 2 eseguite.*1 aperta/).count();
const exactAcquisitionCursorVisible = await page.getByText("Riparte dalla riga 3 di 150", { exact: true }).count();
const exactAcquisitionOwnerVisible = await page.getByText(/Prossimo record: Mario Rossi/).count();
await page.locator('.row-primary[data-resume-job="55555555-5555-4555-8555-555555555555"]').click();
await page.locator("#importDialog").screenshot({ path: path.join(output, "resume-import.png") });
const resumeProgressVisible = await page.getByText("Prima riga aperta: 1 di 3", { exact: true }).count();
const nonContiguousProgressExplained = await page.getByText("Alcune righe successive sono già concluse perché le finestre Cloud lavorano in parallelo. Alla ripresa non verranno ripetute.", { exact: true }).count();
const importKillerChoiceVisible = await page.locator('[data-import-activity="killer"]:visible').count();
const lockedImportChoices = await page.locator("#importDialog [data-import-activity], #importCoOwnersToggle, #importParallelCloudToggle").evaluateAll((elements) => elements.every((element) => element.disabled));
const lockedImportExplanationVisible = await page.getByText("Impostazioni bloccate alla partenza", { exact: false }).count();
const importKillerHelpVisible = 0;
await page.locator('[data-import-dialog="confirm"]').click();
await page.locator('[data-record-id="55555555-5555-4555-8555-555555555555"] .row-overflow > summary').click();
await page.locator('[data-record-id="55555555-5555-4555-8555-555555555555"] [data-detail-job="55555555-5555-4555-8555-555555555555"]').click();
await page.locator("#jobDetailDialog").screenshot({ path: path.join(output, "stopped-import-detail.png") });
const detailRestartRowVisible = await page.getByText(/Prima riga aperta: 1 di 3/).count();
const civicMarkersVisible = await page.locator("#jobDetailDialog .detail-row-civic").count();
await page.locator('[data-job-detail="close"]').last().click();
await page.locator('[data-scroll="refinement"]').click();
await page.locator("#refinement").screenshot({ path: path.join(output, "refinement.png") });
const refinementVisible = await page.locator("#refinementStart:visible").count();
const refinementBoundaryVisible = await page.getByText("Non crea nuove schede immobili.", { exact: false }).count();
const refinementArchiveVisible = await page.getByText("Via Luigi Castellucci", { exact: true }).count();
const refinementOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.locator('[data-scroll="history"]').click();
await page.locator("#diagnosticErrors").screenshot({ path: path.join(output, "automatic-run-auditor.png") });
const automaticAuditorVisible = await page.getByText("Sorveglianza automatica · attiva su ogni run", { exact: true }).count();
const automaticAuditorNoManualStart = await page.locator('#collaudoStart, [data-scroll="collaudo"]').count() === 0;
const historyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.locator('[data-scroll="portoni"]').click();
await page.locator("#portoni").screenshot({ path: path.join(output, "portoni.png") });
const portoniVisible = await page.locator("#portoniEditor:not(.is-hidden)").count();
const portoniOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.locator("#portoniToggle").click();
const portoniCollapsed = await page.locator("#portoniEditor.is-collapsed").count();
await page.locator("#portoniToggle").click();
const portoniFiltersVisible = await page.locator("#portoniFloorMode:visible").count();
await page.locator('[data-scroll="operations"]').click();
const runSlideHeights = {};
for (const slide of ["civic", "street", "network"]) {
  await page.locator(`[data-run-slide-target="${slide}"]`).click();
  runSlideHeights[slide] = await page.locator(`[data-run-slide="${slide}"]`).evaluate((element) => element.getBoundingClientRect().height);
  if (slide === "network") await page.locator(".run-launcher").screenshot({ path: path.join(output, "network-ready.png") });
}
const runSlideHeightSpread = Math.max(...Object.values(runSlideHeights)) - Math.min(...Object.values(runSlideHeights));
const networkPreparationOverflow = await page.locator('[data-run-slide="network"]').evaluate((element) => element.scrollHeight > element.clientHeight + 1);
await page.locator('[data-run-slide-target="civic"]').click();
await page.locator('[data-mode="automatic"]').click();
const activityModeSelections = [];
for (const mode of ["plain", "killer", "none", "direct_contact"]) {
  await page.locator(`[data-activity-mode="${mode}"]`).click();
  activityModeSelections.push(await page.locator(`[data-activity-mode="${mode}"]`).getAttribute("aria-checked"));
}
await page.locator("#parallelCloudToggle").check();
const parallelCloudEnabled = await page.locator("#parallelCloudToggle").isChecked();
await page.locator("#chromeButton").evaluate((button) => button.click());
await page.locator("#startButton").click();
await page.locator('[data-run-slide-target="street"]').click();
await page.locator("#streetRunInput").fill("via borgo san francesco");
await page.locator("#streetRunStart").click();
await page.locator('[data-scroll="sync"]').click();
await page.locator("#requestArchiveStart").click();
await page.locator("#mandateArchiveStart").click();
const commandMonitorAcknowledged = await page.getByText("Sincronizza archivio incarichi", { exact: true }).count();
await page.evaluate(() => { const button = document.createElement("button"); button.id = "unroutedTestButton"; button.textContent = "Comando di prova non collegato"; document.body.appendChild(button); });
await page.locator("#unroutedTestButton").click();
await page.waitForFunction(() => window.__workerCalls().uiActions?.some((entry) => entry.action === "unroutedTestButton" && entry.status === "failed"));
const unknownCommandFailureRecorded = (await page.evaluate(() => window.__workerCalls().uiActions.filter((entry) => entry.action === "unroutedTestButton" && entry.status === "failed").length));
await page.locator('[data-scroll="operations"]').click();
await page.evaluate(() => window.__showStreetRunState());
await page.evaluate(() => window.__showStreetRunProgress());
await page.locator('[data-scroll="sync"]').click();
const navigationDuringRunVisible = await page.evaluate(() =>
  document.body.dataset.workerView === "sync" && document.querySelector("#sync")?.open === true,
);
const secondaryActionsLocked = await page.locator("#sync").evaluate((section) =>
  section.inert === false && document.querySelector("#requestArchiveStart")?.disabled === true,
);
await page.locator('[data-scroll="operations"]').click();
await page.locator("#operationConsole").screenshot({ path: path.join(output, "street-run.png") });
await page.locator("#stopAllButton").click();
const streetRunProgressVisible = await page.getByText("Leggo gli intestatari 413 di 1743", { exact: false }).count();
const streetMonitorText = await page.locator("#commandMonitor").innerText();
const streetRunOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.setViewportSize({ width: 390, height: 844 });
await page.locator("#operationConsole").screenshot({ path: path.join(output, "street-run-mobile.png") });
const streetRunMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.setViewportSize({ width: 1440, height: 1000 });
await page.evaluate(() => window.__showPausedStreetRunState());
await page.evaluate(() => window.__showPartialArchives());
await page.locator('[data-scroll="sync"]').click();
await page.locator("#requestArchiveNew").click();
await page.locator("#mandateArchiveNew").click();
await page.evaluate(() => window.__showDownloadingUpdate());
await page.locator('[data-scroll="settings"]').click();
await page.locator("#settings").evaluate((element) => { element.open = true; });
await page.locator("#softwareUpdateCancel").click();
await page.locator('[data-scroll="operations"]').click();
await page.evaluate(() => window.__showRequestProgress());
const requestMonitorVisible = await page.getByText("Importazione di 1.000 richieste", { exact: true }).count();
await page.evaluate(() => window.__showMandateProgress());
const mandateMonitorVisible = await page.getByText("Importazione di 250 incarichi", { exact: true }).count();
/* Lo stato dei collegamenti vive nella pastiglia della testata; la barra
 * d'errore compare solo quando c'e qualcosa da sistemare. */
await page.locator("#connectionPill").screenshot({ path: path.join(output, "connections.png") });
await page.evaluate(() => window.__showPropertyState());
await page.locator('#actionPanel [data-action="pause"]').click();
await page.getByRole("button", { name: "Salta immobile" }).click();
const workerCalls = await page.evaluate(() => window.__workerCalls());
const propertyMonitorVisible = await page.getByText("Importazione di 7 immobili", { exact: true }).count();
await page.screenshot({ path: path.join(output, "property-progress.png"), fullPage: false });
await page.evaluate(() => window.__showRetryState());
await page.screenshot({ path: path.join(output, "retry-monitor.png"), fullPage: false });
const retryMonitorVisible = await page.locator("#retryMonitor:not(.is-hidden)").count();
const retryAttemptVisible = await page.getByText("Prossimo tentativo 2 di 3", { exact: true }).count();
await page.evaluate(() => window.__showUpdateState());
await page.screenshot({ path: path.join(output, "update-available.png"), fullPage: true });
await page.evaluate(() => window.__showCloudRestrictedState());
const cloudPanelText = await page.locator("#actionPanel").textContent();
const cloudRestrictionVisible = cloudPanelText?.includes("Le operazioni cloud restano ferme in sicurezza") === true;
const runDisabledDuringRestriction = await page.locator("#startButton").isDisabled();
const updaterEnabledDuringRestriction = await page.locator("#softwareUpdateAction").isEnabled();
await page.evaluate(() => window.__showCompletedState());
await page.screenshot({ path: path.join(output, "completed-import.png"), fullPage: true });
const successHeading = await page.getByRole("heading", { name: "Import eseguito con successo" }).count();
const staleErrorVisible = await page.getByText("La pagina del portale è diversa da quella attesa", { exact: false }).count();
await page.evaluate(() => window.__showErrorState());
await page.getByRole("button", { name: "Correggi dati qui sotto" }).click();
await page.screenshot({ path: path.join(output, "recovery.png"), fullPage: true });
await page.getByRole("button", { name: "Rimuovi questo immobile dalla lavorazione" }).first().click();
await page.screenshot({ path: path.join(output, "recovery-remove-confirmation.png"), fullPage: true });
const removalConfirmationVisible = await page.getByText("Rimuovere questo immobile dalla lavorazione?").count();
const recoveryOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
console.log(JSON.stringify({ errors, readyOverflow, readyMobileOverflow, sideNavigationVisible, initialTheme, darkThemeApplied, inspectorSelectionVisible, stoppedRunVisible, exactAcquisitionCursorVisible, exactAcquisitionOwnerVisible, resumeProgressVisible, nonContiguousProgressExplained, importKillerChoiceVisible, importKillerHelpVisible, lockedImportChoices, lockedImportExplanationVisible, detailRestartRowVisible, civicMarkersVisible, refinementVisible, refinementBoundaryVisible, refinementArchiveVisible, refinementOverflow, automaticAuditorVisible, automaticAuditorNoManualStart, historyOverflow, portoniVisible, portoniOverflow, portoniCollapsed, portoniFiltersVisible, runSlideHeights, runSlideHeightSpread, networkPreparationOverflow, activityModeSelections, parallelCloudEnabled, navigationDuringRunVisible, secondaryActionsLocked, streetRunOverflow, streetRunMobileOverflow, streetRunProgressVisible, streetMonitorText, requestMonitorVisible, mandateMonitorVisible, propertyMonitorVisible, retryMonitorVisible, retryAttemptVisible, commandMonitorAcknowledged, unknownCommandFailureRecorded, workerCalls, cloudRestrictionVisible, runDisabledDuringRestriction, updaterEnabledDuringRestriction, recoveryOverflow, successHeading, staleErrorVisible, removalConfirmationVisible, output }, null, 2));
await browser.close();
const failures = [
  ...(errors.length ? [`Errori JavaScript: ${errors.join("; ")}`] : []),
  ...(!sideNavigationVisible || initialTheme !== "light" || !darkThemeApplied || inspectorSelectionVisible !== 1 ? ["Guscio, tema o ispettore del registro non funzionanti"] : []),
  ...([readyOverflow, readyMobileOverflow, refinementOverflow, historyOverflow, portoniOverflow, streetRunOverflow, streetRunMobileOverflow, recoveryOverflow].some(Boolean)
    ? ["Overflow orizzontale rilevato"] : []),
  ...(runSlideHeightSpread > 1 ? ["Le tre run non hanno la stessa altezza"] : []),
  ...(stoppedRunVisible !== 1 || resumeProgressVisible !== 1 || nonContiguousProgressExplained < 1 || detailRestartRowVisible < 1 || civicMarkersVisible < 1 ? ["Stato, civico o riga di ripartenza della run non visibili"] : []),
  ...(exactAcquisitionCursorVisible !== 1 || exactAcquisitionOwnerVisible < 1 ? ["Checkpoint SISTER esatto o prossimo nominativo non visibili"] : []),
  ...(importKillerChoiceVisible !== 1 || !lockedImportChoices || lockedImportExplanationVisible < 1 ? ["Le impostazioni della run interrotta non sono visibili e bloccate"] : []),
  ...(workerCalls.resumeJob !== 1 || workerCalls.resumeJobValues?.activityMode !== "plain" || workerCalls.resumeJobValues?.importCoOwners !== true || workerCalls.resumeJobValues?.parallelCrmWindows !== false
    ? ["La ripresa non conserva le tre impostazioni originarie"] : []),
  ...(portoniVisible !== 1 ? ["Editor Portoni non visibile"] : []),
  ...(refinementVisible !== 1 || refinementBoundaryVisible < 1 || refinementArchiveVisible < 1 ? ["Pagina o archivio Rifinitura non visibile o confine operativo assente"] : []),
  ...(automaticAuditorVisible !== 1 || !automaticAuditorNoManualStart ? ["La sorveglianza automatica non è integrata nella Cronologia o conserva ancora un avvio manuale"] : []),
  ...(portoniCollapsed !== 1 || portoniFiltersVisible !== 1 ? ["Accordion o filtri Portoni non funzionanti"] : []),
  ...(networkPreparationOverflow ? ["La preparazione rete proprietari richiede uno scroll interno"] : []),
  ...(activityModeSelections.length !== 4 || activityModeSelections.some((selected) => selected !== "true") ? ["Le quattro modalità attività non confermano la selezione salvata"] : []),
  ...(!parallelCloudEnabled ? ["La preferenza per due finestre Cloud non resta selezionata"] : []),
  ...(!navigationDuringRunVisible ? ["Le pagine secondarie non restano consultabili durante una run"] : []),
  ...(!secondaryActionsLocked ? ["L'avvio di un secondo motore non viene bloccato lasciando consultabile l'archivio"] : []),
  ...(streetRunProgressVisible !== 1 ? ["Avanzamento interno long mode non visibile"] : []),
  ...(!streetMonitorText.includes("Voce 413 di 1.743") ? ["Contatore voce/totale della long mode non visibile"] : []),
  ...(requestMonitorVisible < 1 ? ["Totale import richieste non visibile"] : []),
  ...(mandateMonitorVisible < 1 ? ["Totale import incarichi non visibile"] : []),
  ...(propertyMonitorVisible !== 1 ? ["Totale import immobili non visibile"] : []),
  ...(retryMonitorVisible !== 1 || retryAttemptVisible !== 1 ? ["Contatore tentativi e timer non visibili"] : []),
  ...(commandMonitorAcknowledged !== 1 ? ["Conferma immediata del comando non visibile"] : []),
  ...(unknownCommandFailureRecorded !== 1 ? ["Pulsante non collegato non segnalato come errore"] : []),
  ...(!cloudRestrictionVisible || !runDisabledDuringRestriction || !updaterEnabledDuringRestriction
    ? ["Stato HTTP 402 non separa correttamente blocco run e aggiornamenti"] : []),
  ...(["openChrome", "startJob", "startStreetRun", "stopAll", "cancelUpdateDownload", "pauseJob", "skipProperty"].filter((name) => workerCalls[name] !== 1).map((name) => `Comando non eseguito esattamente una volta: ${name}`)),
  ...(workerCalls.savePreferences !== 6 ? [`Le preferenze modalità/avvio non sono state salvate sei volte: ${workerCalls.savePreferences ?? 0}`] : []),
  ...(["startRequestArchiveImport", "startMandateArchiveImport"].filter((name) => workerCalls[name] !== 2).map((name) => `Comando nuovo/ripresa non eseguito due volte: ${name}`)),
  ...((workerCalls.uiActions?.filter((entry) => entry.status === "started").length ?? 0) < 8 ? ["Registro UI incompleto: mancano comandi ricevuti"] : []),
  ...(successHeading !== 1 ? ["Riepilogo import completato non visibile"] : []),
  ...(staleErrorVisible !== 0 ? ["Errore obsoleto ancora visibile"] : []),
  ...(removalConfirmationVisible !== 1 ? ["Conferma rimozione immobile non visibile"] : []),
];
if (failures.length) throw new Error(failures.join(" | "));
