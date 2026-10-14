import { describe, expect, it } from "vitest";

import { assessSaleStatus } from "@/lib/property-lifecycle/lifecycle/sale-intelligence";

describe("conservative sale intelligence", () => {
  it("confirms deterministic sold evidence when no active contradiction exists", () => {
    expect(
      assessSaleStatus({
        explicitSourceSold: true,
        soldGraphic: false,
        trustedPortalSold: false,
        otherActivePublication: false,
      }),
    ).toMatchObject({
      status: "SOLD_CONFIRMED",
      confidence: 0.98,
      requiresReview: false,
    });
  });

  it("downgrades conflicting sold evidence to probable and reviewable", () => {
    expect(
      assessSaleStatus({
        explicitSourceSold: true,
        soldGraphic: false,
        trustedPortalSold: false,
        otherActivePublication: true,
      }),
    ).toMatchObject({
      status: "PROBABLE_SOLD",
      requiresReview: true,
    });
  });

  it("never overwrites a human-confirmed not-sold status", () => {
    expect(
      assessSaleStatus({
        explicitSourceSold: true,
        soldGraphic: true,
        trustedPortalSold: true,
        manualStatus: "NOT_SOLD_CONFIRMED",
        otherActivePublication: false,
      }),
    ).toEqual({
      status: "NOT_SOLD_CONFIRMED",
      confidence: 1,
      reasons: ["human_verified_override"],
      requiresReview: false,
    });
  });
});
