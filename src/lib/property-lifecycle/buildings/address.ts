import type { NormalizedLocation } from "@/lib/property-lifecycle/contracts/normalized-listing";

export interface CanonicalBuildingAddress {
  normalizedKey: string;
  displayName: string;
  municipality: "Bitonto";
  locality: "Bitonto" | "Palombaio" | "Mariotto";
  streetName: string;
  streetNumber: string;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/\b(?:n|nro|numero|civico)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalCivic(value: string): string | null {
  const folded = fold(value).replace(/\s+/g, "");
  const match = folded.match(/^0*(\d+)([a-z]{0,2})$/);
  if (!match?.[1]) {
    return null;
  }
  return String(Number(match[1])) + (match[2] ?? "");
}

function canonicalLocality(value: string | null): CanonicalBuildingAddress["locality"] {
  const normalized = fold(value ?? "");
  if (normalized === "palombaio") {
    return "Palombaio";
  }
  if (normalized === "mariotto") {
    return "Mariotto";
  }
  return "Bitonto";
}

export function canonicalBuildingAddress(
  location: Pick<
    NormalizedLocation,
    | "scope"
    | "precision"
    | "municipality"
    | "locality"
    | "streetName"
    | "streetNumber"
  >,
): CanonicalBuildingAddress | null {
  if (
    location.scope !== "IN_SCOPE" ||
    location.precision !== "EXACT_ADDRESS" ||
    fold(location.municipality ?? "") !== "bitonto" ||
    !location.streetName ||
    !location.streetNumber
  ) {
    return null;
  }
  const normalizedStreet = fold(location.streetName);
  const normalizedCivic = canonicalCivic(location.streetNumber);
  if (!normalizedStreet || !normalizedCivic) {
    return null;
  }
  const locality = canonicalLocality(location.locality);
  const streetName = location.streetName.trim().replace(/\s+/g, " ");
  return {
    normalizedKey: [
      "it",
      "ba",
      "bitonto",
      fold(locality),
      normalizedStreet,
      normalizedCivic,
    ].join("|"),
    displayName:
      streetName +
      " " +
      normalizedCivic +
      (locality === "Bitonto" ? ", Bitonto" : ", " + locality + " (Bitonto)"),
    municipality: "Bitonto",
    locality,
    streetName,
    streetNumber: normalizedCivic,
  };
}

export function splitCivicNumbers(value: string | null | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return [
    ...new Set(
      [
        ...value
          .replace(/(\d)\s*\/\s*([a-z])\b/gi, "$1$2")
          .matchAll(/\d+\s*[a-z]{0,2}/gi),
      ]
        .map((match) => canonicalCivic(match[0]))
        .filter((civic): civic is string => Boolean(civic)),
    ),
  ];
}
