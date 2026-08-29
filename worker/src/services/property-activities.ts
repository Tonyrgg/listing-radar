import type { PersonRow, PropertyRow } from "./repository.js";
import { indexJobGraph } from "./job-graph.js";

export const PROPERTY_ACTIVITY_DESCRIPTION = "Inserire attività";
export const PROPERTY_ACTIVITY_STATUS = "Da eseguire" as const;
export const PROPERTY_ACTIVITY_CONTACT_MODE = "Telefonata" as const;
export const DIRECT_CONTACT_STATUS = "Eseguito" as const;
export const DIRECT_CONTACT_MODE = "Contatto diretto" as const;
export const DIRECT_CONTACT_DESCRIPTIONS = [
  "Non sa nulla",
  "Ripassare in un secondo momento",
  "Non ha voluto parlare",
  "Non è stato possibile ottenere informazioni",
  "Da ricontattare di persona",
] as const;
/** Cosa resta scritto sul checkpoint quando l'attività non viene creata. */
export const NO_ACTIVITY_DESCRIPTION = "Nessuna attività richiesta";
export const DIRECT_CONTACT_NR_INTERVALS = [7, 9, 11, 8, 10] as const;

/**
 * Cosa scrivere nel diario del gestionale quando una lavorazione si chiude.
 *
 * Le prime due modalità si distinguono soltanto dove i proprietari non hanno
 * recapiti: `direct_contact` registra il tentativo come «Contatto diretto»
 * già eseguito, `plain` lascia l'attività ordinaria da fare. In entrambi i
 * casi l'attività nel gestionale nasce.
 *
 * `none` è un'altra cosa: non nasce niente, per nessun immobile. Serve quando
 * si vogliono i proprietari e i recapiti senza toccare il diario — e va detto
 * a chiare lettere, perché è l'unica in cui il gestionale non conserva traccia
 * del giro fatto.
 */
export type PropertyActivityMode = "direct_contact" | "plain" | "none";

export interface PropertyActivityDefinition {
  contactMode: typeof PROPERTY_ACTIVITY_CONTACT_MODE | typeof DIRECT_CONTACT_MODE;
  status: typeof PROPERTY_ACTIVITY_STATUS | typeof DIRECT_CONTACT_STATUS;
  description: string;
  directContactOrdinal: number | null;
}

export type PropertyActivityState = "preparing" | "simulated" | "created" | "existing" | "skipped" | "manual" | "retryable_error";

export interface PropertyActivityCheckpoint {
  version: 2 | 3;
  source: "property" | "legacy-person-flow";
  state: PropertyActivityState;
  dryRun: boolean;
  description: string;
  contactMode?: PropertyActivityDefinition["contactMode"];
  status: PropertyActivityDefinition["status"];
  crmPropertyId: string;
  crmActivityId: string | null;
  correlatedProperty: string | null;
  attempts: number;
  error: Record<string, unknown> | null;
  updatedAt: string;
}

function hasPhone(person: Pick<PersonRow, "mobiles" | "landlines">): boolean {
  return [...(person.mobiles ?? []), ...(person.landlines ?? [])].some((value) => value.trim().length > 0);
}

export function ownersHaveAnyPhone(owners: Array<Pick<PersonRow, "mobiles" | "landlines">>): boolean {
  return owners.some(hasPhone);
}

export function isDirectContactNrOrdinal(ordinal: number): boolean {
  if (!Number.isInteger(ordinal) || ordinal < 1) return false;
  let threshold = 0;
  let intervalIndex = 0;
  while (threshold < ordinal) {
    threshold += DIRECT_CONTACT_NR_INTERVALS[intervalIndex % DIRECT_CONTACT_NR_INTERVALS.length]!;
    if (threshold === ordinal) return true;
    intervalIndex += 1;
  }
  return false;
}

/** L'attività ordinaria: quella che resta da fare a una persona. */
const ORDINARY_ACTIVITY: PropertyActivityDefinition = {
  contactMode: PROPERTY_ACTIVITY_CONTACT_MODE,
  status: PROPERTY_ACTIVITY_STATUS,
  description: PROPERTY_ACTIVITY_DESCRIPTION,
  directContactOrdinal: null,
};

/**
 * `null` significa «nessuna attività»: non è un caso d'errore, è la modalità
 * `none` che chiede di non scrivere nel diario del gestionale.
 */
export function propertyActivityDefinition(
  owners: Array<Pick<PersonRow, "mobiles" | "landlines">>,
  directContactOrdinal = 1,
  mode: PropertyActivityMode = "direct_contact",
): PropertyActivityDefinition | null {
  if (mode === "none") return null;
  if (ownersHaveAnyPhone(owners)) return { ...ORDINARY_ACTIVITY };
  if (mode === "plain") return { ...ORDINARY_ACTIVITY };
  const ordinal = Math.max(1, Math.trunc(directContactOrdinal));
  return {
    contactMode: DIRECT_CONTACT_MODE,
    status: DIRECT_CONTACT_STATUS,
    description: isDirectContactNrOrdinal(ordinal)
      ? "nr"
      : DIRECT_CONTACT_DESCRIPTIONS[(ordinal - 1) % DIRECT_CONTACT_DESCRIPTIONS.length]!,
    directContactOrdinal: ordinal,
  };
}

export function directContactOrdinalForTask(tasks: PropertyActivityTask[], propertyId: string): number {
  let ordinal = 0;
  for (const task of tasks) {
    const directContact = !ownersHaveAnyPhone(task.owners);
    if (task.property.id === propertyId) return Math.max(1, ordinal + (directContact ? 1 : 0));
    const checkpoint = task.property.raw_payload?.worker_activity;
    if (directContact && isRecord(checkpoint)
      && ["simulated", "created", "existing", "manual"].includes(String(checkpoint.state))
      && (!checkpoint.contactMode || checkpoint.contactMode === DIRECT_CONTACT_MODE)) {
      ordinal += 1;
    }
  }
  return Math.max(1, ordinal);
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
  const index = indexJobGraph(graph);
  return graph.properties.map((property) => {
    const ownedPeople = (index.ownershipsByPropertyId.get(property.id) ?? [])
      .map((ownership) => ({
        ownership,
        person: index.peopleById.get(ownership.person_id),
      }))
      .filter((entry): entry is { ownership: OwnershipShape; person: PersonRow } => entry.person !== undefined)
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
    && [2, 3].includes(Number(current.version))
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
    contactMode: PROPERTY_ACTIVITY_CONTACT_MODE,
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
  values: Omit<PropertyActivityCheckpoint, "version" | "source" | "description" | "status" | "contactMode" | "updatedAt">
    & Partial<Pick<PropertyActivityCheckpoint, "description" | "status" | "contactMode">>,
): PropertyActivityCheckpoint {
  return {
    version: 3,
    source: "property",
    description: PROPERTY_ACTIVITY_DESCRIPTION,
    status: PROPERTY_ACTIVITY_STATUS,
    contactMode: PROPERTY_ACTIVITY_CONTACT_MODE,
    updatedAt: new Date().toISOString(),
    ...values,
  };
}
