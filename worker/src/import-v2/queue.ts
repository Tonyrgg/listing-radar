import type { ImportV2Outcome, SourceProperty } from "./model.js";
import { ImportV2Engine } from "./engine.js";

export type ImportV2BatchResult = {
  completed: ImportV2Outcome[];
  quarantined: ImportV2Outcome[];
  paused: ImportV2Outcome | null;
};

/** A bad property is isolated; a session/portal-wide failure pauses the batch. */
export async function runImportV2Batch(engine: ImportV2Engine, properties: SourceProperty[]): Promise<ImportV2BatchResult> {
  const result: ImportV2BatchResult = { completed: [], quarantined: [], paused: null };
  for (const property of properties) {
    const outcome = await engine.run(property);
    if (outcome.state === "completed") result.completed.push(outcome);
    else if (outcome.state === "quarantined") result.quarantined.push(outcome);
    else {
      result.paused = outcome;
      break;
    }
  }
  return result;
}
