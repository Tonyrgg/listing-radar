import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Street, TerritoryState } from "./model.js";
import { applyNetworkBindings } from "./network.js";
import { hydrateHistoryProgress, resolveRecognizedHistory } from "./history.js";
import type { HistorySnapshot } from "./history-source.js";
import { hydrateUnitMemory } from "./unit-memory.js";
import { hydrateImportQueue } from "./import-queue.js";
import { hydrateCloudMemory } from "./cloud-memory.js";
import { hydrateQuarantine } from "./quarantine.js";
import { ImportV2Error } from "../import-v2/errors.js";

/** An independent, atomic ledger. Never opens the stable worker's files or env. */
export class TerritoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private committedRevision = 0;
  /** Advances only after the atomic file replacement succeeds. */
  get revision() { return this.committedRevision; }
  private constructor(private readonly filename: string, private state: TerritoryState, readonly deviceId: string) {}
  static async open(directory: string, streets: Street[]) {
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, "territory-ledger.json");
    let state: TerritoryState;
    try {
      state = JSON.parse(await readFile(filename, "utf8")) as TerritoryState;
      if (state.version !== 1 || !state.units || !state.checkpoints || !Array.isArray(state.runs)) throw new Error("Archivio Territorio non riconosciuto: conservato per il recupero");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { version: 1, streets, memories: {}, units: {}, runs: [], events: [], checkpoints: {}, virtualCrm: {}, virtualPeople: {} };
    }
    const deviceFile = path.join(directory, "device-id.txt");
    let deviceId: string;
    try { deviceId = (await readFile(deviceFile, "utf8")).trim(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; deviceId = randomUUID(); await writeFile(deviceFile, deviceId, { flag: "wx", mode: 0o600 }); }
    if (!/^[a-f0-9-]{36}$/i.test(deviceId)) throw new Error("Identità della postazione non valida: archivio conservato");
    const store = new TerritoryStore(filename, state, deviceId);
    let history: HistorySnapshot | undefined;
    if (state.history?.length) {
      try { history = JSON.parse(await readFile(path.join(directory, "history-snapshot.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await store.change(next => {
      if (history) hydrateHistoryProgress(next, history);
      // Current catalogue adds records, never retires a street or loses its history.
      const catalog = new Map(next.streets.map(s => [s.id, s]));
      for (const street of streets) catalog.set(street.id, street);
      next.streets = [...catalog.values()];
      const registeredAt = new Date().toISOString();
      for (const street of next.streets) { next.memories[street.id] ??= { note: "", attention: false, updatedAt: registeredAt, registeredAt }; next.memories[street.id]!.registeredAt ??= registeredAt; }
      applyNetworkBindings(next);
      resolveRecognizedHistory(next);
      hydrateUnitMemory(next);
      hydrateCloudMemory(next);
      hydrateQuarantine(next);
      for (const run of next.runs) if (run.state === "running" && (!run.deviceId || run.deviceId === deviceId)) { run.state = "paused"; run.error = "Applicazione interrotta. Riprendi dal punto conservato."; }
      hydrateImportQueue(next);
    });
    return store;
  }
  read(): TerritoryState { return structuredClone(this.state); }
  async backupBeforeSharedRecovery() {
    try { await writeFile(`${this.filename}.before-shared-recovery.json`, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600, flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  async replace(state: TerritoryState, unchanged?: (current: TerritoryState) => boolean) {
    const operation = this.queue.then(async () => {
      if (this.state.runs.some(run => run.state === "running")) throw new Error("Metti in pausa prima di scaricare la memoria condivisa");
      if (unchanged && !unchanged(this.state)) throw new Error("L'archivio locale è cambiato durante la sincronizzazione. Nessun dato viene sostituito.");
      await writeFile(`${this.filename}.before-sync-${randomUUID()}.json`, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
      const next = structuredClone(state);
      const catalog = new Map(this.state.streets.map(street => [street.id, street]));
      for (const street of next.streets) catalog.set(street.id, street);
      next.streets = [...catalog.values()];
      const registeredAt = new Date().toISOString();
      for (const street of next.streets) next.memories[street.id] ??= structuredClone(this.state.memories[street.id] ?? { note: "", attention: false, updatedAt: registeredAt, registeredAt });
      applyNetworkBindings(next);
      hydrateUnitMemory(next);
      hydrateCloudMemory(next);
      hydrateQuarantine(next);
      hydrateImportQueue(next, true);
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename); this.state = next; this.committedRevision++;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
  async change<T>(mutation: (next: TerritoryState) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const result = mutation(next);
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.filename);
      } catch (error) {
        throw new ImportV2Error("Memoria locale non salvata: nessuna ulteriore scrittura CRM finché il salvataggio non riesce.", "cloud_unavailable", { global: true, retryable: true, details: { localPersistence: true, code: (error as NodeJS.ErrnoException).code } });
      }
      this.state = next;
      this.committedRevision++;
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
