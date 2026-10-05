import { app, WebContentsView, type BrowserWindow } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { openTerritorySession } from "../territory/session.js";
import type { OnlineCredentials } from "../territory/online-memory.js";

export const workerV2Viewport = z.object({ visible: z.boolean(), theme: z.enum(["light", "dark"]), bounds: z.object({ x: z.number().int().min(0).max(20000), y: z.number().int().min(0).max(20000), width: z.number().int().min(0).max(20000), height: z.number().int().min(0).max(20000) }) });
type Viewport = z.infer<typeof workerV2Viewport>;

/** A separate renderer inside the same window, with its own preload and ledger. */
export class WorkerV2Host {
  private view: WebContentsView | null = null;
  private session: Awaited<ReturnType<typeof openTerritorySession>> | null = null;
  private opening: Promise<void> | null = null;
  private disposed = false;
  private viewport: Viewport | null = null;
  constructor(private readonly parent: BrowserWindow, private readonly options: {
    assetDirectory: string; profileDirectory: string; simulation?: boolean;
    contactsExcelPath?: string; beforeStart: () => void; afterIdle: () => void; changed: () => void;
    onlineCredentials?: () => OnlineCredentials;
  }) {
    parent.on("close", event => {
      if (this.disposed || (!this.session && !this.opening)) return;
      event.preventDefault();
      if (this.session?.syncing) return;
      void this.close().then(() => parent.close());
    });
  }
  get active() { return this.session?.application.hasActiveRun ?? false; }
  async pause() { this.session?.application.pause(); await this.session?.application.waitForIdle(); }
  async update(value: unknown) {
    this.viewport = workerV2Viewport.parse(value);
    if (!this.viewport.visible) { this.view?.setVisible(false); return { ready: Boolean(this.session) }; }
    if (!this.session) {
      this.opening ??= this.open().finally(() => { this.opening = null; });
      await this.opening;
    }
    this.layout();
    return { ready: true };
  }
  private layout() {
    if (!this.view || !this.viewport || this.parent.isDestroyed()) return;
    const { bounds, visible, theme } = this.viewport;
    const [width = 0, height = 0] = this.parent.getContentSize();
    const x = Math.min(bounds.x, width), y = Math.min(bounds.y, height);
    this.view.setBounds({ x, y, width: Math.max(0, Math.min(bounds.width, width - x)), height: Math.max(0, Math.min(bounds.height, height - y)) });
    this.view.setVisible(visible);
    this.view.webContents.send("territory:appearance", { integrated: true, theme });
    if (visible) this.view.webContents.send("territory:changed");
  }
  private async open() {
    const view = new WebContentsView({ webPreferences: { preload: path.join(this.options.assetDirectory, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, partition: "persist:worker-v2" } });
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", event => event.preventDefault());
    this.view = view;
    try {
      this.session = await openTerritorySession({ ...this.options, contents: view.webContents, parent: this.parent, live: !this.options.simulation, integrated: true, openBrowser: () => this.openBrowser() });
      await view.webContents.loadFile(path.join(this.options.assetDirectory, "renderer/index.html"));
      this.parent.contentView.addChildView(view);
    } catch (error) {
      await this.session?.close(); this.session = null;
      view.webContents.close(); this.view = null; throw error;
    }
  }
  private async openBrowser() {
    if (this.options.simulation) throw new Error("Il Chrome reale è escluso dalla simulazione");
    try {
      const response = await fetch("http://127.0.0.1:9223/json/version", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return { alreadyOpen: true };
    } catch { /* Start only the dedicated browser, never the daily session. */ }
    const executable = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory!, "Google/Chrome/Application/chrome.exe")).find(existsSync);
    if (!executable) throw new Error("Google Chrome non trovato. Installa Chrome per il collaudo reale.");
    const child = spawn(executable, ["--remote-debugging-port=9223", `--user-data-dir=${path.join(app.getPath("appData"), "ListingRadarWorkerV2Chrome")}`, "--no-first-run", "--no-default-browser-check"], { detached: true, stdio: "ignore", windowsHide: true });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return { alreadyOpen: false };
  }
  async close() {
    await this.opening?.catch(() => undefined);
    await this.session?.close(); this.session = null;
    if (this.view) { if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view); this.view.webContents.close(); this.view = null; }
    this.disposed = true;
  }
}
