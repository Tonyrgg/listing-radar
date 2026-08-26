import { extractFirstCivicNumber, formatPersonName, hasNoCivicNumber, splitStreetAndFirstCivic } from "./normalize.js";
import type { NormalizedProperty } from "../types.js";

export type PropertyFloorChoice = "Alto" | "Medio" | "Basso" | "Terra" | "Seminterrato" | "Su più livelli";

export interface PropertyFormValues {
  type: "Appartamenti" | "Box / posti auto";
  subtype: "Monolocale" | "2 locali" | "3 locali" | "4 locali" | "5 locali" | "6 locali" | "Multilocale" | "Box" | "Posto auto";
  floor: PropertyFloorChoice | null;
  floorNumber: string;
  street: string;
  civicNumber: string;
  internal: string;
  staircase: string;
  municipality: string;
  commercialSquareMeters: number | null;
}

function normalizedCategory(value: string) {
  return value.toUpperCase().replace(/\s+/g, "").replace(/^([AC])(\d)/, "$1/$2");
}

function numericConsistency(value: string | null) {
  const match = value?.replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function apartmentSubtype(consistency: string | null): PropertyFormValues["subtype"] {
  const rooms = numericConsistency(consistency);
  if (rooms === null || rooms <= 3) return "Monolocale";
  const locals = Math.ceil(rooms - 2);
  if (locals >= 7) return "Multilocale";
  return `${Math.max(2, locals)} locali` as PropertyFormValues["subtype"];
}

function addressDetail(value: string | null, name: "INTERNO" | "SCALA") {
  return value?.match(new RegExp(`\\b${name}\\s+([A-Z0-9/]+)`, "i"))?.[1]?.toUpperCase() ?? null;
}

function floorValues(address: string | null): Pick<PropertyFormValues, "floor" | "floorNumber"> {
  const token = address?.match(/\bPIANO\s+((?:T|S\d+|\d+)(?:\s*-\s*(?:T|S\d+|\d+))*)/i)?.[1]?.replace(/\s+/g, "").toUpperCase();
  if (!token) return { floor: null, floorNumber: "" };
  if (token.includes("-")) return { floor: "Su più livelli", floorNumber: "" };
  if (token === "T") return { floor: "Terra", floorNumber: "" };
  if (/^S\d+$/.test(token)) return { floor: "Seminterrato", floorNumber: `-${Number(token.slice(1))}` };
  const number = Number(token);
  if (!Number.isFinite(number)) return { floor: null, floorNumber: "" };
  if (number <= 2) return { floor: "Basso", floorNumber: String(number) };
  if (number <= 4) return { floor: "Medio", floorNumber: String(number) };
  return { floor: "Alto", floorNumber: String(number) };
}

function fallbackStreetAndCivic(address: string | null) {
  const base = (address ?? "")
    .replace(/\s+(?:SCALA|INTERNO|PIANO)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = splitStreetAndFirstCivic(base);
  return { street: parsed.street || base, civicNumber: parsed.civicNumber ?? "" };
}

export function propertyFormValues(property: NormalizedProperty): PropertyFormValues {
  const category = normalizedCategory(property.category);
  const searchContext = property.rawPayload.searchContext && typeof property.rawPayload.searchContext === "object"
    ? property.rawPayload.searchContext as Record<string, unknown>
    : {};
  const fallback = fallbackStreetAndCivic(property.address);
  const withoutCivic = hasNoCivicNumber(property.address);
  const longRun = property.rawPayload.long_run === true
    || Boolean(property.rawPayload.long_run && typeof property.rawPayload.long_run === "object");
  const rawStreet = withoutCivic
    ? fallback.street
    : longRun
    ? fallback.street || (typeof searchContext.street === "string" ? searchContext.street.trim() : "")
    : typeof searchContext.street === "string" && searchContext.street.trim() ? searchContext.street.trim() : fallback.street;
  const street = formatPersonName(rawStreet);
  const civicNumber = withoutCivic
    ? "."
    : longRun
    ? extractFirstCivicNumber(property.address) ?? fallback.civicNumber
    : typeof searchContext.civicNumber === "string" && searchContext.civicNumber.trim() ? searchContext.civicNumber.trim() : fallback.civicNumber;
  const type = category.startsWith("A/") ? "Appartamenti" : "Box / posti auto";
  const subtype = type === "Appartamenti"
    ? apartmentSubtype(property.consistency)
    : category === "C/6" ? "Posto auto" : "Box";
  const sqm = /\bMQ\b/i.test(property.consistency ?? "") ? numericConsistency(property.consistency) : null;
  return {
    type,
    subtype,
    ...floorValues(property.address),
    street,
    civicNumber,
    internal: addressDetail(property.address, "INTERNO") ?? ".",
    staircase: addressDetail(property.address, "SCALA") ?? "",
    municipality: property.municipality,
    commercialSquareMeters: sqm,
  };
}
