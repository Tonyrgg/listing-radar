import { buildExplanation } from "./explanations";
import { ELEVATOR_FEATURE_KEY, evaluateElevatorRequirement } from "./elevator";
import { polygonLabelPoint, type MapPoint } from "@/lib/map/geometry";
import {
  DEFAULT_MATCHING_CONFIG, clampScore, classifyScore, scoreBudget, scoreInternalSqm,
  scorePropertyType, scoreRange, scoreRooms, sqmCoherenceWarnings,
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

  const typeRatio = scorePropertyType(request.property_types, property.property_type, config);
  // Contratto, tipologia e ascensore obbligatorio sono le domande a cui non si
  // risponde «quasi»: se sbagliano, il match non nasce invece di nascere debole
  // e restare in lista.
  const elevator = evaluateElevatorRequirement(context);
  const blocking = request.contract_type !== property.contract_type
    ? "tipo di contratto diverso"
    : elevator.kind === "excluded" ? elevator.reason : null;
  if (blocking || typeRatio == null) {
    conflicts.push(blocking ?? "tipologia incompatibile");
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

  add(config.weights.propertyType, typeRatio, "tipologia", "tipologia affine ma diversa");

  const zones = context.requestZones ?? [];
  if (zones.length) {
    available += config.weights.zone;
    const current = zones.find((zone) => zone.zone_id === property.internal_zone_id);
    const required = zones.filter((zone) => zone.preference_level === "required");
    const desired = zones.filter((zone) => zone.preference_level !== "excluded");
    if (current?.preference_level === "excluded") conflicts.push("zona esclusa");
    else if (current?.preference_level === "required") { earned += config.weights.zone; matched.push(current.zone?.name ?? "zona richiesta"); }
    else if (current?.preference_level === "preferred") { earned += config.weights.zone * 0.9; matched.push(current.zone?.name ?? "zona preferita"); }
    else if (current?.preference_level === "accepted") { earned += config.weights.zone * 0.65; matched.push(current.zone?.name ?? "zona accettata"); }
    else if (!desired.length) {
      earned += config.weights.zone;
      matched.push("zona non esclusa");
    } else {
      const proximity = closestDesiredZone(property, desired);
      if (proximity) {
        earned += config.weights.zone * proximity.ratio;
        const distance = proximity.distanceKm.toLocaleString("it-IT", { maximumFractionDigits: 1 });
        if (proximity.ratio >= 0.75) matched.push(`vicino a ${proximity.name}`);
        else missing.push(`zona a ${distance} km da ${proximity.name}`);
        if (required.length && proximity.distanceKm > .8) conflicts.push("zona obbligatoria troppo distante");
      } else {
        earned += config.weights.zone * .2;
        missing.push("zona immobile non localizzata");
        if (required.length) conflicts.push("zona obbligatoria non verificabile");
      }
    }
  }

  const price = request.contract_type === "sale" ? property.price : property.monthly_rent;
  const ideal = request.contract_type === "sale" ? request.budget_ideal : request.monthly_rent_ideal;
  const maximum = request.contract_type === "sale" ? request.budget_max : request.monthly_rent_max;
  add(config.weights.budget, scoreBudget(price, ideal, maximum, config), "budget", "budget fuori fascia");
  add(config.weights.internalSqm, scoreInternalSqm(property.internal_sqm, request.internal_sqm_min, request.internal_sqm_ideal, request.internal_sqm_max, config), "metratura", "metratura fuori intervallo");
  add(config.weights.rooms, scoreRooms(property.rooms, request.rooms_min, request.rooms_ideal, request.rooms_max, config), "vani", "vani fuori intervallo");

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
    const acceptedConditions = request.accepted_conditions.map(canonicalCondition);
    add(config.weights.condition, property.condition && acceptedConditions.includes(canonicalCondition(property.condition)) ? 1 : 0, "stato immobile", "stato immobile diverso");
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
    // L'ascensore obbligatorio ha gia' una risposta: qui arriva solo quando non
    // esclude, e la logica generica non saprebbe che al piano terra va bene
    // anche senza. Le altre caratteristiche restano preferenze pesate.
    if (preference.feature?.key === ELEVATOR_FEATURE_KEY && preference.preference_level === "required") {
      if (elevator.kind === "satisfied") { earned += weight; matched.push(elevator.label); }
      continue;
    }
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

function canonicalCondition(value: string) {
  return ({ good: "normal", habitable: "normal", excellent: "renovated" }[value] ?? value);
}

function closestDesiredZone(
  property: MatchingContext["property"],
  zones: NonNullable<MatchingContext["requestZones"]>,
) {
  const propertyPoint = polygonLabelPoint(property.zone?.geometry);
  if (!propertyPoint) return null;
  const candidates = zones.flatMap((zone) => {
    const point = polygonLabelPoint(zone.zone?.geometry);
    if (!point) return [];
    const distanceKm = distanceBetween(propertyPoint, point);
    return [{
      distanceKm,
      name: zone.zone?.name ?? "zona desiderata",
      ratio: zoneProximityRatio(distanceKm),
    }];
  });
  return candidates.sort((left, right) => left.distanceKm - right.distanceKm)[0] ?? null;
}

export function zoneProximityRatio(distanceKm: number) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return .08;
  return Math.max(.08, Math.min(.82, 1 - distanceKm / 3.2));
}

function distanceBetween(left: MapPoint, right: MapPoint) {
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLatitude = radians(right.latitude - left.latitude);
  const deltaLongitude = radians(right.longitude - left.longitude);
  const startLatitude = radians(left.latitude);
  const endLatitude = radians(right.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
