import type { ImportV2Checkpoint } from "../import-v2/model.js";
import type { Run, TerritoryState } from "./model.js";

/** Choosing an activity can upgrade a formerly disabled plan without changing
 * a single person/property write. An uncertain submitted activity stays frozen. */
export function canEnableQueuedActivity(checkpoint: ImportV2Checkpoint): boolean {
  return checkpoint.stage !== "completed" && checkpoint.plan?.source.activity.enabled === false
    && !checkpoint.activityWrite?.submittedAt
    && (!checkpoint.activityEvidence || checkpoint.activityEvidence.outcome === "disabled");
}

export function runActivitySummary(state: TerritoryState, run: Run) {
  const summary = { created: 0, recovered: 0, disabled: 0, unconfirmed: 0 };
  for (const key of Object.keys(run.imports ?? {})) {
    const source = run.applySources?.[key];
    if (!source) { summary.unconfirmed++; continue; }
    if (!source.activity.enabled) { summary.disabled++; continue; }
    const checkpoint = state.checkpoints[source.sourcePropertyId];
    const evidence = checkpoint?.activityEvidence;
    if (!evidence || evidence.outcome === "disabled" || evidence.operationId !== checkpoint?.itemId) summary.unconfirmed++;
    else if (evidence.outcome === "created") summary.created++;
    else summary.recovered++;
  }
  return summary;
}
