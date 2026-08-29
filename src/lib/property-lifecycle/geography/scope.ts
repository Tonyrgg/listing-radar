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
  "binetto",
  "bisceglie",
  "cassano delle murge",
  "grumo appula",
];

/**
 * Le agenzie scrivono i titoli in grassetto tipografico \u2014 \u00ab\ud835\udc01\ud835\udc22\ud835\udc2d\ud835\udc28\ud835\udc27\ud835\udc2d\ud835\udc28 \u2013 \ud835\udc19\ud835\udc28\ud835\udc27\ud835\udc1a
 * \ud835\udc12\ud835\udc1a\ud835\udc27\ud835\udc2d\ud835\udc22 \ud835\udc0c\ud835\udc1e\ud835\udc1d\ud835\udc22\ud835\udc1c\ud835\udc22\u00bb \u2014 e quei caratteri non sono lettere latine per Unicode: con
 * `NFD` l'intero indirizzo si azzerava e il posto diventava introvabile.
 * `NFKD` riporta le varianti tipografiche alla lettera che rappresentano, e
 * continua a togliere gli accenti come prima.
 */
function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasPlace(haystack: string, place: string): boolean {
  return new RegExp(`(?:^|\\s)${place.replace(/ /g, "\\s+")}(?:$|\\s)`, "i").test(haystack);
}

/**
 * Le vie intitolate al paese vicino.
 *
 * A Bitonto c'\u00e8 Via Modugno, Via per Santo Spirito, Via per Palo del Colle:
 * strade che portano il nome di dove vanno a finire, non di dove sono. Il
 * confronto sui nomi di posto le leggeva come comuni fuori zona e ogni volta
 * apriva un caso da decidere a mano \u2014 quindici dei ventitr\u00e9 aperti.
 *
 * `strada provinciale` non \u00e8 in elenco di proposito: \u00abSP Bitonto - Santo
 * Spirito\u00bb \u00e8 davvero una strada fra i due paesi, e l\u00ec il dubbio \u00e8 vero.
 */
const STREET_PREFIXES = [
  "via",
  "viale",
  "vico",
  "vicolo",
  "corso",
  "strada",
  "piazza",
  "piazzale",
  "largo",
  "traversa",
  "contrada",
  "lungomare",
];

/** Il testo spezzato dove l'annuncio cambia discorso: `|`, virgole, trattini. */
function addressSegments(...values: Array<string | null | undefined>): string[] {
  return values
    .flatMap((value) => (value ?? "").split(/[|,;:/()[\]\u2013\u2014-]+/))
    .map(normalize)
    .filter(Boolean);
}

function isStreetName(segment: string, place: string): boolean {
  /* Fino a tre parole fra la via e il posto: \u00abvia per Santo Spirito\u00bb,
   * \u00abvia tenente domenico Modugno\u00bb. */
  return new RegExp(
    `(?:^|\\s)(?:${STREET_PREFIXES.join("|")})\\s+(?:[a-z0-9']+\\s+){0,3}?${place.replace(/ /g, "\\s+")}(?:$|\\s)`,
  ).test(segment);
}

/**
 * Vero quando il posto compare solo dentro il nome di una strada: allora dice
 * dove si va, non dove si \u00e8. Se non compare in nessun segmento \u2014 perch\u00e9 una
 * punteggiatura lo taglia a met\u00e0 \u2014 vale come nome di posto: nel dubbio si
 * tiene la prova, non l'interpretazione.
 */
function onlyANearbyStreet(segments: readonly string[], place: string): boolean {
  const occurrences = segments.filter((segment) => hasPlace(segment, place));
  return occurrences.length > 0 && occurrences.every((segment) => isStreetName(segment, place));
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
  const segments = addressSegments(input.rawText, input.municipality, input.locality);
  const named = (place: string) => hasPlace(combined, place);
  const streetsNamedAfterPlaces = [...LOCALITY_NAMES.keys(), ...KNOWN_OUT_OF_SCOPE].filter(
    (place) => named(place) && onlyANearbyStreet(segments, place),
  );
  const isPlaceName = (place: string) =>
    named(place) && !streetsNamedAfterPlaces.includes(place);
  const inScopeMatches = [...LOCALITY_NAMES.keys()].filter(isPlaceName);
  const outOfScopeMatches = KNOWN_OUT_OF_SCOPE.filter(isPlaceName);
  const reasons: string[] = [];

  if (streetsNamedAfterPlaces.length > 0) {
    reasons.push(`street_named_after_place:${streetsNamedAfterPlaces.join(",")}`);
  }

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
