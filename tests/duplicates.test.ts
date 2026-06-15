import { describe, expect, it } from "vitest";

import { duplicateConfidence } from "@/lib/listings/duplicates";

describe("duplicate detection", () => {
  it("recognizes the same property published with a similar title", () => {
    const confidence = duplicateConfidence(
      {
        title: "Trilocale luminoso in via Roma",
        address_raw: "Via Roma 12, Bitonto",
        zone: "Centro",
        price: 145000,
        sqm: 92,
      },
      {
        id: "candidate",
        title: "Luminoso trilocale Via Roma",
        address_raw: "Via Roma 12 Bitonto",
        zone: "Centro",
        price: 149000,
        sqm: 90,
        duplicate_group_id: null,
      },
    );

    expect(confidence).toBeGreaterThanOrEqual(6);
  });

  it("keeps unrelated properties separated", () => {
    const confidence = duplicateConfidence(
      {
        title: "Villa con giardino",
        address_raw: "Via Bari 2",
        zone: "Periferia",
        price: 350000,
        sqm: 220,
      },
      {
        id: "candidate",
        title: "Bilocale da ristrutturare",
        address_raw: "Via Roma 88",
        zone: "Centro",
        price: 70000,
        sqm: 55,
        duplicate_group_id: null,
      },
    );

    expect(confidence).toBeLessThan(6);
  });
});
