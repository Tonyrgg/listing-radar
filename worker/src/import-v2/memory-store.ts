import type { ImportV2Store } from "./ports.js";
import type { ImportV2Checkpoint, ImportV2Failure, ImportV2Plan, SourceProperty } from "./model.js";
import { logger } from "../logger.js";

export type PropertyMemory = {
  version: 1; event: "import_started" | "stage_completed" | "retry_scheduled" | "import_paused" | "import_quarantined";
  at: string; source: SourceProperty; checkpoint: ImportV2Checkpoint | null; failure?: ImportV2Failure; acquiredAt?: string;
};
export type PropertyMemorySink = (memory: PropertyMemory) => Promise<void>;

/** Mirrors only persisted facts. A failed mirror never changes the CRM import outcome. */
export class PropertyMemoryStore implements ImportV2Store {
  constructor(private readonly base: ImportV2Store, private readonly sink: PropertyMemorySink) {}
  private async emit(event: PropertyMemory["event"], checkpoint: ImportV2Checkpoint, failure?: ImportV2Failure) {
    if (!checkpoint.plan) return;
    await this.deliver({ version: 1, event, source: checkpoint.plan.source, checkpoint, failure, at: event === "import_started" ? new Date().toISOString() : failure?.occurredAt ?? checkpoint.updatedAt });
  }
  private async deliver(memory: PropertyMemory) {
    try { await this.sink(structuredClone(memory)); }
    catch { logger.warn({ propertyId: memory.source.sourcePropertyId, stage: memory.checkpoint?.stage }, "Memoria immobile da recuperare dai checkpoint originali"); }
  }
  async loadOrCreate(plan: ImportV2Plan) { const checkpoint = await this.base.loadOrCreate(plan); await this.emit("import_started", checkpoint); return checkpoint; }
  async save(checkpoint: ImportV2Checkpoint) { await this.base.save(checkpoint); await this.emit(checkpoint.lastError ? "retry_scheduled" : "stage_completed", checkpoint, checkpoint.lastError ?? undefined); }
  async recordEvent(checkpoint: ImportV2Checkpoint, event: string, details?: Record<string, unknown>) {
    await this.base.recordEvent(checkpoint, event, details);
    if (event === "stage_completed") await this.emit("stage_completed", checkpoint);
  }
  async pause(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { await this.base.pause(checkpoint, failure); await this.emit("import_paused", checkpoint, failure); }
  async quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { await this.base.quarantine(checkpoint, failure); await this.emit("import_quarantined", checkpoint, failure); }
  async quarantineSource(source: SourceProperty, failure: ImportV2Failure) {
    await this.base.quarantineSource(source, failure);
    await this.deliver({ version: 1, event: "import_quarantined", at: failure.occurredAt, source, checkpoint: null, failure });
  }
}
