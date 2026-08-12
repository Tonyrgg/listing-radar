import { describe, expect, it } from "vitest";

import { classifySeller } from "@/lib/listings/seller-classification";

describe("seller classification", () => {
  it("corrects a portal private flag when the seller is an agency", () => {
    const result = classifySeller({
      source: "idealista",
      declaredType: "private",
      sellerName: "Professionista Rexer - Agenzia Smart",
      title: "Trilocale in vendita",
    });

    expect(result.sellerType).toBe("agency");
    expect(result.confidence).toBeGreaterThan(0.95);
  });

  it("recognizes an explicit private sale", () => {
    expect(
      classifySeller({
        source: "casa",
        declaredType: "unknown",
        description: "Privato vende, no agenzie e no intermediari.",
      }).sellerType,
    ).toBe("private");
  });

  it("never trusts the portal private label over agency evidence", () => {
    expect(
      classifySeller({
        source: "casadaprivato",
        declaredType: "private",
        sellerName: "Abitare Bene Immobiliare S.r.l.",
      }).sellerType,
    ).toBe("agency");
  });
});
