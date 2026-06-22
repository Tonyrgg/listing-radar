import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculatePriorityScore,
  getPriorityScoreBreakdown,
  isPublishedToday,
} from "@/lib/listings/scoring";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});

describe("priority scoring", () => {
  it("explains positive and negative factors with the same total", () => {
    const input = {
      sellerType: "agency" as const,
      isNewToday: true,
      hasPhone: false,
      minimumDaysOnline: 5,
      isPriceDropped: false,
      description: "Asta giudiziaria",
      price: null,
      sqm: null,
    };
    const breakdown = getPriorityScoreBreakdown(input);

    expect(breakdown.total).toBe(calculatePriorityScore(input));
    expect(breakdown.awarded.some((factor) => factor.id === "new-today")).toBe(true);
    expect(breakdown.deductions.map((factor) => factor.id)).toEqual(
      expect.arrayContaining(["agency-seller", "missing-price", "missing-sqm", "auction"]),
    );
  });

  it("reads scoring overrides from environment variables", () => {
    process.env.SCORE_PRIVATE_SELLER = "55";
    const breakdown = getPriorityScoreBreakdown({
      sellerType: "private",
      isNewToday: false,
      hasPhone: false,
      minimumDaysOnline: 0,
      isPriceDropped: false,
      description: "Descrizione completa con informazioni sufficienti per la valutazione.",
      price: 100000,
      sqm: 100,
    });

    expect(breakdown.awarded.find((factor) => factor.id === "private-seller")?.points).toBe(55);
  });

  it("uses the portal publication date before the first seen date for today badges", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T10:00:00+02:00"));

    expect(
      isPublishedToday({
        firstSeenAt: "2026-06-22T08:00:00+02:00",
        portalDeclaredDate: "2026-06-21T09:00:00+02:00",
      }),
    ).toBe(false);
    expect(
      isPublishedToday({
        firstSeenAt: "2026-06-18T08:00:00+02:00",
        portalDeclaredDate: "2026-06-22T09:00:00+02:00",
      }),
    ).toBe(true);
  });
});
