import { describe, expect, it } from "vitest";
import { calculateMatch } from "@/lib/matching/engine";
import { estimateCommercialSqm, sqmCoherenceWarnings } from "@/lib/matching/scoring";
import type { PortfolioProperty, PropertyRequest } from "@/lib/matching/types";

const request: PropertyRequest = {
  id: "r", client_id: null, title: "Casa", contract_type: "sale",
  property_types: ["apartment"], municipality: "Bitonto", status: "active", priority: "normal",
  budget_ideal: 100000, budget_max: 120000, monthly_rent_ideal: null, monthly_rent_max: null,
  internal_sqm_min: 70, internal_sqm_ideal: 90, internal_sqm_max: 110,
  commercial_sqm_estimated_min: null, commercial_sqm_estimated_max: null,
  rooms_min: 3, rooms_ideal: 4, rooms_max: 5, bedrooms_min: 2, bathrooms_min: 1,
  floor_min: null, floor_max: null, building_floors_max: null, accepted_conditions: [],
  availability_requirement: null, available_by: null, notes: null,
};
const property: PortfolioProperty = {
  id: "p", title: "Appartamento", contract_type: "sale", property_type: "apartment",
  municipality: "Bitonto", address: null, internal_zone_id: null, price: 110000,
  monthly_rent: null, internal_sqm: 90, commercial_sqm: 105, rooms: 4, bedrooms: 2,
  bathrooms: 1, floor: 2, building_floors: 4, condition: null,
  availability_status: null, available_from: null, description: null, notes: null,
  mandate_status: "active",
};

describe("matching engine", () => {
  it("riconosce una corrispondenza forte", () => {
    expect(calculateMatch({ request, property }).score).toBeGreaterThanOrEqual(85);
  });
  it("non elimina una feature obbligatoria mancante", () => {
    const result = calculateMatch({
      request, property,
      requestFeatures: [{
        feature_definition_id: "e", preference_level: "required", desired_value: true,
        custom_weight: 8, feature: { id: "e", key: "elevator", label: "Ascensore", category: "x", field_type: "boolean", applies_to: "both", default_weight: 5, is_active: true, sort_order: 0 },
      }],
    });
    expect(result.conflicting_criteria).toContain("Ascensore obbligatorio");
    expect(result.score).toBeGreaterThan(0);
  });
  it("stima la metratura commerciale e segnala incoerenze", () => {
    expect(estimateCommercialSqm(100)).toEqual({ minimum: 110, maximum: 120 });
    expect(sqmCoherenceWarnings(45, 5)).toHaveLength(1);
  });
});
