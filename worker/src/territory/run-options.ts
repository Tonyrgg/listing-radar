import { z } from "zod";
import type { SourceProperty } from "../import-v2/model.js";
import { propertyActivityDefinition } from "../services/property-activities.js";

const floor = z.number().int().min(-10).max(100).nullable().default(null);
const civic = z.number().int().min(0).max(999999).nullable().default(null);
export const runSettingsSchema = z.object({
  filters: z.object({
    residentialOnly: z.boolean().default(false),
    floorMode: z.enum(["any", "exact", "minimum", "maximum"]).default("any"),
    floorValue: floor,
    minCivicNumber: civic,
    maxCivicNumber: civic,
  }).strict().default({ residentialOnly: false, floorMode: "any", floorValue: null, minCivicNumber: null, maxCivicNumber: null }),
  includeCoOwners: z.boolean().default(true),
  importPolicy: z.enum(["create_update", "existing_only"]).default("create_update"),
  activityMode: z.enum(["none", "plain"]).default("none"),
}).strict().superRefine((value, ctx) => {
  const f = value.filters;
  if (f.floorMode !== "any" && f.floorValue === null) ctx.addIssue({ code: "custom", path: ["filters", "floorValue"], message: "Indica il piano per applicare il filtro" });
  if (f.minCivicNumber !== null && f.maxCivicNumber !== null && f.minCivicNumber > f.maxCivicNumber) ctx.addIssue({ code: "custom", path: ["filters", "maxCivicNumber"], message: "Il civico finale deve essere maggiore o uguale a quello iniziale" });
});
export type RunSettings = z.infer<typeof runSettingsSchema>;
export function runSettings(value: unknown = {}) { return runSettingsSchema.parse(value); }

/** Freeze effects on a copy. Acquired owners and original observations stay intact. */
export function sourceForApply(source: SourceProperty, settings: RunSettings, activityEligible = true): SourceProperty {
  const copy = structuredClone(source);
  const definition = propertyActivityDefinition([], 1, activityEligible ? settings.activityMode : "none");
  copy.activity = definition ? { enabled: true, description: definition.description, contactMode: definition.contactMode, status: definition.status }
    : { enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" };
  return copy;
}
