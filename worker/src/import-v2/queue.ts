import type { ImportV2Outcome, ImportV2Stage, SourceProperty } from "./model.js";
import { ImportV2Engine } from "./engine.js";

export type ImportV2BatchResult = {
  completed: ImportV2Outcome[];
  quarantined: ImportV2Outcome[];
  paused: ImportV2Outcome | null;
};

export type ImportV2Progress = {
  propertyId: string;
  index: number;
  total: number;
  stage: ImportV2Stage;
};

/** A bad property is isolated; a session/portal-wide failure pauses the batch. */
export async function runImportV2Batch(
  engine: ImportV2Engine,
  properties: Array<SourceProperty | (() => SourceProperty)>,
  onProgress?: (progress: ImportV2Progress) => void,
  shouldPauseAfterItem: () => boolean = () => false,
): Promise<ImportV2BatchResult> {
  const result: ImportV2BatchResult = { completed: [], quarantined: [], paused: null };
  const total = properties.length;
  const deferred: Array<{ source: SourceProperty | (() => SourceProperty); position: number }> = [];
  for (const [position, source] of properties.entries()) {
    const property = typeof source === "function" ? source() : source;
    const outcome = await engine.run(property, (stage) => onProgress?.({
      propertyId: property.sourcePropertyId, index: position + 1, total, stage,
    }));
    if (outcome.state === "completed") result.completed.push(outcome);
    else if (outcome.state === "quarantined" && outcome.failure?.details.lookupIndexPending === true) {
      /* Salesforce indicizza i Clienti appena creati con ritardo. Continuare
       * la coda dà tempo al Cloud senza bloccare il throughput; il checkpoint
       * conserva persona e immobile già verificati per il secondo passaggio. */
      deferred.push({ source, position });
    }
    else if (outcome.state === "quarantined") result.quarantined.push(outcome);
    else {
      result.paused = outcome;
      break;
    }
    if (shouldPauseAfterItem()) {
      result.paused = {
        ...outcome,
        state: "paused",
        failure: {
          kind: "operator_pause",
          message: "Run messa in pausa dopo l'immobile corrente; checkpoint conservato",
          retryable: false,
          global: true,
          stage: outcome.stage,
          details: { pauseRequested: true, stopAfterNextImport: true },
          occurredAt: new Date().toISOString(),
        },
      };
      break;
    }
  }
  if (!result.paused) {
    for (const item of deferred) {
      const property = typeof item.source === "function" ? item.source() : item.source;
      const outcome = await engine.run(property, (stage) => onProgress?.({
        propertyId: property.sourcePropertyId, index: item.position + 1, total, stage,
      }));
      if (outcome.state === "completed") result.completed.push(outcome);
      else if (outcome.state === "quarantined") result.quarantined.push(outcome);
      else { result.paused = outcome; break; }
    }
  }
  return result;
}
