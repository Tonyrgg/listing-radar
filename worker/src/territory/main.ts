import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openTerritorySession } from "./session.js";

// Independent lab entry. Does not import the desktop host or updater.
const directory = path.dirname(fileURLToPath(import.meta.url));
app.setName("Listing Radar Territorio Prova");
app.setPath("userData", path.join(app.getPath("appData"), "ListingRadarTerritoryLab"));
if (app.isPackaged) throw new Error("Usa Worker V2 nell'app, non l'entry del laboratorio");
const live = process.argv.includes("--territory-live");
const override = process.env.TERRITORY_LAB_DATA_DIR;
if (override) {
  if (!path.isAbsolute(override) || !/territory/i.test(path.basename(override))) throw new Error("Directory di prova non valida");
  app.setPath("userData", override);
}
if (live) app.setPath("userData", `${app.getPath("userData")}-live`);
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
let window: BrowserWindow | null = null;
let session: Awaited<ReturnType<typeof openTerritorySession>> | undefined;
app.whenReady().then(async () => {
  if (!ownsLock) return;
  window = new BrowserWindow({ width: 1560, height: 960, minWidth: 780, minHeight: 580, show: !(override && process.env.TERRITORY_LAB_VISUAL_CHECK === "1"), title: live ? "Territorio | prove reali concordate" : "Territorio | laboratorio locale", backgroundColor: "#102c30", webPreferences: { preload: path.join(directory, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  session = await openTerritorySession({ profileDirectory: app.getPath("userData"), assetDirectory: directory, live, parent: window, contents: window.webContents });
  window.on("close", event => {
    if (session?.syncing) { event.preventDefault(); return; }
    if (session?.application.snapshot().activeRun) { event.preventDefault(); session.application.pause(); void session.application.waitForIdle().then(() => window?.close()); }
  });
  await window.loadFile(path.join(directory, "renderer/index.html"));
}).catch(error => { dialog.showErrorBox("Laboratorio Territorio", error instanceof Error ? error.message : "Avvio non riuscito"); app.exit(1); });
app.on("window-all-closed", () => { void session?.close().finally(() => app.quit()); });
