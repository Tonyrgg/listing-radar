import type { CadastralOwner, CadastralProperty } from "../types.js";
import { birthDateFromTaxCode, extractFirstCivicNumber } from "./normalize.js";

export type NetworkExistingPropertyPolicy = "new_only" | "include_existing";
export type NetworkFloorMode = "any" | "exact" | "minimum" | "maximum";

export type NetworkExplorationSettings = {
  targetProperties: number;
  seedCount: number;
  maxPeople: number;
  maxDepth: number;
  minSharePercentage: number;
  existingPropertyPolicy: NetworkExistingPropertyPolicy;
  residentialOnly: boolean;
  floorMode: NetworkFloorMode;
  floorValue: number | null;
  minOwnerAge: number | null;
  maxOwnerAge: number | null;
  minOwnerCount: number | null;
  maxOwnerCount: number | null;
  minCivicNumber: number | null;
  maxCivicNumber: number | null;
};

export const DEFAULT_NETWORK_EXPLORATION_SETTINGS: NetworkExplorationSettings = {
  targetProperties: 12,
  seedCount: 4,
  maxPeople: 80,
  maxDepth: 3,
  minSharePercentage: 0,
  existingPropertyPolicy: "new_only",
  residentialOnly: true,
  floorMode: "any",
  floorValue: null,
  minOwnerAge: null,
  maxOwnerAge: null,
  minOwnerCount: null,
  maxOwnerCount: null,
  minCivicNumber: null,
  maxCivicNumber: null,
};

export type NetworkPropertyDecision =
  | { eligible: true; kind: "new" | "existing_update" }
  | { eligible: false; reason: "non_strategic_category" | "share_below_minimum" | "already_in_crm" | "without_owners" | "floor_out_of_range" | "owner_age_out_of_range" | "owner_count_out_of_range" | "civic_out_of_range" };

export function extractPropertyFloors(address: string | null | undefined): number[] {
  const token = String(address ?? "").match(/\bPIANO\s+((?:T|S\d+|-?\d+)(?:\s*-\s*(?:T|S\d+|-?\d+))*)/i)?.[1];
  if (!token) return [];
  return token.split(/\s*-\s*/).map((part) => {
    const normalized = part.trim().toUpperCase();
    if (normalized === "T") return 0;
    if (/^S\d+$/.test(normalized)) return -Number(normalized.slice(1));
    return Number(normalized);
  }).filter(Number.isFinite);
}

export function ownerAgeAt(birthDate: string | null | undefined, asOf = new Date()): number | null {
  const match = String(birthDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let age = asOf.getUTCFullYear() - year;
  if (asOf.getUTCMonth() + 1 < month || (asOf.getUTCMonth() + 1 === month && asOf.getUTCDate() < day)) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

export function isStrategicNetworkCategory(category: string | null | undefined, residentialOnly: boolean) {
  const normalized = String(category ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return false;
  // The default deliberately keeps the graph focused on homes. C/ categories
  // are where garages, cellars and warehouses accumulate, and can be enabled
  // later only through an explicit profile rather than slipping in by chance.
  return residentialOnly ? /^A\/?\d+$/i.test(normalized) : /^(?:A|C)\/?\d+$/i.test(normalized);
}

export function decideNetworkProperty(
  property: CadastralProperty,
  owners: CadastralOwner[],
  settings: NetworkExplorationSettings,
  alreadyInCrm: boolean,
  asOf = new Date(),
): NetworkPropertyDecision {
  if (!isStrategicNetworkCategory(property.category, settings.residentialOnly)) {
    return { eligible: false, reason: "non_strategic_category" };
  }
  if (!owners.length) return { eligible: false, reason: "without_owners" };
  if ((settings.minOwnerCount != null && owners.length < settings.minOwnerCount)
    || (settings.maxOwnerCount != null && owners.length > settings.maxOwnerCount)) {
    return { eligible: false, reason: "owner_count_out_of_range" };
  }
  if (settings.floorMode !== "any" && settings.floorValue != null) {
    const floors = extractPropertyFloors(property.address);
    const floorMatch = settings.floorMode === "exact"
      ? floors.includes(settings.floorValue)
      : settings.floorMode === "minimum"
        ? floors.some((floor) => floor >= settings.floorValue!)
        : floors.some((floor) => floor <= settings.floorValue!);
    if (!floorMatch) return { eligible: false, reason: "floor_out_of_range" };
  }
  if (settings.minCivicNumber != null || settings.maxCivicNumber != null) {
    const civic = Number.parseInt(extractFirstCivicNumber(property.address) ?? "", 10);
    if (!Number.isFinite(civic)
      || (settings.minCivicNumber != null && civic < settings.minCivicNumber)
      || (settings.maxCivicNumber != null && civic > settings.maxCivicNumber)) {
      return { eligible: false, reason: "civic_out_of_range" };
    }
  }
  if (settings.minOwnerAge != null || settings.maxOwnerAge != null) {
    const matchingOwner = owners.some((owner) => {
      /* Se SISTER non stampa la data di nascita, quella vera sta comunque
       * dentro il codice fiscale: senza questa lettura il requisito d'eta'
       * scartava persone che invece lo soddisfano. */
      const age = ownerAgeAt(owner.birthDate, asOf)
        ?? ownerAgeAt(birthDateFromTaxCode(owner.taxCode, asOf), asOf);
      return age != null
        && (settings.minOwnerAge == null || age >= settings.minOwnerAge)
        && (settings.maxOwnerAge == null || age <= settings.maxOwnerAge);
    });
    if (!matchingOwner) return { eligible: false, reason: "owner_age_out_of_range" };
  }
  if (settings.minSharePercentage > 0 && !owners.some((owner) => (owner.sharePercentage ?? 0) >= settings.minSharePercentage)) {
    return { eligible: false, reason: "share_below_minimum" };
  }
  if (alreadyInCrm && settings.existingPropertyPolicy === "new_only") {
    return { eligible: false, reason: "already_in_crm" };
  }
  return { eligible: true, kind: alreadyInCrm ? "existing_update" : "new" };
}

export function normalizeNetworkSettings(value: Partial<NetworkExplorationSettings>): NetworkExplorationSettings {
  const boundedInteger = (input: unknown, fallback: number, min: number, max: number) => {
    const number = Math.trunc(Number(input));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const optionalInteger = (input: unknown, min: number, max: number) => {
    if (input === null || input === undefined || input === "") return null;
    const number = Math.trunc(Number(input));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
  };
  const orderedRange = (left: number | null, right: number | null) =>
    left != null && right != null && left > right ? [right, left] as const : [left, right] as const;
  const minShare = Number(value.minSharePercentage);
  const floorMode = ["exact", "minimum", "maximum"].includes(String(value.floorMode))
    ? value.floorMode as NetworkFloorMode : "any";
  const floorValue = optionalInteger(value.floorValue, -10, 100);
  const [minOwnerAge, maxOwnerAge] = orderedRange(optionalInteger(value.minOwnerAge, 0, 120), optionalInteger(value.maxOwnerAge, 0, 120));
  const [minOwnerCount, maxOwnerCount] = orderedRange(optionalInteger(value.minOwnerCount, 1, 100), optionalInteger(value.maxOwnerCount, 1, 100));
  const [minCivicNumber, maxCivicNumber] = orderedRange(optionalInteger(value.minCivicNumber, 0, 999_999), optionalInteger(value.maxCivicNumber, 0, 999_999));
  return {
    targetProperties: boundedInteger(value.targetProperties, DEFAULT_NETWORK_EXPLORATION_SETTINGS.targetProperties, 1, 200),
    seedCount: boundedInteger(value.seedCount, DEFAULT_NETWORK_EXPLORATION_SETTINGS.seedCount, 1, 30),
    maxPeople: boundedInteger(value.maxPeople, DEFAULT_NETWORK_EXPLORATION_SETTINGS.maxPeople, 1, 500),
    maxDepth: boundedInteger(value.maxDepth, DEFAULT_NETWORK_EXPLORATION_SETTINGS.maxDepth, 0, 8),
    minSharePercentage: Number.isFinite(minShare) ? Math.max(0, Math.min(100, minShare)) : 0,
    existingPropertyPolicy: value.existingPropertyPolicy === "include_existing" ? "include_existing" : "new_only",
    residentialOnly: value.residentialOnly !== false,
    floorMode: floorValue == null ? "any" : floorMode,
    floorValue,
    minOwnerAge,
    maxOwnerAge,
    minOwnerCount,
    maxOwnerCount,
    minCivicNumber,
    maxCivicNumber,
  };
}
