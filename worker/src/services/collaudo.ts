import { canonicalPhone } from "../import-v2/identity.js";
import type { ImportV2Checkpoint, ImportV2Plan } from "../import-v2/model.js";
import type { JobRow, PersonRow, PropertyRow } from "./repository.js";
import { KILLER_PHONE_DESCRIPTIONS } from "./property-activities.js";

export const COLLAUDO_STREET = "VIA PIETRO COLLETTA";
export const COLLAUDO_MAX_PROPERTIES = 3;
export const COLLAUDO_SCENARIO_ID = "killer_coowners_resume";

export type CollaudoAssertion = {
  id: string;
  label: string;
  status: "passed" | "failed" | "pending";
  expected: string;
  actual: string;
  propertyId?: string | null;
};

export type CollaudoImportItem = {
  id: string;
  property_id: string;
  stage: string;
  status: string;
  plan: ImportV2Plan | null;
  checkpoint: Partial<ImportV2Checkpoint> | null;
  last_error: Record<string, unknown> | null;
};

export type CollaudoReport = {
  id: string;
  scenarioId: typeof COLLAUDO_SCENARIO_ID;
  street: typeof COLLAUDO_STREET;
  status: "running" | "passed" | "failed" | "stopped";
  phase: "preflight" | "acquisition" | "first_import" | "resume" | "verification" | "completed";
  jobId: string | null;
  startedAt: string;
  completedAt: string | null;
  importedProperties: number;
  resumeCount: number;
  message: string;
  assertions: CollaudoAssertion[];
};

export type CollaudoGraph = {
  properties: PropertyRow[];
  people: PersonRow[];
  ownerships: Array<{ id: string; property_id: string; person_id: string; share_percentage: number | null }>;
};

function normalizedWords(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("it-IT");
}

/** Production writes are authorised only when the exact test street is present as consecutive words. */
export function isCollaudoStreet(value: string | null | undefined): boolean {
  const address = normalizedWords(value);
  const street = normalizedWords(COLLAUDO_STREET).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${street}(?:$| (?=(?:N|NUMERO|CIVICO|[0-9]|BITONTO|BA)(?: |$)))`).test(address);
}

export function assertCollaudoStreet(value: string | null | undefined): void {
  if (!isCollaudoStreet(value)) {
    throw new Error(`Perimetro di collaudo violato: “${String(value ?? "indirizzo assente")}” non è ${COLLAUDO_STREET}`);
  }
}

export function collaudoPropertyKey(property: Pick<PropertyRow, "municipality" | "sheet" | "parcel" | "subaltern">): string {
  return [property.municipality, property.sheet, property.parcel, property.subaltern]
    .map((value) => normalizedWords(value))
    .join("|");
}

function result(
  id: string,
  label: string,
  passed: boolean,
  expected: string,
  actual: string,
  propertyId?: string | null,
): CollaudoAssertion {
  return { id, label, status: passed ? "passed" : "failed", expected, actual, propertyId };
}

function ownerIdsFor(graph: CollaudoGraph, propertyId: string): string[] {
  return graph.ownerships.filter((ownership) => ownership.property_id === propertyId).map((ownership) => ownership.person_id);
}

function personHasPhone(person: PersonRow | undefined): boolean {
  return Boolean(person && [...(person.mobiles ?? []), ...(person.landlines ?? [])].some((phone) => canonicalPhone(phone)));
}

type PersistedActivityEvidence = {
  state?: string;
  description?: string;
  status?: string;
  contactMode?: string;
  crmPropertyId?: string;
};

function persistedActivityEvidence(property: PropertyRow | undefined): PersistedActivityEvidence | null {
  const candidate = property?.raw_payload?.worker_activity;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as PersistedActivityEvidence
    : null;
}

export function evaluateCollaudo(input: {
  job: JobRow;
  graph: CollaudoGraph;
  items: CollaudoImportItem[];
  minimumCompleted: number;
  expectedPaused: boolean;
}): CollaudoAssertion[] {
  const { job, graph, items } = input;
  const assertions: CollaudoAssertion[] = [];
  const options = job.acquisition?.importOptions as Record<string, unknown> | undefined;
  assertions.push(result(
    "street_context",
    "La lavorazione appartiene alla via di collaudo",
    isCollaudoStreet(job.street),
    COLLAUDO_STREET,
    String(job.street ?? "via assente"),
  ));
  assertions.push(result(
    "street_boundary",
    "Nessun immobile esce dal perimetro autorizzato",
    graph.properties.length > 0 && graph.properties.every((property) => isCollaudoStreet(property.address)),
    `${graph.properties.length} immobili tutti in ${COLLAUDO_STREET}`,
    `${graph.properties.filter((property) => isCollaudoStreet(property.address)).length}/${graph.properties.length} nel perimetro`,
  ));
  const cadastralKeys = graph.properties.map(collaudoPropertyKey);
  assertions.push(result(
    "cadastral_uniqueness",
    "Il campione non contiene immobili catastali duplicati",
    new Set(cadastralKeys).size === cadastralKeys.length,
    `${cadastralKeys.length} terne uniche`,
    `${new Set(cadastralKeys).size} terne uniche`,
  ));
  assertions.push(result(
    "sample_budget",
    "Il collaudo rispetta il budget della via corta",
    graph.properties.length > 0 && graph.properties.length <= COLLAUDO_MAX_PROPERTIES,
    `da 1 a ${COLLAUDO_MAX_PROPERTIES} immobili`,
    `${graph.properties.length} immobili`,
  ));
  assertions.push(result(
    "run_options",
    "Le opzioni della run sono rimaste quelle richieste",
    options?.activityMode === "killer" && options?.importCoOwners === true && options?.parallelCrmWindows === false,
    "killer, tutti i comproprietari, una finestra",
    `${String(options?.activityMode ?? "assente")}, comproprietari ${String(options?.importCoOwners)}, due finestre ${String(options?.parallelCrmWindows)}`,
  ));
  const completed = items.filter((item) => item.status === "completed" && item.stage === "completed");
  assertions.push(result(
    "completed_count",
    "La run ha concluso il numero atteso di immobili",
    completed.length >= input.minimumCompleted,
    `almeno ${input.minimumCompleted}`,
    `${completed.length}`,
  ));
  assertions.push(result(
    "pause_contract",
    input.expectedPaused ? "La run si è fermata conservando il punto" : "La run ha chiuso il campione",
    input.expectedPaused ? job.status === "paused" : job.status === "completed",
    input.expectedPaused ? "paused" : "completed",
    job.status,
  ));

  const personById = new Map(graph.people.map((person) => [person.id, person]));
  const propertyById = new Map(graph.properties.map((property) => [property.id, property]));
  for (const item of completed) {
    const property = propertyById.get(item.property_id);
    const source = item.plan?.source;
    const ownerIds = ownerIdsFor(graph, item.property_id);
    const expectedOwners = ownerIds.length;
    const syncedOwners = item.checkpoint?.syncedPeople?.length ?? 0;
    assertions.push(result(
      `owners_${item.property_id}`,
      "Tutti gli intestatari del campione sono stati verificati",
      expectedOwners > 0 && syncedOwners === expectedOwners,
      `${expectedOwners} intestatari`,
      `${syncedOwners} verificati`,
      item.property_id,
    ));
    const hasPhone = ownerIds.some((personId) => personHasPhone(personById.get(personId)));
    const expectedMode = hasPhone ? "Telefonata" : "Contatto diretto";
    const expectedDescription = hasPhone ? KILLER_PHONE_DESCRIPTIONS : null;
    const actualDescription = source?.activity.description ?? "";
    const activityEvidence = item.checkpoint?.activityEvidence;
    const persistedActivity = persistedActivityEvidence(property);
    /* The desktop runner persists the Cloud activity evidence in the property
     * payload. Import V2's optional checkpoint evidence is used when present,
     * but it is not the only valid execution path. */
    const activityEvidenceVerified = activityEvidence
      ? activityEvidence.outcome !== "disabled"
        && activityEvidence.descriptionVerified === true
        && activityEvidence.statusVerified === true
        && activityEvidence.expectedStatus === "Eseguito"
      : Boolean(persistedActivity
        && ["created", "existing", "manual"].includes(String(persistedActivity.state))
        && persistedActivity.description === actualDescription
        && persistedActivity.status === "Eseguito"
        && persistedActivity.contactMode === expectedMode
        && persistedActivity.crmPropertyId === item.checkpoint?.crmPropertyId);
    assertions.push(result(
      `killer_${item.property_id}`,
      "L’attività killer è stata preparata come eseguita",
      source?.activity.enabled === true
        && source.activity.status === "Eseguito"
        && source.activity.contactMode === expectedMode
        && (!expectedDescription || expectedDescription.includes(actualDescription as typeof KILLER_PHONE_DESCRIPTIONS[number]))
        && activityEvidenceVerified,
      hasPhone ? "Telefonata eseguita con risposta killer" : "Contatto diretto eseguito",
      `${source?.activity.contactMode ?? "assente"}, ${source?.activity.status ?? "assente"}, ${actualDescription || "descrizione assente"}; Cloud ${activityEvidence ? `descrizione ${String(activityEvidence.descriptionVerified)}, stato ${String(activityEvidence.statusVerified)}` : `checkpoint ${String(persistedActivity?.state ?? "assente")}`}`,
      item.property_id,
    ));
    assertions.push(result(
      `crm_identity_${item.property_id}`,
      "L’immobile completato conserva un riferimento Cloud",
      Boolean(item.checkpoint?.crmPropertyId && property?.crm_record_id),
      "ID Cloud nel checkpoint e nella riga",
      `checkpoint ${String(item.checkpoint?.crmPropertyId ?? "assente")}, riga ${String(property?.crm_record_id ?? "assente")}`,
      item.property_id,
    ));
  }
  return assertions;
}

export function failedCollaudoAssertions(assertions: CollaudoAssertion[]): CollaudoAssertion[] {
  return assertions.filter((assertion) => assertion.status === "failed");
}
