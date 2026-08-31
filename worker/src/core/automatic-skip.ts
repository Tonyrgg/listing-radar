import { indexJobGraph } from "../services/job-graph.js";
import type { PersonRow, PropertyRow } from "../services/repository.js";

type OwnershipRow = {
  id: string;
  property_id: string;
  person_id: string;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function automaticRetryAttempts(rawPayload: Record<string, unknown> | null | undefined) {
  const attempts = Number(recordValue(rawPayload?.automatic_retry).attempts ?? 0);
  return Number.isFinite(attempts) ? Math.max(0, Math.trunc(attempts)) : 0;
}

export function nextAutomaticRetryAttempt(rawPayload: Record<string, unknown> | null | undefined, maximumAttempts = 3) {
  return Math.min(automaticRetryAttempts(rawPayload) + 1, maximumAttempts);
}

/**
 * Si ripetono solo errori tecnici transitori. Errori di identita', dati
 * incompleti, sessione o salvataggio incerto richiedono una verifica e non
 * devono trasformarsi in altri clic automatici sul gestionale.
 */
export function canAutomaticallyRecoverPropertyFailure(status: string, details: Record<string, unknown> | null | undefined) {
  const value = recordValue(details);
  if (value.cancelled === true || value.pauseRequested === true || value.stopAfterNextImport === true) return false;
  if (["paused", "session_expired", "needs_review", "data_incomplete"].includes(status)) return false;
  return !/save-uncertain|creation-submitted|save-submitted/i.test(String(value.action ?? ""));
}

export function buildAutomaticSkipImpact(
  graph: { properties: PropertyRow[]; people: PersonRow[]; ownerships: OwnershipRow[] },
  propertyId: string,
) {
  const index = indexJobGraph(graph);
  const ownerships = index.ownershipsByPropertyId.get(propertyId) ?? [];
  const personIds = [...new Set(ownerships.map((ownership) => ownership.person_id))];
  const exclusivePersonIds = personIds.filter((personId) =>
    !(index.ownershipsByPersonId.get(personId) ?? []).some((ownership) => {
      if (ownership.property_id === propertyId) return false;
      const otherProperty = index.propertiesById.get(ownership.property_id);
      return otherProperty && otherProperty.processing_status !== "skipped";
    }));
  return {
    ownershipIds: ownerships.map((ownership) => ownership.id),
    personIds,
    exclusivePersonIds,
  };
}
