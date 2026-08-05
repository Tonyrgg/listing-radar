import type { PortfolioProperty } from "./types";

export function propertyConditionLabel(value: string | null) {
  return ({
    new: "Nuovo",
    renovated: "Ristrutturato",
    normal: "Normale",
    to_renovate: "Da ristrutturare",
    poor: "Scarso",
    excellent: "Ristrutturato",
    good: "Normale",
    habitable: "Normale",
  }[value ?? ""] ?? value ?? "Non indicato");
}

export function propertyCrmCondition(property: PortfolioProperty, field: "Stato Interno" | "Stato Esterno") {
  const raw = property.raw_payload;
  if (!raw || typeof raw !== "object") return null;
  const fields = raw.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const value = (fields as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
