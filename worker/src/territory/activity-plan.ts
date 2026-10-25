import type { ImportV2Checkpoint } from "../import-v2/model.js";
import type { Run, TerritoryState } from "./model.js";
import { unitKey } from "./model.js";
import { sameCrmRecordId } from "../core/crm-record-id.js";
import { isDeepStrictEqual } from "node:util";

/** Called inside the completion transaction, before any journal/queue success. */
export function freezeRunImport(run: Run, checkpoint: ImportV2Checkpoint) {
  const source = checkpoint.plan?.source;
  if (!source || checkpoint.stage !== "completed" || checkpoint.lastError || !checkpoint.crmPropertyId
    || !checkpoint.itemId || checkpoint.propertyId !== source.sourcePropertyId
    || !Number.isFinite(Date.parse(checkpoint.updatedAt))) throw new Error("Prova di completamento V2 incoerente");
  const key = unitKey(source), frozen = run.applySources?.[key];
  if (!frozen || frozen.sourcePropertyId !== source.sourcePropertyId
    || !isDeepStrictEqual(frozen.activity, source.activity)
    || (checkpoint.propertyResolution?.propertyId && !sameCrmRecordId(checkpoint.propertyResolution.propertyId, checkpoint.crmPropertyId))) {
    throw new Error("Prova di import non coerente con il piano della run");
  }
  // A historical import is deliberately not upgraded, even during replay.
  (run.imports ??= {})[key] ??= structuredClone({ at: checkpoint.updatedAt, crmId: checkpoint.crmPropertyId,
    proof: { version: 1 as const, itemId: checkpoint.itemId, sourcePropertyId: checkpoint.propertyId,
      crmId: checkpoint.crmPropertyId, at: checkpoint.updatedAt, activity: source.activity, evidence: checkpoint.activityEvidence ?? null } });
}

/** Choosing an activity can upgrade a formerly disabled plan without changing
 * a single person/property write. An uncertain submitted activity stays frozen. */
export function canEnableQueuedActivity(checkpoint: ImportV2Checkpoint): boolean {
  return checkpoint.stage !== "completed" && checkpoint.plan?.source.activity.enabled === false
    && !checkpoint.activityWrite?.submittedAt
    && (!checkpoint.activityEvidence || checkpoint.activityEvidence.outcome === "disabled");
}

export function runActivitySummary(_state: TerritoryState, run: Run) {
  const summary = { created: 0, recovered: 0, disabled: 0, unconfirmed: 0 };
  for (const [key, imported] of Object.entries(run.imports ?? {})) {
    const source = run.applySources?.[key];
    const proof = imported.proof, evidence = proof?.evidence;
    if (!source || !proof || proof.version !== 1 || !proof.itemId || proof.sourcePropertyId !== source.sourcePropertyId
      || !sameCrmRecordId(proof.crmId, imported.crmId) || proof.at !== imported.at || !Number.isFinite(Date.parse(proof.at))
      || !isDeepStrictEqual(proof.activity, source.activity)) { summary.unconfirmed++; continue; }
    if (!proof.activity.enabled && evidence?.outcome === "disabled") { summary.disabled++; continue; }
    if (!proof.activity.enabled || !evidence || !["created", "existing"].includes(evidence.outcome)
      || !evidence.activityId || evidence.operationId !== proof.itemId
      || evidence.descriptionVerified !== true || evidence.statusVerified !== true
      || evidence.expectedStatus !== proof.activity.status) summary.unconfirmed++;
    else if (evidence.outcome === "created") summary.created++;
    else summary.recovered++;
  }
  return summary;
}
