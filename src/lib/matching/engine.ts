import { buildExplanation } from "./explanations";
import {
  DEFAULT_MATCHING_CONFIG, clampScore, classifyScore, scoreBudget, scoreRange,
  sqmCoherenceWarnings,
} from "./scoring";
import type { MatchResult, MatchingContext } from "./types";

function scoreFloorBand(
  band: MatchingContext["request"]["requested_floor_band"],
  floor: number | null,
  buildingFloors: number | null,
) {
  if (!band || band === "any") return null;
  if (floor == null) return 0.25;
  if (band === "low") return floor <= 2 ? 1 : 0;
  if (band === "medium") return floor >= 3 && floor <= 4 ? 1 : 0;
  if (band === "high") return floor >= 5 ? 1 : 0;
  return buildingFloors != null && floor === buildingFloors ? 1 : 0;
}

export function calculateMatch(context: MatchingContext): MatchResult {
  const { request, property } = context;
  const config = context.config ?? DEFAULT_MATCHING_CONFIG;
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  const warnings = sqmCoherenceWarnings(request.internal_sqm_ideal, request.rooms_ideal);

  if (request.contract_type !== property.contract_type) {
    conflicts.push("tipo di contratto diverso");
    return {
      score: 0, classification: "not_relevant", matched_criteria: [],
      missing_preferences: [], conflicting_criteria: conflicts,
      explanation: buildExplanation(0, "not_relevant", [], [], conflicts), warnings,
    };
  }

  let earned = 0;
  let available = 0;
  const add = (weight: number, ratio: number, ok: string, no?: string) => {
    available += weight;
    earned += weight * Math.max(0, Math.min(1, ratio));
    if (ratio >= 0.75) matched.push(ok);
    else if (no) missing.push(no);
  };

  add(
    config.weights.propertyType,
    request.property_types.length === 0 || request.property_types.includes(property.property_type) ? 1 : 0,
    "tipologia", "tipologia diversa",
  );

  const zones = context.requestZones ?? [];
  if (zones.length) {
    available += config.weights.zone;
    const current = zones.find((zone) => zone.zone_id === property.internal_zone_id);
    const required = zones.filter((zone) => zone.preference_level === "required");
    if (current?.preference_level === "excluded") conflicts.push("zona esclusa");
    else if (current?.preference_level === "required") { earned += config.weights.zone; matched.push(current.zone?.name ?? "zona richiesta"); }
    else if (current?.preference_level === "preferred") { earned += config.weights.zone * 0.9; matched.push(current.zone?.name ?? "zona preferita"); }
    else if (current?.preference_level === "accepted") { earned += config.weights.zone * 0.65; matched.push(current.zone?.name ?? "zona accettata"); }
    else if (required.length) conflicts.push("zona obbligatoria non rispettata");
    else earned += config.weights.zone * 0.35;
  }

  const price = request.contract_type === "sale" ? property.price : property.monthly_rent;
  const ideal = request.contract_type === "sale" ? request.budget_ideal : request.monthly_rent_ideal;
  const maximum = request.contract_type === "sale" ? request.budget_max : request.monthly_rent_max;
  add(config.weights.budget, scoreBudget(price, ideal, maximum, config), "budget", "budget oltre la preferenza");
  add(config.weights.internalSqm, scoreRange(property.internal_sqm, request.internal_sqm_min, request.internal_sqm_ideal, request.internal_sqm_max), "metratura", "metratura fuori intervallo");
  add(config.weights.rooms, scoreRange(property.rooms, request.rooms_min, request.rooms_ideal, request.rooms_max), "vani", "vani fuori intervallo");

  const floorBandScore = scoreFloorBand(
    request.requested_floor_band,
    property.floor,
    property.building_floors,
  );
  if (floorBandScore != null) {
    add(config.weights.floor, floorBandScore, "piano", "piano non preferito");
  } else if (request.floor_min != null || request.floor_max != null) {
    add(config.weights.floor, scoreRange(property.floor, request.floor_min, null, request.floor_max), "piano", "piano non preferito");
  }
  if (request.accepted_conditions.length) {
    add(config.weights.condition, property.condition && request.accepted_conditions.includes(property.condition) ? 1 : 0, "stato immobile", "stato immobile diverso");
  }
  if (request.availability_requirement) {
    add(config.weights.availability, property.availability_status === request.availability_requirement ? 1 : 0.25, "disponibilità", "disponibilità diversa");
  }

  const values = new Map((context.propertyFeatures ?? []).map((item) => [item.feature_definition_id, item.value]));
  for (const preference of context.requestFeatures ?? []) {
    if (preference.preference_level === "indifferent") continue;
    const weight = preference.custom_weight ?? preference.feature?.default_weight ?? 5;
    available += weight;
    const present = Boolean(values.get(preference.feature_definition_id));
    const label = preference.feature?.label ?? "caratteristica";
    if (preference.preference_level === "avoid") {
      if (present) conflicts.push(`${label} da evitare`);
      else { earned += weight; matched.push(`senza ${label.toLowerCase()}`); }
    } else if (present) {
      earned += weight;
      matched.push(label);
    } else if (preference.preference_level === "required") {
      conflicts.push(`${label} obbligatorio`);
    } else {
      earned += weight * 0.25;
      missing.push(label);
    }
  }

  let score = available ? (earned / available) * 100 : 0;
  score -= conflicts.length * 12;
  score = clampScore(score);
  const classification = classifyScore(score, config);
  return {
    score, classification, matched_criteria: matched,
    missing_preferences: missing, conflicting_criteria: conflicts,
    explanation: buildExplanation(score, classification, matched, missing, conflicts),
    warnings,
  };
}
