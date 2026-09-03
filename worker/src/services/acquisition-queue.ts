import { normalizeTaxCode } from "../core/normalize.js";
import { indexJobGraph } from "./job-graph.js";
import type { PersonRow, PropertyRow } from "./repository.js";

/** Persisted contract shared by civic, street and owner-network acquisition. */
export type AcquiredGraph = {
  properties: PropertyRow[];
  people: PersonRow[];
  ownerships: Array<{
    id: string;
    property_id: string;
    person_id: string;
    share_percentage: number | null;
    right_type?: string | null;
  }>;
};

export function isAcquisitionExcluded(property: PropertyRow): boolean {
  const acquisition = property.raw_payload?.acquisition;
  const status = acquisition && typeof acquisition === "object"
    ? String((acquisition as Record<string, unknown>).status ?? "") : "";
  return [property.processing_status, status].some(value =>
    ["acquisition_skipped", "acquisition_failed", "skipped"].includes(value));
}

export function isValidOwnershipShare(share: number | null): share is number {
  return typeof share === "number" && Number.isFinite(share) && share > 0 && share <= 100;
}

/** Inspect without changing order, records or saved import checkpoints. */
export function inspectAcquisitionQueue(graph: AcquiredGraph) {
  const index = indexJobGraph(graph);
  const activeProperties = graph.properties.filter(property => !isAcquisitionExcluded(property));
  const activeOwnerships = activeProperties.flatMap(property => index.ownershipsByPropertyId.get(property.id) ?? []);
  const activePersonIds = new Set(activeOwnerships.map(link => link.person_id));
  const activePeople = graph.people.filter(person => activePersonIds.has(person.id));
  const incompleteProperties = activeProperties.filter(property =>
    !property.municipality.trim() || !property.address?.trim()
    || !property.sheet.trim() || !property.parcel.trim() || !property.subaltern.trim());
  const incompletePeople = activePeople.filter(person => !normalizeTaxCode(person.tax_code) || !person.full_name.trim());
  const incompletePersonIds = new Set(incompletePeople.map(person => person.id));
  const propertiesWithoutOwners = activeProperties.filter(property => !index.ownershipsByPropertyId.get(property.id)?.length);
  const invalidOwnerships = activeOwnerships.filter(link => !isValidOwnershipShare(link.share_percentage));
  const missingPersonIds = [...activePersonIds].filter(id => !index.peopleById.has(id));
  const invalidProperties = new Map<string, string>();
  for (const property of incompleteProperties) invalidProperties.set(property.id, "Dati catastali o indirizzo obbligatori mancanti");
  for (const property of propertiesWithoutOwners) invalidProperties.set(property.id, "Nessun proprietario interpretabile");
  for (const link of activeOwnerships) {
    const person = index.peopleById.get(link.person_id);
    if (!person || incompletePersonIds.has(link.person_id)) {
      invalidProperties.set(link.property_id, "Nominativo collegato mancante o incompleto");
    } else if (person.job_id !== index.propertiesById.get(link.property_id)?.job_id) {
      invalidProperties.set(link.property_id, "Nominativo collegato appartenente a un'altra acquisizione");
    }
  }
  // A person's global share can describe a different property. Only the link is authoritative.
  for (const link of invalidOwnerships) invalidProperties.set(link.property_id, "Quota del collegamento proprietario-immobile non interpretabile");
  return {
    activeProperties, activePeople, activeOwnerships, incompleteProperties, incompletePeople,
    propertiesWithoutOwners, invalidOwnerships, missingPersonIds, invalidProperties, index,
    nothingToImport: activeProperties.length === 0,
  };
}
