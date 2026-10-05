import { randomUUID } from "node:crypto";
import type { ImportV2Store } from "../import-v2/ports.js";
import type { ImportV2Checkpoint, ImportV2Failure, ImportV2Plan, SourceProperty } from "../import-v2/model.js";
import { buildPlan } from "../import-v2/identity.js";
import { TerritoryStore } from "./store.js";

/** Reuses the verified Import V2 engine with a completely independent ledger. */
export class TerritoryImportStore implements ImportV2Store {
  constructor(private readonly ledger: TerritoryStore, private readonly streetId: string) {}
  async loadOrCreate(plan: ImportV2Plan): Promise<ImportV2Checkpoint> {
    return this.ledger.change(state => {
      const prior = state.checkpoints[plan.source.sourcePropertyId];
      if (prior) {
        if (prior.plan?.fingerprint !== plan.fingerprint) throw new Error("Dati modificati dopo l'avvio. Completa o verifica l'operazione prima di correggere la scheda.");
        return structuredClone({ ...prior, attempts: 0, lastError: null });
      }
      const checkpoint: ImportV2Checkpoint = { itemId: randomUUID(), jobId: plan.source.jobId, propertyId: plan.source.sourcePropertyId, stage: "queued", plan, people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: null, attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: new Date().toISOString() };
      state.checkpoints[checkpoint.propertyId] = checkpoint;
      return structuredClone(checkpoint);
    });
  }
  async save(checkpoint: ImportV2Checkpoint) { await this.ledger.change(state => { state.checkpoints[checkpoint.propertyId] = structuredClone(checkpoint); }); }
  async recordEvent(checkpoint: ImportV2Checkpoint, event: string) {
    if (event !== "stage_completed" || checkpoint.stage !== "completed") return;
    await this.ledger.change(state => { state.events.push({ id: randomUUID(), streetId: this.streetId, at: new Date().toISOString(), text: "Aggiornamento verificato nel gestionale", unitKey: checkpoint.propertyId }); });
  }
  async quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { await this.save({ ...checkpoint, lastError: failure }); }
  async pause(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { await this.save({ ...checkpoint, lastError: failure }); }
  async quarantineSource(source: SourceProperty, failure: ImportV2Failure) {
    let plan: ImportV2Plan;
    try { plan = buildPlan(source); } catch { return; }
    const checkpoint = await this.loadOrCreate(plan);
    await this.quarantine(checkpoint, failure);
  }
}
