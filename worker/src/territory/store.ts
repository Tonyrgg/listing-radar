import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Street, TerritoryState } from "./model.js";
import { applyNetworkBindings } from "./network.js";
import { hydrateHistoryProgress } from "./history.js";
import type { HistorySnapshot } from "./history-source.js";

/** An independent, atomic ledger. Never opens the stable worker's files or env. */
export class TerritoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly filename: string, private state: TerritoryState) {}
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
    const store = new TerritoryStore(filename, state);
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
      for (const run of next.runs) if (run.state === "running") { run.state = "paused"; run.error = "Applicazione interrotta. Riprendi dal punto conservato."; }
    });
    return store;
  }
  read(): TerritoryState { return structuredClone(this.state); }
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
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename); this.state = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
  async change<T>(mutation: (next: TerritoryState) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const result = mutation(next);
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename);
      this.state = next;
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
