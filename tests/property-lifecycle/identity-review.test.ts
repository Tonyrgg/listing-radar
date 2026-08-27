import { describe, expect, it } from "vitest";

import { evaluateIdentityReviewCandidates } from "@/lib/property-lifecycle/read-models/identity-review";
import type {
  LifecyclePropertySummary,
  LifecycleReviewItem,
} from "@/lib/property-lifecycle/read-models/types";

function property(
  id: string,
  overrides: Partial<LifecyclePropertySummary> = {},
): LifecyclePropertySummary {
  return {
    id,
    title: "Appartamento a Bitonto",
    address: "Via Mazzini 10",
    locality: "Bitonto",
    propertyType: "Appartamento",
    surfaceSqm: 80,
    rooms: 3,
    currentPrice: 114000,
    propertyState: "ACTIVE_AGENCY",
    saleStatus: "UNKNOWN",
    identityStatus: "PROVISIONAL",
    trueMarketStartLowerBound: null,
    trueMarketStartUpperBound: null,
    trueMarketStartMethod: null,
    trueMarketStartConfidence: null,
    relaunchCount: 0,
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-27T00:00:00.000Z",
    representativeImagePaths: [],
    agencies: [],
    activePrivateCount: 0,
    ...overrides,
  };
}

function candidate(
  value: LifecyclePropertySummary,
  contradictions: string[] = [],
): LifecycleReviewItem["candidates"][number] {
  return { property: value, score: 0.65, contradictions };
}

describe("identity review barriers", () => {
  it("removes the banal price comparison from the screenshot", () => {
    const result = evaluateIdentityReviewCandidates(property("source"), [
      candidate(
        property("different", {
          address: "Via Traiana 18",
          currentPrice: 195000,
          surfaceSqm: 90,
        }),
      ),
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.automaticExclusions).toMatchObject({
      count: 1,
      reasons: {
        street_hard_conflict: 1,
        price_hard_conflict: 1,
      },
    });
  });

  it("keeps only plausible candidates when a review contains both kinds", () => {
    const plausible = candidate(
      property("plausible", {
        address: "Via Mazzini 10",
        currentPrice: 108000,
        surfaceSqm: 82,
      }),
    );
    const incompatible = candidate(
      property("incompatible", {
        address: "Via Traiana 18",
        currentPrice: 195000,
      }),
    );

    const result = evaluateIdentityReviewCandidates(property("source"), [
      incompatible,
      plausible,
    ]);

    expect(result.candidates.map((item) => item.property.id)).toEqual([
      "plausible",
    ]);
    expect(result.automaticExclusions.count).toBe(1);
  });

  it("honours hard conflicts recorded when the case was created", () => {
    const result = evaluateIdentityReviewCandidates(property("source"), [
      candidate(property("candidate"), ["property_type_hard_conflict"]),
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.automaticExclusions.reasons).toEqual({
      property_type_hard_conflict: 1,
    });
  });
});
