import { WebContentsView, type BrowserWindow } from "electron";
import path from "node:path";
import { z } from "zod";
import { openTerritorySession } from "../territory/session.js";
import type { OnlineCredentials } from "../territory/online-memory.js";
import { queueAcquisition, queuePropertyMemory } from "../territory/acquisition-inbox.js";
import type { PropertyMemory } from "../import-v2/memory-store.js";
import type { HistorySnapshot } from "../territory/history-source.js";
import type { JobRow } from "../services/repository.js";
import type { LiveBrowserConfig } from "../territory/live-provider.js";

export const workerV2Viewport = z.object({ visible: z.boolean(), theme: z.enum(["light", "dark"]), bounds: z.object({ x: z.number().int().min(0).max(20000), y: z.number().int().min(0).max(20000), width: z.number().int().min(0).max(20000), height: z.number().int().min(0).max(20000) }) });
type Viewport = z.infer<typeof workerV2Viewport>;

/** A separate renderer inside the same window, with its own preload and ledger. */
export class WorkerV2Host {
  private view: WebContentsView | null = null;
  private session: Awaited<ReturnType<typeof openTerritorySession>> | null = null;
  private opening: Promise<void> | null = null;
  private disposed = false;
  private viewport: Viewport | null = null;
  private memoryQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly parent: BrowserWindow, private readonly options: {
    assetDirectory: string; profileDirectory: string; simulation?: boolean;
    contactsExcelPath?: string; beforeStart: () => void; afterIdle: () => void; changed: () => void;
    onlineCredentials?: () => OnlineCredentials;
    workBrowser: () => LiveBrowserConfig; openBrowser: () => Promise<unknown>;
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
    await this.ensureOpen();
    this.layout();
    return { ready: true };
  }
  private async ensureOpen() {
    if (this.disposed) throw new Error("Worker V2 chiuso: memoria in attesa del prossimo avvio");
    if (!this.session) { this.opening ??= this.open().finally(() => { this.opening = null; }); await this.opening; }
  }
  async remember(snapshot?: HistorySnapshot) {
    if (this.options.simulation) return;
    const operation = this.memoryQueue.then(async () => {
      if (snapshot) await queueAcquisition(this.options.profileDirectory, snapshot);
      await this.ensureOpen();
      await this.session!.consumeDailyMemory();
    });
    this.memoryQueue = operation.catch(() => undefined);
    return operation;
  }
  async rememberProperty(memory: PropertyMemory) {
    if (this.options.simulation) return;
    // The local handoff is durable before the original import proceeds.
    await queuePropertyMemory(this.options.profileDirectory, memory);
    const operation = this.memoryQueue.then(async () => { await this.ensureOpen(); await this.session!.consumeDailyMemory(); });
    this.memoryQueue = operation.catch(() => undefined);
    // Adoption and online sync never hold up the daily CRM engine.
  }
  async needsAcquisition(job: JobRow) {
    if (this.options.simulation || ["ready", "running", "processing", "in_progress"].includes(job.status)) return false;
    await this.ensureOpen();
    return !this.session!.hasAcquisitionVersion(job.id, job.updated_at);
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
    return this.options.openBrowser();
  }
  async close() {
    await this.memoryQueue;
    await this.opening?.catch(() => undefined);
    await this.session?.close(); this.session = null;
    if (this.view) { if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view); this.view.webContents.close(); this.view = null; }
    this.disposed = true;
  }
}
