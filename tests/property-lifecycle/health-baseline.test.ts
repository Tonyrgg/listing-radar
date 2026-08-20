import { describe, expect, it } from "vitest";

import {
  emptyHealthBaseline,
  evaluateHealthBaseline,
} from "@/lib/property-lifecycle/health/baseline";

function healthy(
  baseline = emptyHealthBaseline(),
  observedCount = 100,
  structureFingerprint = "schema-v1",
) {
  return evaluateHealthBaseline({
    baseline,
    sourceState: "HEALTHY",
    sourceComplete: true,
    observedCount,
    structureFingerprint,
  });
}

describe("progressive adapter health baseline", () => {
  it("does not authorize disappearances from the first or second healthy run", () => {
    const first = healthy();
    const second = healthy(first.next, 102);

    expect(first).toMatchObject({
      effectiveState: "HEALTHY",
      baselineReady: false,
      absenceEvaluationAllowed: false,
    });
    expect(second).toMatchObject({
      effectiveState: "HEALTHY",
      baselineReady: false,
      absenceEvaluationAllowed: false,
    });
  });

  it("stabilizes progressively after three coherent healthy runs", () => {
    const first = healthy();
    const second = healthy(first.next, 102);
    const third = healthy(second.next, 98);

    expect(third).toMatchObject({
      effectiveState: "HEALTHY",
      baselineReady: true,
      absenceEvaluationAllowed: true,
    });
    expect(third.next).toMatchObject({
      successfulRunCount: 3,
      rollingMedian: 100,
      consecutiveHealthyRuns: 3,
    });
  });

  it("tolerates a 20 percent movement after stabilization but blocks an 80 percent drop", () => {
    const first = healthy();
    const second = healthy(first.next, 100);
    const stable = healthy(second.next, 100);
    const moderateDrop = healthy(stable.next, 80);
    const severeDrop = healthy(moderateDrop.next, 20);

    expect(moderateDrop).toMatchObject({
      effectiveState: "HEALTHY",
      absenceEvaluationAllowed: true,
      anomalyRatio: 0.8,
    });
    expect(severeDrop).toMatchObject({
      effectiveState: "DEGRADED",
      inventoryComplete: false,
      absenceEvaluationAllowed: false,
      anomalyRatio: 0.2,
    });
    expect(severeDrop.next.recentInventoryCounts).toEqual([100, 100, 100, 80]);
  });

  it("blocks zero inventory without teaching the baseline that zero is normal", () => {
    const stable = healthy(healthy(healthy().next).next);
    const zero = healthy(stable.next, 0);

    expect(zero).toMatchObject({
      effectiveState: "FAILED",
      inventoryComplete: false,
      absenceEvaluationAllowed: false,
      reasons: ["inventory_zero"],
    });
    expect(zero.next.recentInventoryCounts).toEqual(stable.next.recentInventoryCounts);
  });

  it("requires a repeated schema fingerprint before starting a new warm-up", () => {
    const stable = healthy(healthy(healthy().next).next);
    const drift = healthy(stable.next, 101, "schema-v2");
    const confirmed = healthy(drift.next, 101, "schema-v2");

    expect(drift).toMatchObject({
      effectiveState: "STRUCTURE_CHANGED",
      absenceEvaluationAllowed: false,
    });
    expect(confirmed).toMatchObject({
      effectiveState: "HEALTHY",
      baselineReady: false,
      absenceEvaluationAllowed: false,
    });
    expect(confirmed.next).toMatchObject({
      schemaFingerprint: "schema-v2",
      schemaVersion: 2,
      recentInventoryCounts: [101],
    });
  });
});
