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

export function buildAutomaticSkipImpact(
  graph: { properties: PropertyRow[]; people: PersonRow[]; ownerships: OwnershipRow[] },
  propertyId: string,
) {
  const ownerships = graph.ownerships.filter((ownership) => ownership.property_id === propertyId);
  const personIds = [...new Set(ownerships.map((ownership) => ownership.person_id))];
  const exclusivePersonIds = personIds.filter((personId) =>
    !graph.ownerships.some((ownership) => {
      if (ownership.person_id !== personId || ownership.property_id === propertyId) return false;
      const otherProperty = graph.properties.find((property) => property.id === ownership.property_id);
      return otherProperty && otherProperty.processing_status !== "skipped";
    }));
  return {
    ownershipIds: ownerships.map((ownership) => ownership.id),
    personIds,
    exclusivePersonIds,
  };
}
