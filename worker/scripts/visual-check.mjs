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
    }, {
      id: "88888888-8888-4888-8888-888888888888", mode: "automatic", status: "saved",
      municipality: "BITONTO", street: "Via Cesare Cantu", civic_number: null,
      total_properties: 0, total_people: 0, processed_properties: 0,
      saved_at: new Date().toISOString(), import_started_at: null, updated_at: new Date().toISOString(),
      acquisition: {
        engine: "rifinitura", strategy: "street_refinement", refinementOrigin: "completed_lavorazione",
        refinementSourceJobId: "99999999-9999-4999-8999-999999999999", refinementCloudStreet: "Via Cesare Cantu",
        runSettings: { street: "Via Cesare Cantu", refinementCloudStreet: "Via Cesare Cantu", filters: { residentialOnly: false } },
        importOptions: { activityMode: "plain", importCoOwners: true, parallelCrmWindows: false },
      },
      import_progress: { total: 0, handled: 0, completed: 0, completedWithAnomalies: 0, skipped: 0 },
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
    acquireOpenTabs: async () => ({
      total: 2, processed: 2, running: false, message: "Acquisizione terminata.",
      results: [
        { url: "https://example.test/annuncio/1", state: "new" },
        { url: "https://example.test/annuncio/2", state: "review", message: "La pagina dichiara il codice di un altro annuncio." },
      ],
    }),
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
    answerPrompt: async () => true, getJobDetails: async (jobId) => state.completedImports?.find((item) => item.job?.id === jobId) ?? details, saveManualCorrections: async () => true,
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
  window.__showLongPropertyState = () => {
    details.properties = Array.from({ length: 40 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      municipality: "BITONTO",
      sheet: "41",
      parcel: "661",
      subaltern: String(index + 1),
      cadastral_key: `BITONTO|41|661|${index + 1}`,
      category: "A/3",
      address: `Via Francesco Muciaccia 3 · Interno ${index + 1}`,
      processing_status: index < 24 ? "completed" : "normalized",
      raw_payload: { property_flow: { version: 4, stage: index < 24 ? "completed" : "property_ready" } },
    }));
    state = {
      ...state,
      active: true,
      requestArchive: { active: false },
      mandateArchive: { active: false },
      activeJobId: "33333333-3333-4333-8333-333333333333",
      currentStep: "properties_processed",
      lastError: null,
      propertyProgress: {
        propertyId: details.properties[24].id,
        index: 25,
        completed: 24,
        total: 40,
        address: details.properties[24].address,
        stage: "long-queue-regression",
        message: "Creo il record nel gestionale",
      },
      jobs: [{ id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "running", current_step: "properties_processed", last_completed_step: "acquisition_reviewed", municipality: "BITONTO", street: "Via Francesco Muciaccia", civic_number: null, updated_at: new Date().toISOString() }],
    };
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
    const completedJob = { id: "33333333-3333-4333-8333-333333333333", mode: "automatic", status: "completed", current_step: "completed", last_completed_step: "completed", municipality: "BITONTO", street: "Via Borgo San Francesco", civic_number: null, total_properties: details.properties.length, processed_properties: details.properties.length, total_people: 1, processed_people: 1, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), acquisition: { engine: "lavorazione", strategy: "bulk_exact_variants", runSettings: { street: "Via Borgo San Francesco", filters: { minCivicNumber: 20, maxCivicNumber: 40, residentialOnly: true } }, importOptions: { activityMode: "plain", importCoOwners: true, parallelCrmWindows: true } } };
    const mergeJob = { ...completedJob, id: "44444444-4444-4444-8444-444444444445", completed_at: new Date(Date.now() - 86_400_000).toISOString(), updated_at: new Date(Date.now() - 86_400_000).toISOString(), acquisition: { ...completedJob.acquisition, runSettings: { ...completedJob.acquisition.runSettings, filters: { minCivicNumber: 1, maxCivicNumber: 20, residentialOnly: true } } } };
    const completedGraph = { ...details, job: completedJob, progress: { state: "completed", handled: details.properties.length, total: details.properties.length, nextRow: details.properties.length + 1 }, properties: details.properties.map((property) => ({ ...property, cadastral_key: property.cadastral_key, raw_payload: { worker_activity: { state: "created" } }, processing_status: "synced" })), people: details.people.map((person) => ({ ...person, mobiles: ["3331234567"], landlines: [], emails: ["mario@example.test"] })) };
    state = { ...state, active: false, cloudError: null, activeJobId: completedJob.id, currentStep: "completed", lastError: "Vecchio errore che non deve essere mostrato", jobs: [], completedImports: [{ ...completedGraph, job: completedJob }, { ...completedGraph, job: mergeJob }] };
    listeners.forEach((callback) => callback(state));
  };
}, { initialState: baseState, details: graph });
try {
  await page.goto(pathToFileURL(path.join(workerRoot, "src", "desktop", "renderer", "index.html")).href);
  await page.waitForFunction(version => document.querySelector("#versionLabel").textContent === "v" + version, baseState.version);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const selector = (view) => `[data-scroll="${view}"]`;
  const available = ["worker-v2", "agencies", "sync", "settings"];
  const nav = await page.locator(".nav-item[data-scroll]").evaluateAll(items => items.map(item => item.dataset.scroll));
  assert(JSON.stringify(nav) === JSON.stringify(available), "Voci di navigazione inattese");
  assert(await page.locator("body").getAttribute("data-worker-view") === "worker-v2", "Il Worker deve partire dalla mappa");
  for (const view of available) {
    await page.locator(selector(view)).click();
    await page.locator(`body[data-worker-view="${view}"] #${view}`).waitFor();
    assert(!(await page.locator("#operationConsole, #refinement, #portoni, #history").evaluateAll(nodes => nodes.some(node => node.checkVisibility()))), "Una sezione dismessa è visibile");
  }
  await page.locator(selector("sync")).click();
  await page.locator("#requestArchiveStart").waitFor();
  await page.locator("#mandateArchiveStart").waitFor();
  await page.screenshot({ path: path.join(output, "sync.png") });
  await page.locator(selector("agencies")).click();
  await page.locator("#agencyOpenChrome").waitFor();
  await page.locator("#openTabsAcquire").click();
  await page.locator("#openTabsSummary").waitFor();
  assert((await page.locator("#openTabsSummary").innerText()).includes("1 confermate in archivio"), "Il riepilogo deve mostrare il salvataggio confermato");
  assert(await page.locator("#openTabsReport").evaluate(report => report.open), "Gli esiti da verificare devono essere aperti");
  assert((await page.locator("#openTabsResults").innerText()).includes("codice di un altro annuncio"), "La causa deve essere visibile");

  await page.locator(selector("worker-v2")).click();
  await page.screenshot({ path: path.join(output, "ready.png") });
  assert(errors.length === 0, errors.join(" | "));
  console.log(JSON.stringify({nav, startup:"worker-v2", sync:true, errors}));
} finally {
  await browser.close();
}
