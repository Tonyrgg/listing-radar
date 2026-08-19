import { describe, expect, it } from "vitest";

import {
  evaluatePublicationPresence,
  type PublicationPresence,
} from "@/lib/property-lifecycle/lifecycle/transitions";
import {
  mergeTrueMarketStart,
  trueMarketAgeDays,
} from "@/lib/property-lifecycle/lifecycle/market-age";
import { resolveAuthoritativeValue } from "@/lib/property-lifecycle/lifecycle/manual-overrides";

const ACTIVE: PublicationPresence = {
  state: "ACTIVE",
  sourceStatus: "ACTIVE",
  missingHealthyRunCount: 0,
  missingSince: null,
  removedAt: null,
};

describe("publication lifecycle safety", () => {
  it.each(["DEGRADED", "FAILED", "STRUCTURE_CHANGED"] as const)(
    "does not advance missing state on %s inventory",
    (healthState) => {
      const result = evaluatePublicationPresence({
        current: ACTIVE,
        healthState,
        inventoryComplete: false,
        observedPresent: false,
        observedAt: "2026-08-19T10:00:00.000Z",
      });
      expect(result.next).toEqual(ACTIVE);
      expect(result.events).toEqual([]);
      expect(result.absenceEvaluated).toBe(false);
    },
  );

  it("requires two complete healthy absences before removal", () => {
    const first = evaluatePublicationPresence({
      current: ACTIVE,
      healthState: "HEALTHY",
      inventoryComplete: true,
      observedPresent: false,
      observedAt: "2026-08-19T10:00:00.000Z",
    });
    expect(first.next.state).toBe("MISSING_PENDING");
    expect(first.next.missingHealthyRunCount).toBe(1);

    const second = evaluatePublicationPresence({
      current: first.next,
      healthState: "HEALTHY",
      inventoryComplete: true,
      observedPresent: false,
      observedAt: "2026-08-20T10:00:00.000Z",
    });
    expect(second.next.state).toBe("REMOVED");
    expect(second.events).toEqual(["PUBLICATION_REMOVED"]);
  });

  it("resets missing streak and emits reappearance", () => {
    const result = evaluatePublicationPresence({
      current: {
        ...ACTIVE,
        state: "MISSING_PENDING",
        missingHealthyRunCount: 1,
        missingSince: "2026-08-18T10:00:00.000Z",
      },
      healthState: "HEALTHY",
      inventoryComplete: true,
      observedPresent: true,
      observedSourceStatus: "ACTIVE",
      observedAt: "2026-08-19T10:00:00.000Z",
    });
    expect(result.next).toEqual(ACTIVE);
    expect(result.events).toEqual(["PUBLICATION_REAPPEARED"]);
  });

  it("uses explicit sold evidence without a missing sequence", () => {
    const result = evaluatePublicationPresence({
      current: ACTIVE,
      healthState: "HEALTHY",
      inventoryComplete: true,
      observedPresent: true,
      observedSourceStatus: "SOLD",
      observedAt: "2026-08-19T10:00:00.000Z",
    });
    expect(result.next.state).toBe("SOLD_MARKED");
    expect(result.events).toEqual(["SOURCE_MARKED_SOLD"]);
  });
});

describe("true market age", () => {
  it("preserves older evidence when a property is relaunched", () => {
    const original = {
      lowerBound: "2024-03-01T00:00:00.000Z",
      upperBound: "2024-03-31T23:59:59.999Z",
      method: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
      confidence: 0.4,
    };
    const relaunch = {
      lowerBound: null,
      upperBound: "2026-08-19T09:00:00.000Z",
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.3,
    };
    expect(mergeTrueMarketStart(original, relaunch)).toEqual(original);
  });

  it("reports bounded age rather than false precision", () => {
    expect(
      trueMarketAgeDays(
        {
          lowerBound: "2024-03-01T00:00:00.000Z",
          upperBound: "2024-03-31T23:59:59.999Z",
          method: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
          confidence: 0.4,
        },
        "2024-04-10T00:00:00.000Z",
      ),
    ).toEqual({ minimumDays: 9, maximumDays: 40 });
  });
});

describe("manual override authority", () => {
  it("uses the latest active append-only override over derived state", () => {
    const result = resolveAuthoritativeValue({
      key: "agencyListing.state",
      derivedValue: "EXIT_PENDING",
      asOf: "2026-08-20T00:00:00.000Z",
      overrides: [
        {
          id: "override-1",
          overrideKey: "agencyListing.state",
          overrideValue: "CLOSED_WITHDRAWN",
          effectiveAt: "2026-08-18T00:00:00.000Z",
          createdAt: "2026-08-18T01:00:00.000Z",
          supersedesId: null,
          reason: "Owner confirmed withdrawal",
        },
        {
          id: "override-2",
          overrideKey: "agencyListing.state",
          overrideValue: "CLOSED_SOLD",
          effectiveAt: "2026-08-19T00:00:00.000Z",
          createdAt: "2026-08-19T01:00:00.000Z",
          supersedesId: "override-1",
          reason: "Notarial evidence received",
        },
      ],
    });
    expect(result).toMatchObject({
      value: "CLOSED_SOLD",
      source: "MANUAL_OVERRIDE",
      overrideId: "override-2",
    });
  });
});
