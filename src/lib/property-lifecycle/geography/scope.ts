import type { NormalizedLocation } from "@/lib/property-lifecycle/contracts/normalized-listing";

export interface GeographyInput {
  rawText?: string | null;
  municipality?: string | null;
  locality?: string | null;
  postalCode?: string | null;
  streetName?: string | null;
  streetNumber?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinatesExact?: boolean;
}

const LOCALITY_NAMES = new Map([
  ["bitonto", "Bitonto"],
  ["palombaio", "Palombaio"],
  ["mariotto", "Mariotto"],
]);

const KNOWN_OUT_OF_SCOPE = [
  "bari",
  "santo spirito",
  "terlizzi",
  "giovinazzo",
  "molfetta",
  "modugno",
  "palo del colle",
  "ruvo di puglia",
];

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasPlace(haystack: string, place: string): boolean {
  return new RegExp(`(?:^|\\s)${place.replace(/ /g, "\\s+")}(?:$|\\s)`, "i").test(haystack);
}

function extractStreet(rawText: string | null | undefined): {
  streetName: string | null;
  streetNumber: string | null;
} {
  const match = rawText?.match(
    /\b((?:via|viale|piazza|corso|largo|strada|contrada)\s+[a-zà-ÿ' .-]+?)(?:\s*(?:(?:,|\bn\.?|\bn°)\s*)?(\d+[a-z]?))?(?=\s*[|,;-]|$)/i,
  );
  return {
    streetName: match?.[1]?.replace(/\s+/g, " ").trim() ?? null,
    streetNumber: match?.[2]?.trim() ?? null,
  };
}

export function resolveMonitoredGeography(input: GeographyInput): NormalizedLocation {
  const raw = normalize(input.rawText);
  const municipality = normalize(input.municipality);
  const locality = normalize(input.locality);
  const combined = [raw, municipality, locality].filter(Boolean).join(" ");
  const inScopeMatches = [...LOCALITY_NAMES.keys()].filter((place) => hasPlace(combined, place));
  const outOfScopeMatches = KNOWN_OUT_OF_SCOPE.filter((place) => hasPlace(combined, place));
  const reasons: string[] = [];

  let scope: NormalizedLocation["scope"] = "REVIEW";
  let resolutionConfidence = 0.35;
  let normalizedLocality: string | null = null;
  let normalizedMunicipality: string | null = null;
  const extractedStreet = extractStreet(input.rawText);
  const streetName = input.streetName?.trim() || extractedStreet.streetName;
  const streetNumber = input.streetNumber?.trim() || extractedStreet.streetNumber;

  if (inScopeMatches.length > 0 && outOfScopeMatches.length > 0) {
    reasons.push("conflicting_in_scope_and_out_of_scope_place_names");
  } else if (inScopeMatches.length > 0) {
    scope = "IN_SCOPE";
    resolutionConfidence = municipality === "bitonto" || locality ? 0.98 : 0.9;
    normalizedLocality = LOCALITY_NAMES.get(
      inScopeMatches.find((value) => value !== "bitonto") ?? "bitonto",
    ) ?? null;
    normalizedMunicipality = "Bitonto";
    reasons.push(`explicit_monitored_place:${inScopeMatches.join(",")}`);
  } else if (outOfScopeMatches.length > 0) {
    scope = "OUT_OF_SCOPE";
    resolutionConfidence = 0.98;
    reasons.push(`explicit_out_of_scope_place:${outOfScopeMatches.join(",")}`);
  } else if (input.postalCode === "70032") {
    reasons.push("postal_code_only_requires_review");
  } else {
    reasons.push("no_explicit_monitored_place");
  }

  return {
    rawText: input.rawText?.trim() || null,
    municipality: normalizedMunicipality,
    locality: normalizedLocality,
    postalCode: input.postalCode?.trim() || null,
    streetName,
    streetNumber,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    precision:
      streetName && streetNumber
        ? "EXACT_ADDRESS"
        : input.coordinatesExact && input.latitude != null && input.longitude != null
          ? "EXACT_COORDINATES"
          : streetName
            ? "STREET_ONLY"
            : input.rawText
              ? "APPROXIMATE_AREA"
              : "UNKNOWN",
    scope,
    resolutionMethod: "STRICT_PLACE_NAME_V1",
    resolutionConfidence,
    reasons,
  };
}

export function isMonitoredGeography(input: GeographyInput): boolean {
  return resolveMonitoredGeography(input).scope === "IN_SCOPE";
}
