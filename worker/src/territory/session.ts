import { dialog, ipcMain, type BrowserWindow, type WebContents } from "electron";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TerritoryApplication } from "./application.js";
import { TerritoryStore } from "./store.js";
import { SimulationProvider } from "./providers.js";
import { LiveProvider, validateLiveConfig, type LiveConfig, type LiveBrowserConfig } from "./live-provider.js";
import type { Street } from "./model.js";
import { lockTerritoryProfile } from "./profile-lock.js";
import { TerritorySync, type TerritorySyncConfig } from "./sync.js";
import { testSettings, configureTestSettings } from "./test-settings.js";
import { openOnlineMemory, type OnlineCredentials } from "./online-memory.js";
import { sanitizeSensitiveText } from "../logger.js";
import { consumeAcquisitions } from "./acquisition-inbox.js";
import { adoptHistory } from "./history.js";
import { runSettingsSchema, runSettings } from "./run-options.js";

const id = z.string().min(1).max(200);
const sourceOwner = z.object({ sourcePersonId: id, taxCode: z.string().max(30), fullName: z.string().max(200), birthDate: z.string().nullable(), birthPlace: z.string().nullable(), birthProvince: z.string().nullable(), rightType: z.string().max(100), sharePercentage: z.number().min(0).max(100).nullable(), contacts: z.object({ phones: z.array(z.string().max(50)), emails: z.array(z.string().max(200)) }) });

export type TerritorySessionOptions = {
  profileDirectory: string; assetDirectory: string; live: boolean;
  contents: WebContents; parent: BrowserWindow; integrated?: boolean;
  contactsExcelPath?: string; openBrowser?: () => Promise<unknown>;
  workBrowser?: () => LiveBrowserConfig;
  onlineCredentials?: () => OnlineCredentials;
  beforeStart?: () => void; afterIdle?: () => void; changed?: () => void;
};

/** Shared host for the standalone lab and the isolated Worker V2 section. */
export async function openTerritorySession(options: TerritorySessionOptions) {
  await mkdir(options.profileDirectory, { recursive: true });
  let application: TerritoryApplication;
  let releaseProfile: (() => void) | undefined;
  let syncing = false;
  let closing = false;
  let memoryError: string | null = null;
  let sync: TerritorySync | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let syncTask: Promise<void> | null = null;
  const publish = () => { if (!options.contents.isDestroyed()) options.contents.send("territory:changed"); options.changed?.(); };
  const flushOnline = async () => {
    if (!options.onlineCredentials || !options.live || application.hasActiveRun || syncing) return;
    syncing = true;
    try {
      sync = await openOnlineMemory(store, options.profileDirectory, options.onlineCredentials());
      await sync.reconcile(); memoryError = null;
    } catch (error) { memoryError = `${error instanceof Error ? sanitizeSensitiveText(error.message) : "Memoria online non raggiungibile"} I dati locali sono conservati. Riprova da Sincronizzazione.`; }
    finally {
      syncing = false; publish();
      if (memoryError && !closing) {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => { syncTask = flushOnline().finally(() => { syncTask = null; }); }, 30000);
      }
    }
  };
  const scheduleSync = () => {
    if (!options.onlineCredentials || !options.live || closing) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncTask = flushOnline().finally(() => { syncTask = null; }); }, 2000);
  };
  const channels: string[] = [];
  const notify = () => { publish(); scheduleSync(); };
  let store: TerritoryStore;
  const consumeDailyMemory = async () => {
    if (!options.live || closing || application.hasActiveRun) return;
    if (syncTask) await syncTask;
    if (syncing) throw new Error("Memoria V2 occupata: acquisizione conservata in attesa");
    syncing = true;
    try {
      const count = await consumeAcquisitions(options.profileDirectory, snapshot => adoptHistory(store, snapshot));
      if (count) notify();
    } finally { syncing = false; }
  };
  try {
    releaseProfile = lockTerritoryProfile(options.profileDirectory);
    const workBrowser = options.integrated ? options.workBrowser?.() : undefined;
    if (options.live) {
      const defaults: LiveConfig = { cdpUrl: "http://127.0.0.1:9223", sisterTabMatch: "sister", crmTabMatch: "tecnocasa-group.my.site.com", allowedCadastralKeys: [], allowedTaxCodes: [], allowCreate: false, ...(options.contactsExcelPath ? { contactsExcelPath: options.contactsExcelPath } : {}) };
      try { await writeFile(path.join(options.profileDirectory, "live-config.json"), JSON.stringify(defaults, null, 2), { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }

    const inventory = JSON.parse(await readFile(path.join(options.assetDirectory, "renderer/inventory.json"), "utf8")) as { streets: Street[] };
    store = await TerritoryStore.open(options.profileDirectory, inventory.streets);
    let provider;
    let liveConfig: LiveConfig | null = null;
    if (options.live) {
      const saved = JSON.parse(await readFile(path.join(options.profileDirectory, "live-config.json"), "utf8")) as LiveConfig;
      liveConfig = validateLiveConfig({ ...saved, ...workBrowser }, workBrowser);
      // The desktop's browser binding is authoritative; test identities stay unchanged.
      if (workBrowser && JSON.stringify(saved) !== JSON.stringify(liveConfig)) {
        const file = path.join(options.profileDirectory, "live-config.json");
        await writeFile(`${file}.tmp`, JSON.stringify(liveConfig, null, 2), { mode: 0o600 }); await rename(`${file}.tmp`, file);
      }
      if (!liveConfig.contactsExcelPath && options.contactsExcelPath) {
        liveConfig = { ...liveConfig, contactsExcelPath: options.contactsExcelPath };
        const file = path.join(options.profileDirectory, "live-config.json");
        await writeFile(`${file}.tmp`, JSON.stringify(liveConfig, null, 2), { mode: 0o600 }); await rename(`${file}.tmp`, file);
      }
      provider = new LiveProvider(liveConfig, () => application?.isPaused() ?? false, workBrowser);
    } else provider = new SimulationProvider(store);
    application = new TerritoryApplication(store, provider, notify);
    if (options.onlineCredentials && options.live) {
      await flushOnline();
    } else try {
      const config = JSON.parse(await readFile(path.join(options.profileDirectory, "sync-config.json"), "utf8")) as TerritorySyncConfig;
      if (config.profileKind !== application.origin) throw new Error("Il profilo della memoria condivisa non corrisponde al laboratorio");
      sync = new TerritorySync(store, options.profileDirectory, config);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await consumeDailyMemory(); }
    catch (error) { memoryError = `Acquisizioni V2 conservate in attesa: ${error instanceof Error ? sanitizeSensitiveText(error.message) : "memoria occupata"}`; }
    const handle = (name: string, handler: (value: unknown) => unknown) => {
      channels.push(`territory:${name}`);
      ipcMain.handle(`territory:${name}`, (event, value) => {
        if (event.sender !== options.contents || event.senderFrame !== options.contents.mainFrame) throw new Error("Richiesta non autorizzata");
        if (closing && !["snapshot", "detail", "sync-status", "pause"].includes(name)) throw new Error("Worker V2 si sta chiudendo: attendo il checkpoint");
        if (syncing && ["annotate", "correct", "start", "associate", "configure-tests", "bind-network"].includes(name)) throw new Error("Attendi il salvataggio in corso prima di modificare la memoria");
        return handler(value);
      });
    };
    handle("snapshot", () => ({ ...application.snapshot(), integrated: options.integrated ?? false }));
    handle("open-browser", () => options.openBrowser?.() ?? Promise.reject(new Error("Apri il Chrome dedicato dalla procedura di collaudo")));
    handle("test-settings", () => liveConfig ? testSettings(store.read(), liveConfig) : { live: false });
    handle("configure-tests", async value => {
      if (!liveConfig || !(provider instanceof LiveProvider)) throw new Error("Le prove reali sono escluse dalla simulazione");
      if (application.snapshot().activeRun) throw new Error("Attendi la fine dell'operazione prima di cambiare le schede di prova");
      const choice = z.object({ keys: z.array(id).max(10), allowCreate: z.boolean(), confirmed: z.boolean() }).refine(v => !v.keys.length || v.confirmed, "Conferma le schede di prova prima di abilitarle").parse(value);
      const config = configureTestSettings(store.read(), liveConfig, choice.keys, choice.allowCreate, workBrowser);
      syncing = true;
      try {
        const file = path.join(options.profileDirectory, "live-config.json");
        await writeFile(`${file}.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        provider.configure(config); liveConfig = config; notify();
        return { selected: config.allowedCadastralKeys.length, allowCreate: config.allowCreate };
      } finally { syncing = false; }
    });
    handle("sync-status", async () => sync ? { ...await sync.status(), syncing, error: memoryError } : { configured: Boolean(options.onlineCredentials && options.live), environment: options.onlineCredentials ? "online" : "locale", syncing, error: memoryError });
    handle("sync", async value => {
      const direction = z.enum(["push", "pull"]).parse(value);
      if (syncing || application.snapshot().activeRun) throw new Error("Attendi la fine dell'operazione in corso");
      clearTimeout(syncTimer);
      syncing = true;
      try {
        if (options.onlineCredentials && options.live) sync = await openOnlineMemory(store, options.profileDirectory, options.onlineCredentials());
        if (!sync) throw new Error("Memoria condivisa non configurata nel laboratorio");
        const result = direction === "push" ? await sync.push() : await sync.pull(); memoryError = null; publish(); return result;
      }
      finally { syncing = false; notify(); }
    });
    handle("detail", value => application.detail(id.parse(value)));
    handle("bind-network", async value => { const v = z.object({ networkId: id, officialId: id }).parse(value); await application.bindNetwork(v.networkId, v.officialId); });
    handle("history-review", () => application.historyReview());
    handle("associate", async value => { const v = z.object({ propertyId: id, streetId: id }).parse(value); await application.associate(v.propertyId, v.streetId); });
    handle("annotate", async value => { const v = z.object({ streetId: id, note: z.string().max(5000), attention: z.boolean() }).parse(value); await application.annotate(v.streetId, v.note, v.attention); });
    handle("correct", async value => { const v = z.object({ key: id, note: z.string().max(5000), correction: z.object({ address: z.string().min(1).max(500).optional(), category: z.string().min(1).max(20).optional(), owners: z.array(sourceOwner).max(100).optional() }) }).parse(value); await application.correct(v.key, v.correction, v.note); });
    handle("start", async value => {
      if (syncing) throw new Error("Attendi la sincronizzazione prima di avviare una via");
      const v = z.object({ streetId: id, operation: z.enum(["scan", "compare", "apply"]), selected: z.array(id).max(10000).default([]), resumeId: id.optional(), settings: runSettingsSchema.optional() }).parse(value);
      if (options.live && v.operation === "apply") {
        const state = store.read();
        const prior = v.resumeId ? state.runs.find(r => r.id === v.resumeId) : undefined;
        const settings = runSettings(prior?.settings ?? v.settings);
        const activityCount = settings.activityMode === "plain" ? (prior?.itemKeys ?? v.selected).filter(key => {
          if (prior?.applySources?.[key]) return prior.applySources[key].activity.enabled;
          const observation = state.units[key]?.observations.at(-1);
          return observation && (observation.activityEligible ?? !observation.historyPropertyId);
        }).length : 0;
        const activityText = settings.activityMode === "plain"
          ? `Il piano prevede ${activityCount} attività Telefonata, Da eseguire, esclusi immobili di rete o di provenienza storica incerta.`
          : "Nessuna nuova attività.";
        const result = await dialog.showMessageBox(options.parent, {
          type: "warning", title: "Schede di prova concordate",
          message: `Applicare le modifiche a ${prior?.itemKeys.length ?? v.selected.length} immobili selezionati nel gestionale reale?`,
          detail: `Saranno scritte anagrafiche, recapiti, dati catastali e collegamenti ${settings.includeCoOwners ? "di tutti gli intestatari" : "del solo intestatario principale, conservando i collegamenti già presenti"}. ${settings.importPolicy === "existing_only" ? "Solo schede esistenti." : "Creazioni e aggiornamenti secondo il confronto."} ${activityText} ${prior ? "La ripresa conserva il piano iniziale, incluse le attività già previste." : ""} Sono ammessi solo gli immobili nella lista di prova. Consulta il piano e le correzioni prima di continuare.`,
          buttons: ["Torna al piano", "Applica alle schede di prova"], defaultId: 0, cancelId: 0,
        });
        if (result.response !== 1) return null;
      }
      options.beforeStart?.();
      try {
        const run = await application.start(v.streetId, v.operation, v.selected, v.resumeId, v.settings);
        void application.waitForIdle().finally(() => { options.afterIdle?.(); notify(); });
        return run;
      } catch (error) { options.afterIdle?.(); throw error; }
    });
    handle("pause", () => application.pause());

    return {
      application,
      consumeDailyMemory,
      hasAcquisitionVersion: (jobId: string, version: string | undefined) => {
        const record = store.read().history?.find(record => record.id === jobId);
        return Boolean(record && version && record.at === version);
      },
      get syncing() { return syncing; },
      async close() {
        if (syncing && !syncTask) throw new Error("Attendi il salvataggio della memoria Worker V2");
        closing = true;
        clearTimeout(syncTimer);
        application.pause(); await application.waitForIdle();
        await syncTask;
        await flushOnline();
        channels.forEach(channel => ipcMain.removeHandler(channel));
        releaseProfile?.(); releaseProfile = undefined;
      },
    };
  } catch (error) {
    clearTimeout(syncTimer); channels.forEach(channel => ipcMain.removeHandler(channel)); releaseProfile?.(); throw error;
  }
}
