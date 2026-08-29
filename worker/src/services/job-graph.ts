import type { WorkerRepository } from "./repository.js";

export type JobGraph = Awaited<ReturnType<WorkerRepository["loadGraph"]>>;
export type JobOwnership = JobGraph["ownerships"][number];

type Identified = { id: string };
type Related = { property_id: string; person_id: string };

export type JobGraphIndex<
  Property extends Identified = JobGraph["properties"][number],
  Person extends Identified = JobGraph["people"][number],
  Ownership extends Related = JobOwnership,
> = {
  propertiesById: Map<string, Property>;
  peopleById: Map<string, Person>;
  ownershipsByPropertyId: Map<string, Ownership[]>;
  ownershipsByPersonId: Map<string, Ownership[]>;
};

function appendToIndex<Ownership extends Related>(index: Map<string, Ownership[]>, key: string, ownership: Ownership) {
  const current = index.get(key);
  if (current) current.push(ownership);
  else index.set(key, [ownership]);
}

/**
 * Builds the lookup tables used throughout a worker run once. Long SISTER
 * acquisitions can contain thousands of rows; repeatedly scanning the whole
 * graph for every property makes otherwise linear work grow quadratically.
 */
export function indexJobGraph<
  Property extends Identified,
  Person extends Identified,
  Ownership extends Related,
>(graph: { properties: Property[]; people: Person[]; ownerships: Ownership[] }): JobGraphIndex<Property, Person, Ownership> {
  const ownershipsByPropertyId = new Map<string, Ownership[]>();
  const ownershipsByPersonId = new Map<string, Ownership[]>();
  for (const ownership of graph.ownerships) {
    appendToIndex(ownershipsByPropertyId, ownership.property_id, ownership);
    appendToIndex(ownershipsByPersonId, ownership.person_id, ownership);
  }
  return {
    propertiesById: new Map(graph.properties.map((property) => [property.id, property])),
    peopleById: new Map(graph.people.map((person) => [person.id, person])),
    ownershipsByPropertyId,
    ownershipsByPersonId,
  };
}
