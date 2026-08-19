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

  it("recognizes near-identical perceptual hashes", () => {
    const image = `DHASH64:${"0".repeat(64)}`;
    const nearlySameImage = `DHASH64:${"1"}${"0".repeat(63)}`;
    const decision = decidePropertyIdentity(
      { ...observation, imageFingerprints: [image], floorplanFingerprints: [] },
      [
        candidate({
          imageFingerprints: [nearlySameImage],
          floorplanFingerprints: [],
        }),
      ],
    );
    expect(decision.outcome).toBe("AUTO_MATCH");
    expect(decision.candidates[0]?.features.image.value).toBeCloseTo(63 / 64);
  });

  it("never auto-merges on a floorplan alone", () => {
    const plan = `DHASH64:${"01".repeat(32)}`;
    const sparse: IdentityObservation = {
      agencyReference: null,
      address: null,
      locality: null,
      propertyType: null,
      surfaceSqm: null,
      rooms: null,
      imageFingerprints: [],
      floorplanFingerprints: [plan],
    };
    const decision = decidePropertyIdentity(sparse, [
      candidate({
        agencyReference: null,
        knownAgencyReferences: [],
        address: null,
        locality: null,
        propertyType: null,
        surfaceSqm: null,
        rooms: null,
        imageFingerprints: [],
        floorplanFingerprints: [plan],
      }),
    ]);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
  });

  it("does not treat a municipality-only raw location as an address match", () => {
    const generic = {
      ...observation,
      agencyReference: null,
      address: "Bitonto",
      imageFingerprints: [],
      floorplanFingerprints: [],
    };
    const decision = decidePropertyIdentity(generic, [
      candidate({
        agencyReference: null,
        knownAgencyReferences: [],
        address: "BITONTO",
        imageFingerprints: [],
        floorplanFingerprints: [],
      }),
    ]);

    expect(decision.candidates[0]?.features.address.available).toBe(false);
    expect(decision.outcome).not.toBe("AUTO_MATCH");
  });

  it("keeps cross-agency street matches in review without strong media", () => {
    const leftHash = `DHASH64:${"0".repeat(64)}`;
    const weakHash = `DHASH64:${"1".repeat(24)}${"0".repeat(40)}`;
    const crossAgency = {
      ...observation,
      agencyReference: null,
      imageFingerprints: [leftHash],
      floorplanFingerprints: [],
    };
    const decision = decidePropertyIdentity(crossAgency, [
      candidate({
        agencyReference: null,
        knownAgencyReferences: [],
        imageFingerprints: [weakHash],
        floorplanFingerprints: [],
      }),
    ]);

    expect(decision.candidates[0]?.features.image.value).toBe(0.625);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
  });

  it("allows a private-radar match on an exact civic with coherent facts", () => {
    const privateObservation: IdentityObservation = {
      agencyReference: null,
      address: "Via Ammiraglio Vacca 56e",
      locality: "Bitonto",
      propertyType: "Appartamento",
      surfaceSqm: 100,
      rooms: 4,
      imageFingerprints: [],
      floorplanFingerprints: [],
    };
    const decision = decidePropertyIdentity(
      privateObservation,
      [
        candidate({
          agencyReference: null,
          knownAgencyReferences: [],
          address: "Via Ammiraglio Vacca 56e",
          imageFingerprints: [],
          floorplanFingerprints: [],
        }),
      ],
      { allowExactCivicAddressEvidence: true },
    );

    expect(decision.outcome).toBe("AUTO_MATCH");
  });
});
