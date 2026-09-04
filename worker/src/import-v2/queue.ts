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
  properties: SourceProperty[],
  onProgress?: (progress: ImportV2Progress) => void,
): Promise<ImportV2BatchResult> {
  const result: ImportV2BatchResult = { completed: [], quarantined: [], paused: null };
  const total = properties.length;
  for (const [position, property] of properties.entries()) {
    const outcome = await engine.run(property, (stage) => onProgress?.({
      propertyId: property.sourcePropertyId, index: position + 1, total, stage,
    }));
    if (outcome.state === "completed") result.completed.push(outcome);
    else if (outcome.state === "quarantined") result.quarantined.push(outcome);
    else {
      result.paused = outcome;
      break;
    }
  }
  return result;
}
