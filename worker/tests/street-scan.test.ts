import { describe, expect, it } from "vitest";

import {
  exactStreetVariants,
  hasReachedStreetEnd,
  normalizeSisterStreet,
  shouldStopStreetRun,
  splitSisterStreetInput,
  updateVerifiedEmptyCounters,
} from "../src/core/street-scan.js";

describe("scansione via SISTER", () => {
  const toponyms = [
    { text: "TUTTI", value: "0#TUTTI" },
    { text: "VIA", value: "236#VIA" },
    { text: "VIA PRIVATA", value: "812#VIA PRIVATA" },
  ];

  it("separa il toponimo più lungo dal nome della via", () => {
    expect(splitSisterStreetInput("via privata Borgo San Francesco", toponyms)).toEqual({
      requestedStreet: "VIA PRIVATA BORGO SAN FRANCESCO",
      toponymValue: "812#VIA PRIVATA",
      toponymText: "VIA PRIVATA",
      addressText: "BORGO SAN FRANCESCO",
    });
  });

  it("mantiene soltanto le corrispondenze testuali esatte e conserva i duplicati", () => {
    const variants = exactStreetVariants("via borgo san francesco", [
      { text: "TRAVERSA II DI VIA PRIVATA BORGO SAN FRANCESCO", value: "422036##TRAVERSA" },
      { text: "VIA BORGO SAN FRANCESCO", value: "542250#236#VIA BORGO SAN FRANCESCO" },
      { text: "VIA BORGO SAN FRANCESCO", value: "557509#236#VIA BORGO SAN FRANCESCO" },
      { text: "VIA PRIVATA BORGO SAN FRANCESCO", value: "38719##VIA PRIVATA BORGO SAN FRANCESCO" },
    ]);
    expect(variants.map((variant) => variant.sourceId)).toEqual(["542250", "557509"]);
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(2);
  });

  it("non interpreta un errore come civico vuoto", () => {
    let counters: Record<string, number> = { "542250:1": 49, "557509:1": 49 };
    counters = updateVerifiedEmptyCounters(counters, "542250:1", "failed");
    expect(counters["542250:1"]).toBe(0);
    expect(counters["557509:1"]).toBe(49);
  });

  it("ferma la via soltanto quando tutte le varianti hanno 50 vuoti consecutivi", () => {
    const variants = exactStreetVariants("VIA BORGO SAN FRANCESCO", [
      { text: "VIA BORGO SAN FRANCESCO", value: "542250#236#VIA BORGO SAN FRANCESCO" },
      { text: "VIA BORGO SAN FRANCESCO", value: "557509#236#VIA BORGO SAN FRANCESCO" },
    ]);
    expect(hasReachedStreetEnd(variants, { [variants[0]!.key]: 50, [variants[1]!.key]: 49 }, 50)).toBe(false);
    expect(hasReachedStreetEnd(variants, { [variants[0]!.key]: 50, [variants[1]!.key]: 50 }, 50)).toBe(true);
    expect(shouldStopStreetRun(variants, { [variants[0]!.key]: 50, [variants[1]!.key]: 50 }, 50, 1)).toBe(false);
    expect(shouldStopStreetRun(variants, { [variants[0]!.key]: 50, [variants[1]!.key]: 50 }, 50, 0)).toBe(true);
  });

  it("normalizza accenti, punteggiatura e spazi senza accettare nomi simili", () => {
    expect(normalizeSisterStreet("  Vìa  Borgo-San Francesco ")).toBe("VIA BORGO SAN FRANCESCO");
    expect(normalizeSisterStreet("VIA PRIVATA BORGO SAN FRANCESCO")).not.toBe(normalizeSisterStreet("VIA BORGO SAN FRANCESCO"));
  });
});
