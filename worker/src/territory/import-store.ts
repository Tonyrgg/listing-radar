import { randomUUID } from "node:crypto";
import type { ImportV2Store } from "../import-v2/ports.js";
import type { ImportV2Checkpoint, ImportV2Failure, ImportV2Plan, SourceProperty } from "../import-v2/model.js";
import { buildPlan } from "../import-v2/identity.js";
import { TerritoryStore } from "./store.js";
import { rememberCheckpoint } from "./unit-memory.js";
import { unitKey as importKey } from "./model.js";

/** Reuses the verified Import V2 engine with a completely independent ledger. */
export class TerritoryImportStore implements ImportV2Store {
  constructor(private readonly ledger: TerritoryStore, private readonly streetId: string, private readonly runId?: string) {}
  private remember(state: ReturnType<TerritoryStore["read"]>, checkpoint: ImportV2Checkpoint, event: import("../import-v2/memory-store.js").PropertyMemory["event"], failure?: ImportV2Failure) {
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
  async save(checkpoint: ImportV2Checkpoint) { await this.ledger.change(state => { state.checkpoints[checkpoint.propertyId] = structuredClone(checkpoint); this.remember(state, checkpoint, checkpoint.lastError ? "retry_scheduled" : "stage_completed", checkpoint.lastError ?? undefined); }); }
  async recordEvent(checkpoint: ImportV2Checkpoint, event: string) {
    if (event !== "stage_completed" || checkpoint.stage !== "completed") return;
    await this.ledger.change(state => { this.remember(state, checkpoint, "stage_completed"); state.events.push({ id: randomUUID(), streetId: this.streetId, at: checkpoint.updatedAt, text: "Aggiornamento verificato nel gestionale", unitKey: checkpoint.plan ? importKey(checkpoint.plan.source) : undefined }); });
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
