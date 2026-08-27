import type { CadastralOwner, CadastralProperty } from "../types.js";

export type NetworkExistingPropertyPolicy = "new_only" | "include_existing";

export type NetworkExplorationSettings = {
  targetProperties: number;
  seedCount: number;
  maxPeople: number;
  maxDepth: number;
  minSharePercentage: number;
  existingPropertyPolicy: NetworkExistingPropertyPolicy;
  residentialOnly: boolean;
};

export const DEFAULT_NETWORK_EXPLORATION_SETTINGS: NetworkExplorationSettings = {
  targetProperties: 12,
  seedCount: 4,
  maxPeople: 80,
  maxDepth: 3,
  minSharePercentage: 0,
  existingPropertyPolicy: "new_only",
  residentialOnly: true,
};

export type NetworkPropertyDecision =
  | { eligible: true; kind: "new" | "existing_update" }
  | { eligible: false; reason: "non_strategic_category" | "share_below_minimum" | "already_in_crm" | "without_owners" };

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
): NetworkPropertyDecision {
  if (!isStrategicNetworkCategory(property.category, settings.residentialOnly)) {
    return { eligible: false, reason: "non_strategic_category" };
  }
  if (!owners.length) return { eligible: false, reason: "without_owners" };
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
  const minShare = Number(value.minSharePercentage);
  return {
    targetProperties: boundedInteger(value.targetProperties, DEFAULT_NETWORK_EXPLORATION_SETTINGS.targetProperties, 1, 200),
    seedCount: boundedInteger(value.seedCount, DEFAULT_NETWORK_EXPLORATION_SETTINGS.seedCount, 1, 30),
    maxPeople: boundedInteger(value.maxPeople, DEFAULT_NETWORK_EXPLORATION_SETTINGS.maxPeople, 1, 500),
    maxDepth: boundedInteger(value.maxDepth, DEFAULT_NETWORK_EXPLORATION_SETTINGS.maxDepth, 0, 8),
    minSharePercentage: Number.isFinite(minShare) ? Math.max(0, Math.min(100, minShare)) : 0,
    existingPropertyPolicy: value.existingPropertyPolicy === "include_existing" ? "include_existing" : "new_only",
    residentialOnly: value.residentialOnly !== false,
  };
}
