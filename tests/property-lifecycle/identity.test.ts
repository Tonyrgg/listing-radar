import { describe, expect, it } from "vitest";

import {
  decidePropertyIdentity,
  type IdentityCandidate,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";

const observation: IdentityObservation = {
  agencyReference: "TR23",
  address: "Via Mazzini 10",
  locality: "Bitonto",
  propertyType: "Appartamento",
  surfaceSqm: 100,
  rooms: 4,
  imageFingerprints: ["image-a"],
  floorplanFingerprints: ["plan-a"],
};

function candidate(overrides: Partial<IdentityCandidate> = {}): IdentityCandidate {
  return {
    ...observation,
    propertyId: "property-1",
    knownAgencyReferences: ["TR23"],
    ...overrides,
  };
}

describe("Property Identity v1", () => {
  it("auto-matches strong, non-conflicting evidence", () => {
    const decision = decidePropertyIdentity(observation, [candidate()]);
    expect(decision).toMatchObject({
      outcome: "AUTO_MATCH",
      propertyId: "property-1",
      score: 1,
    });
  });

  it("requires review when the top candidates are too close", () => {
    const decision = decidePropertyIdentity(observation, [
      candidate(),
      candidate({ propertyId: "property-2" }),
    ]);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.margin).toBe(0);
    expect(decision.propertyId).toBeNull();
  });

  it("does not auto-match contradictory explicit facts", () => {
    const decision = decidePropertyIdentity(observation, [
      candidate({
        address: "Via Traiana 99",
        locality: "Palombaio",
        propertyType: "Villa",
        surfaceSqm: 220,
        knownAgencyReferences: ["OTHER"],
        imageFingerprints: [],
        floorplanFingerprints: [],
      }),
    ]);
    expect(decision.outcome).toBe("NEW_PROPERTY");
    expect(decision.candidates[0]?.contradictions).toEqual(
      expect.arrayContaining(["explicit_address_conflict", "locality_conflict"]),
    );
  });

  it("creates a new property when no candidates exist", () => {
    expect(decidePropertyIdentity(observation, [])).toMatchObject({
      outcome: "NEW_PROPERTY",
      propertyId: null,
      score: 0,
    });
  });

  it("does not auto-match on weak fields alone", () => {
    const sparseObservation: IdentityObservation = {
      agencyReference: null,
      address: null,
      locality: "Bitonto",
      propertyType: "Appartamento",
      surfaceSqm: null,
      rooms: null,
      imageFingerprints: [],
      floorplanFingerprints: [],
    };
    const decision = decidePropertyIdentity(sparseObservation, [
      candidate({
        agencyReference: null,
        knownAgencyReferences: [],
        address: null,
        surfaceSqm: null,
        rooms: null,
        imageFingerprints: [],
        floorplanFingerprints: [],
      }),
    ]);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.propertyId).toBeNull();
  });
});
