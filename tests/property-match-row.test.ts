import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PropertyMatchRow } from "@/components/matching/property-match-row";
import type { PortfolioProperty, RequestPropertyMatch } from "@/lib/matching/types";

const property: PortfolioProperty = {
  id: "property-1",
  title: "Appartamento in centro",
  contract_type: "sale",
  property_type: "apartment",
  municipality: "Bitonto",
  address: "Via Roma, 10",
  internal_zone_id: null,
  price: 150_000,
  monthly_rent: null,
  internal_sqm: 90,
  commercial_sqm: 100,
  rooms: 3,
  bedrooms: 2,
  bathrooms: 1,
  floor: 1,
  building_floors: 3,
  condition: "good",
  availability_status: "available",
  available_from: null,
  description: null,
  notes: null,
  mandate_status: "active",
};

describe("PropertyMatchRow", () => {
  it("mostra il punteggio percentuale accanto al verdetto", () => {
    const match: RequestPropertyMatch = {
      request_id: "request-1",
      property_id: property.id,
      score: 87.4,
      classification: "compatible",
      matched_criteria: ["budget"],
      missing_preferences: [],
      conflicting_criteria: [],
      explanation: "Compatibile",
    };

    const html = renderToStaticMarkup(createElement(PropertyMatchRow, { match, property }));

    expect(html).toContain("Va bene");
    expect(html).toContain("87%");
    expect(html).toContain("Affinità calcolata: 87 su 100");
  });
});
