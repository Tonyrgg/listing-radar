import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decidePropertyIdentity,
  type IdentityCandidate,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";

interface GoldenCase {
  id: string;
  groundTruth: "SAME" | "DIFFERENT" | "UNKNOWN";
  category: string;
  evidence: string;
  urls: string[];
  observation: IdentityObservation;
  candidate: IdentityCandidate;
}

const dataset = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      "tests",
      "fixtures",
      "property-lifecycle",
      "identity-golden-live.json",
    ),
    "utf8",
  ),
) as { version: number; cases: GoldenCase[] };

describe("Property Identity live Golden Dataset", () => {
  it("contains only evidenced labels in the measured sample", () => {
    expect(dataset.version).toBe(1);
    expect(dataset.cases.filter((item) => item.groundTruth === "SAME")).toHaveLength(3);
    expect(dataset.cases.filter((item) => item.groundTruth === "DIFFERENT").length).toBeGreaterThanOrEqual(7);
    for (const item of dataset.cases) {
      expect(item.evidence.length).toBeGreaterThan(30);
      expect(item.urls.length).toBeGreaterThan(0);
    }
  });

  it("keeps auto-match precision at 100% and retrieval recall at 100% on verified cases", () => {
    const measured = dataset.cases
      .filter((item) => item.groundTruth !== "UNKNOWN")
      .map((item) => ({
        item,
        decision: decidePropertyIdentity(item.observation, [item.candidate]),
      }));
    const same = measured.filter(({ item }) => item.groundTruth === "SAME");
    const different = measured.filter(({ item }) => item.groundTruth === "DIFFERENT");
    const autoMatches = measured.filter(
      ({ decision }) => decision.outcome === "AUTO_MATCH",
    );
    const trueAutoMatches = autoMatches.filter(
      ({ item }) => item.groundTruth === "SAME",
    );
    const retrievedSame = same.filter(
      ({ decision }) => (decision.retrieval?.includedCount ?? 0) > 0,
    );
    const falsePositives = different.filter(
      ({ decision }) => decision.outcome === "AUTO_MATCH",
    );

    const precision = trueAutoMatches.length / Math.max(1, autoMatches.length);
    const retrievalRecall = retrievedSame.length / same.length;
    const falsePositiveRate = falsePositives.length / different.length;
    const falseNegativeRate =
      same.filter(({ decision }) => decision.outcome === "NEW_PROPERTY").length /
      same.length;

    expect({ precision, retrievalRecall, falsePositiveRate, falseNegativeRate }).toEqual({
      precision: 1,
      retrievalRecall: 1,
      falsePositiveRate: 0,
      falseNegativeRate: 0,
    });
  });

  it("never auto-merges UNKNOWN building-level or plausible cross-agency cases", () => {
    for (const item of dataset.cases.filter(
      (candidate) => candidate.groundTruth === "UNKNOWN",
    )) {
      const decision = decidePropertyIdentity(item.observation, [item.candidate]);
      expect(decision.outcome, item.id).not.toBe("AUTO_MATCH");
    }
  });
});
