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
 * A property-bound failure is recoverable by restarting that property's flow,
 * irrespective of whether Tecnocloud classified it as a technical, data or
 * review error. User-requested stops, expired sessions and an unverified save
 * remain protected: retrying those can respectively ignore an operator choice,
 * hide a login requirement or duplicate a write.
 */
export function canAutomaticallyRecoverPropertyFailure(status: string, details: Record<string, unknown> | null | undefined) {
  const value = recordValue(details);
  if (value.cancelled === true || value.pauseRequested === true || value.stopAfterNextImport === true) return false;
  if (status === "session_expired") return false;
  return value.action !== "property-activity-save-uncertain";
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
