import type { PersonRow, PropertyRow, WorkerRepository } from "./repository.js";

type Graph = Awaited<ReturnType<WorkerRepository["loadGraph"]>>;
type OwnershipRow = Graph["ownerships"][number];

export interface PropertyWorkOwner {
  person: PersonRow;
  ownership: OwnershipRow;
}

export interface PropertyWorkItem {
  property: PropertyRow;
  primary: PropertyWorkOwner;
  coowners: PropertyWorkOwner[];
  owners: PropertyWorkOwner[];
}

export const PROPERTY_WORK_SEQUENCE = [
  "all_owner_contacts",
  "all_owners",
  "property",
  "property_activity",
  "primary_ownership",
  "correlated_owners_linked",
] as const;

export function buildPropertyWorkPlan(graph: Graph): PropertyWorkItem[] {
  return graph.properties
    .filter((property) => !["completed", "skipped", "acquisition_skipped", "acquisition_failed"].includes(property.processing_status)
      && (property.raw_payload?.property_flow as { stage?: string } | undefined)?.stage !== "skipped")
    .map((property) => {
    const owners = graph.ownerships
      .filter((ownership) => ownership.property_id === property.id)
      .map((ownership) => ({ ownership, person: graph.people.find((person) => person.id === ownership.person_id) }))
      .filter((entry): entry is PropertyWorkOwner => Boolean(entry.person))
      .sort((left, right) => {
        const byShare = (right.ownership.share_percentage ?? -1) - (left.ownership.share_percentage ?? -1);
        return byShare;
      });
    // A person can appear more than once in malformed/imported ownership data.
    // CRM relationships are singular per person and property, therefore one
    // plan must never issue multiple Nuovo actions for the same CRM identity.
    const ownerKeys = new Set<string>();
    const uniqueOwners = owners.filter((owner) => {
      const key = owner.person.crm_record_id || owner.person.id;
      if (ownerKeys.has(key)) return false;
      ownerKeys.add(key);
      return true;
    });
    if (!uniqueOwners[0]) throw new Error(`Nessun proprietario disponibile per l'immobile ${property.id}`);
      return { property, primary: uniqueOwners[0], coowners: uniqueOwners.slice(1), owners: uniqueOwners };
    });
}
