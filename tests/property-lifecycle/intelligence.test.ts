import { describe, expect, it } from "vitest";

import { assessSaleStatus } from "@/lib/property-lifecycle/lifecycle/sale-intelligence";
import { assessOpportunity } from "@/lib/property-lifecycle/opportunities/rules";

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

describe("transparent opportunity rules", () => {
  it.each([
    ["CLOSED_TO_PRIVATE", true, "HOT"],
    ["OFF_MARKET_NO_SALE_EVIDENCE", false, "HIGH"],
    ["EXIT_PENDING", false, "INTERESTING"],
  ] as const)("maps %s to %s priority", (agencyListingState, agencyToPrivate, level) => {
    expect(
      assessOpportunity({
        saleStatus: "UNKNOWN",
        agencyListingState,
        agencyToPrivate,
        trueMarketAgeDays: null,
        priceDropCount: 0,
        relaunchCount: 0,
      }).level,
    ).toBe(level);
  });

  it("suppresses sold properties", () => {
    expect(
      assessOpportunity({
        saleStatus: "SOLD_CONFIRMED",
        agencyListingState: "CLOSED_SOLD",
        agencyToPrivate: false,
        trueMarketAgeDays: 500,
        priceDropCount: 4,
        relaunchCount: 3,
      }),
    ).toEqual({ level: "NONE", score: 0, reasons: ["sold_confirmed"] });
  });

  it("explains watch status using age, price drops, and relaunches", () => {
    expect(
      assessOpportunity({
        saleStatus: "UNKNOWN",
        agencyListingState: "ACTIVE",
        agencyToPrivate: false,
        trueMarketAgeDays: 180,
        priceDropCount: 2,
        relaunchCount: 1,
      }),
    ).toEqual({
      level: "WATCH",
      score: 40,
      reasons: [
        "true_market_age_at_least_150_days",
        "price_drops:2",
        "relaunches:1",
      ],
    });
  });
});

describe("opportunities without any agency history", () => {
  it("does not claim an agency exit for a property no agency ever listed", () => {
    const assessment = assessOpportunity({
      saleStatus: "UNKNOWN",
      agencyListingState: null,
      agencyToPrivate: false,
      trueMarketAgeDays: null,
      priceDropCount: 0,
      relaunchCount: 0,
    });

    expect(assessment.level).toBe("NONE");
    expect(assessment.reasons).not.toContain("agency_exit_confirmed");
  });

  it("still scores age and price signals without an agency listing", () => {
    const assessment = assessOpportunity({
      saleStatus: "UNKNOWN",
      agencyListingState: null,
      agencyToPrivate: false,
      trueMarketAgeDays: 400,
      priceDropCount: 2,
      relaunchCount: 0,
    });

    expect(assessment.level).toBe("WATCH");
    expect(assessment.reasons).not.toContain("agency_exit_confirmed");
  });
});
