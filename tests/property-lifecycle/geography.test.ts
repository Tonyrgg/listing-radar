import { describe, expect, it } from "vitest";

import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";

describe("strict monitored geography", () => {
  it.each([
    ["Bitonto, Via Mazzini", "Bitonto"],
    ["Palombaio - Piazza Milite Ignoto", "Palombaio"],
    ["Frazione Mariotto, Bitonto", "Mariotto"],
  ])("accepts explicit monitored place %s", (rawText, locality) => {
    const result = resolveMonitoredGeography({ rawText });
    expect(result.scope).toBe("IN_SCOPE");
    expect(result.municipality).toBe("Bitonto");
    expect(result.locality).toBe(locality);
  });

  it.each(["Bari, Santo Spirito", "Terlizzi", "Giovinazzo", "Palo del Colle"])(
    "rejects explicit out-of-scope place %s",
    (rawText) => {
      expect(resolveMonitoredGeography({ rawText }).scope).toBe("OUT_OF_SCOPE");
    },
  );

  it("does not accept postal code alone", () => {
    const result = resolveMonitoredGeography({ postalCode: "70032" });
    expect(result.scope).toBe("REVIEW");
    expect(result.reasons).toContain("postal_code_only_requires_review");
  });

  it("requires review for conflicting place names", () => {
    const result = resolveMonitoredGeography({ rawText: "SP Bitonto - Santo Spirito" });
    expect(result.scope).toBe("REVIEW");
  });

  it.each([
    ["Bitonto, Via Mazzini 10", "EXACT_ADDRESS", "Via Mazzini", "10"],
    ["Bitonto, Via Mazzini", "STREET_ONLY", "Via Mazzini", null],
    ["Bitonto zona centro", "APPROXIMATE_AREA", null, null],
  ] as const)(
    "represents location precision for %s",
    (rawText, precision, streetName, streetNumber) => {
      expect(resolveMonitoredGeography({ rawText })).toMatchObject({
        precision,
        streetName,
        streetNumber,
      });
    },
  );

  it("does not call unverified coordinates exact", () => {
    expect(
      resolveMonitoredGeography({
        rawText: "Bitonto",
        latitude: 41.11,
        longitude: 16.69,
      }).precision,
    ).toBe("APPROXIMATE_AREA");
  });
});
