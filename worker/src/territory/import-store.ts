import { randomUUID } from "node:crypto";
import type { ImportV2Store } from "../import-v2/ports.js";
import type { ImportV2Checkpoint, ImportV2Failure, ImportV2Plan, SourceProperty } from "../import-v2/model.js";
import { buildPlan } from "../import-v2/identity.js";
import { TerritoryStore } from "./store.js";
import { rememberCheckpoint } from "./unit-memory.js";
import { unitKey as importKey } from "./model.js";
import { recordImportTiming } from "./import-timing.js";

/** Reuses the verified Import V2 engine with a completely independent ledger. */
export class TerritoryImportStore implements ImportV2Store {
  constructor(private readonly ledger: TerritoryStore, private readonly streetId: string, private readonly runId?: string, private readonly captureCloud?: (state: import("./model.js").TerritoryState) => void) {}
  private remember(state: ReturnType<TerritoryStore["read"]>, checkpoint: ImportV2Checkpoint, event: import("../import-v2/memory-store.js").PropertyMemory["event"], failure?: ImportV2Failure) {
    this.captureCloud?.(state);
    if (!checkpoint.plan || !this.runId) return;
    const run = state.runs.find(r => r.id === this.runId); if (!run) return;
    const key = importKey(checkpoint.plan.source);
    rememberCheckpoint(state, { version: 1, event, source: checkpoint.plan.source, checkpoint, at: event === "import_started" ? new Date().toISOString() : failure?.occurredAt ?? checkpoint.updatedAt, failure }, { key, runId: this.runId, streetId: this.streetId, origin: run.origin });
  }
  async loadOrCreate(plan: ImportV2Plan): Promise<ImportV2Checkpoint> {
    return this.ledger.change(state => {
      const prior = state.checkpoints[plan.source.sourcePropertyId];
      if (prior) {
        if (prior.plan?.fingerprint !== plan.fingerprint) throw new Error("Dati modificati dopo l'avvio. Completa o verifica l'operazione prima di correggere la scheda.");
        const checkpoint = structuredClone({ ...prior, attempts: 0, lastError: null });
        this.remember(state, checkpoint, "import_started"); return checkpoint;
      }
      const checkpoint: ImportV2Checkpoint = { itemId: randomUUID(), jobId: plan.source.jobId, propertyId: plan.source.sourcePropertyId, stage: "queued", plan, people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: null, attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: new Date().toISOString() };
      state.checkpoints[checkpoint.propertyId] = checkpoint;
      this.remember(state, checkpoint, "import_started");
      return structuredClone(checkpoint);
    });
  }
  async save(checkpoint: ImportV2Checkpoint) { await this.ledger.change(state => {
    state.checkpoints[checkpoint.propertyId] = structuredClone(checkpoint);
    this.remember(state, checkpoint, checkpoint.lastError ? "retry_scheduled" : "stage_completed", checkpoint.lastError ?? undefined);
    if (checkpoint.stage === "completed") this.completedEvent(state, checkpoint);
  }); }
  private completedEvent(state: ReturnType<TerritoryStore["read"]>, checkpoint: ImportV2Checkpoint) {
    const id = `import:${checkpoint.itemId}:completed`;
    if (!state.events.some(e => e.id === id)) state.events.push({ id, streetId: this.streetId, at: checkpoint.updatedAt, text: "Aggiornamento verificato nel gestionale", unitKey: checkpoint.plan ? importKey(checkpoint.plan.source) : undefined });
  }
  async recordEvent(checkpoint: ImportV2Checkpoint, event: string, details: Record<string, unknown> = {}) {
    await recordImportTiming(this.ledger.diagnosticsDirectory, this.runId, checkpoint, event, details);
    if (event !== "stage_completed" || checkpoint.stage !== "completed") return;
    // The normal path already committed proof and audit in the same transaction.
    // Keep recovery of checkpoints written by older versions.
    if (this.ledger.readSelected(state => state.events.some(e => e.id === `import:${checkpoint.itemId}:completed`))) return;
    await this.ledger.change(state => { this.remember(state, checkpoint, "stage_completed"); this.completedEvent(state, checkpoint); });
  }
  async quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { await this.ledger.change(state => { state.checkpoints[checkpoint.propertyId] = structuredClone({ ...checkpoint, lastError: failure }); this.remember(state, checkpoint, "import_quarantined", failure); }); }
  async pause(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { await this.ledger.change(state => { state.checkpoints[checkpoint.propertyId] = structuredClone({ ...checkpoint, lastError: failure }); this.remember(state, checkpoint, "import_paused", failure); }); }
  async quarantineSource(source: SourceProperty, failure: ImportV2Failure) {
    let plan: ImportV2Plan;
    try { plan = buildPlan(source); } catch {
      if (!this.runId) return;
      await this.ledger.change(state => {
        const run = state.runs.find(r => r.id === this.runId);
        const key = importKey(source);
        if (run && state.units[key]) rememberCheckpoint(state, { version: 1, event: "import_quarantined", source, checkpoint: null, at: failure.occurredAt, failure }, { key, runId: run.id, streetId: this.streetId, origin: run.origin });
      });
      return;
    }
    const checkpoint = await this.loadOrCreate(plan);
    await this.quarantine(checkpoint, failure);
  }
}
