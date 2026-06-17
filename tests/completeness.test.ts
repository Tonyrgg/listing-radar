import { describe, expect, it } from "vitest";

import {
  getListingCompletenessScore,
  getMissingListingFields,
  hasRequiredListingGaps,
} from "@/lib/listings/completeness";

describe("listing completeness", () => {
  it("flags required and recommended gaps", () => {
    const listing = {
      title: "Trilocale in vendita",
      description: "Breve.",
      price: null,
      sqm: 90,
      rooms: null,
      zone: "Bitonto",
      addressRaw: null,
      sellerType: "unknown" as const,
      sellerName: null,
      phone: null,
      imageUrls: [],
    };
    const missing = getMissingListingFields(listing);

    expect(missing.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "price",
        "rooms",
        "description",
        "imageUrls",
        "sellerType",
      ]),
    );
    expect(hasRequiredListingGaps(listing)).toBe(true);
    expect(getListingCompletenessScore(listing)).toBeLessThan(70);
  });

  it("scores complete listings at 100", () => {
    const listing = {
      title: "Trilocale completo",
      description:
        "Descrizione completa con informazioni su stato interno, zona, superficie, locali e condizioni generali dell'immobile.",
      price: 150000,
      sqm: 95,
      rooms: 3,
      zone: "Bitonto",
      addressRaw: "Via Roma, Bitonto",
      sellerType: "private" as const,
      sellerName: "Mario",
      phone: "3330000000",
      imageUrls: ["https://example.com/photo.jpg"],
    };

    expect(getMissingListingFields(listing)).toHaveLength(0);
    expect(getListingCompletenessScore(listing)).toBe(100);
  });
});
