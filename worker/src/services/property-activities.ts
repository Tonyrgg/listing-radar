import type { PersonRow, PropertyRow } from "./repository.js";

export const PROPERTY_ACTIVITY_DESCRIPTION = "Inserire attività";
export const PROPERTY_ACTIVITY_STATUS = "Da eseguire" as const;

export type PropertyActivityState = "preparing" | "simulated" | "created" | "existing" | "skipped" | "manual" | "retryable_error";

export interface PropertyActivityCheckpoint {
  version: 2;
  source: "property" | "legacy-person-flow";
  state: PropertyActivityState;
  dryRun: boolean;
  description: string;
  status: typeof PROPERTY_ACTIVITY_STATUS;
  crmPropertyId: string;
  crmActivityId: string | null;
  correlatedProperty: string | null;
  attempts: number;
  error: Record<string, unknown> | null;
  updatedAt: string;
}

interface OwnershipShape {
  property_id: string;
  person_id: string;
  share_percentage: number | null;
}

export interface PropertyActivityTask {
  property: PropertyRow;
  owners: PersonRow[];
  fallbackPersonId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildPropertyActivityTasks(graph: {
  properties: PropertyRow[];
  people: PersonRow[];
  ownerships: OwnershipShape[];
}): PropertyActivityTask[] {
  return graph.properties.map((property) => {
    const ownedPeople = graph.ownerships
      .filter((ownership) => ownership.property_id === property.id)
      .map((ownership) => ({
        ownership,
        person: graph.people.find((person) => person.id === ownership.person_id),
      }))
      .filter((entry): entry is { ownership: OwnershipShape; person: PersonRow } => Boolean(entry.person))
      .sort((left, right) => {
        const shareDifference = (right.ownership.share_percentage ?? -1) - (left.ownership.share_percentage ?? -1);
        return shareDifference || left.person.id.localeCompare(right.person.id);
      });
    const owners = ownedPeople.map((entry) => entry.person);
    return {
      property,
      owners,
      fallbackPersonId: owners.find((person) => person.crm_record_id)?.crm_record_id ?? undefined,
    };
  });
}

export function readPropertyActivityCheckpoint(
  rawPayload: Record<string, unknown> | null,
  dryRun: boolean,
  crmPropertyId: string,
): PropertyActivityCheckpoint | null {
  const current = rawPayload?.worker_activity;
  if (isRecord(current)
    && current.version === 2
    && current.dryRun === dryRun
    && ["simulated", "created", "existing", "skipped", "manual"].includes(String(current.state))) {
    return current as unknown as PropertyActivityCheckpoint;
  }

  const legacy = rawPayload?.worker_activities;
  if (!isRecord(legacy)) return null;
  const compatible = Object.values(legacy).find((entry) => isRecord(entry)
    && Boolean(entry.dryRun) === dryRun
    && typeof entry.crmActivityId === "string"
    && entry.crmActivityId.length > 0);
  if (!isRecord(compatible)) return null;
  return {
    version: 2,
    source: "legacy-person-flow",
    state: dryRun ? "simulated" : "created",
    dryRun,
    description: PROPERTY_ACTIVITY_DESCRIPTION,
    status: PROPERTY_ACTIVITY_STATUS,
    crmPropertyId,
    crmActivityId: String(compatible.crmActivityId),
    correlatedProperty: null,
    attempts: 0,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

export function activityCheckpoint(
  values: Omit<PropertyActivityCheckpoint, "version" | "source" | "description" | "status" | "updatedAt">,
): PropertyActivityCheckpoint {
  return {
    version: 2,
    source: "property",
    description: PROPERTY_ACTIVITY_DESCRIPTION,
    status: PROPERTY_ACTIVITY_STATUS,
    updatedAt: new Date().toISOString(),
    ...values,
  };
}
