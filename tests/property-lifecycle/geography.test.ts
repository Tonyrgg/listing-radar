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

  /* Le vie che portano il nome del paese vicino dicono dove si va, non dove si
   * è: leggerle come comuni fuori zona apriva un caso da decidere a mano per
   * ogni annuncio di via Modugno. */
  it.each([
    "BITONTO VIA MODUGNO | PALAZZINA INDIPENDENTE",
    "Via Vincenzo Modugno, Bitonto",
    "via tenente domenico modugno 22, Bitonto (BA) | Bitonto",
    "BITONTO- ZONA VIA PER MODUGNO | APPARTAMENTO DI 3 VANI",
    "BITONTO TRAVERSA VIA MODUGNO | SOLUZIONE SEMI-INDIPENDENTE",
    "Bitonto Via per Santo Spirito",
    "BITONTO VIA SANTO SPIRITO – SP91 | TERRENO",
    "VIA CAZZOLLA 19, Bitonto (BA) | Bitonto (Via Per Modugno - Via Per Palo del Colle)",
  ])("reads a street named after a nearby town as a street: %s", (rawText) => {
    const result = resolveMonitoredGeography({ rawText });
    expect(result.scope).toBe("IN_SCOPE");
    expect(result.municipality).toBe("Bitonto");
    expect(result.reasons.some((reason) => reason.startsWith("street_named_after_place:"))).toBe(
      true,
    );
  });

  it("still rejects a nearby town named on its own", () => {
    expect(resolveMonitoredGeography({ rawText: "Modugno, Via Roma 4" }).scope).toBe(
      "OUT_OF_SCOPE",
    );
  });

  /* Gli annunci scritti in grassetto tipografico: quei caratteri non sono
   * lettere latine, e l'indirizzo si azzerava prima di essere letto. */
  it("reads addresses written in typographic bold", () => {
    const result = resolveMonitoredGeography({
      rawText: "𝐁𝐢𝐭𝐨𝐧𝐭𝐨 – 𝐙𝐨𝐧𝐚 𝐒𝐚𝐧𝐭𝐢 𝐌𝐞𝐝𝐢𝐜𝐢 | 𝟑 𝐕𝐚𝐧𝐢",
    });
    expect(result.scope).toBe("IN_SCOPE");
    expect(result.municipality).toBe("Bitonto");
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
