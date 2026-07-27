import { z } from "zod";

const nullableNumber = z.coerce.number().nonnegative().nullable().optional();
const optionalText = z.string().trim().max(3000).nullable().optional();

export const clientSchema = z.object({
  id: z.string().uuid().optional(),
  full_name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.union([z.literal(""), z.string().email()]).nullable().optional(),
  notes: optionalText,
  external_crm_id: z.string().trim().max(120).nullable().optional(),
});

export const zoneSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(100),
  description: optionalText,
  landmarks: z.array(z.string().trim()).default([]),
  aliases: z.array(z.string().trim()).default([]),
  associated_streets: z.array(z.string().trim()).default([]),
  map_area_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
});

export const propertyRequestSchema = z.object({
  id: z.string().uuid().optional(),
  client_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(180).nullable().optional(),
  contract_type: z.enum(["sale", "rent"]),
  property_types: z.array(z.string().trim()).min(1),
  municipality: z.string().trim().default("Bitonto"),
  status: z.enum(["draft","active","urgent","suspended","satisfied","cancelled","archived"]).default("draft"),
  priority: z.enum(["low","normal","high","urgent"]).default("normal"),
  budget_ideal: nullableNumber,
  budget_max: nullableNumber,
  monthly_rent_ideal: nullableNumber,
  monthly_rent_max: nullableNumber,
  internal_sqm_min: nullableNumber,
  internal_sqm_ideal: nullableNumber,
  internal_sqm_max: nullableNumber,
  rooms_min: nullableNumber,
  rooms_ideal: nullableNumber,
  rooms_max: nullableNumber,
  bedrooms_min: nullableNumber,
  bathrooms_min: nullableNumber,
  floor_min: z.coerce.number().int().nullable().optional(),
  floor_max: z.coerce.number().int().nullable().optional(),
  accepted_conditions: z.array(z.string()).default([]),
  availability_requirement: optionalText,
  available_by: optionalText,
  notes: optionalText,
  zone_preferences: z.array(z.object({
    zone_id: z.string().uuid(),
    preference_level: z.enum(["required","preferred","accepted","excluded"]),
  })).default([]),
  feature_preferences: z.array(z.object({
    feature_definition_id: z.string().uuid(),
    preference_level: z.enum(["required","preferred","indifferent","avoid"]),
    desired_value: z.unknown().optional(),
    custom_weight: z.number().nonnegative().nullable().optional(),
  })).default([]),
});

export const portfolioPropertySchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(180),
  contract_type: z.enum(["sale", "rent"]),
  property_type: z.string().trim().min(1),
  municipality: z.string().trim().default("Bitonto"),
  address: optionalText,
  internal_zone_id: z.string().uuid().nullable().optional(),
  price: nullableNumber,
  monthly_rent: nullableNumber,
  internal_sqm: nullableNumber,
  commercial_sqm: nullableNumber,
  rooms: nullableNumber,
  bedrooms: nullableNumber,
  bathrooms: nullableNumber,
  floor: z.coerce.number().int().nullable().optional(),
  building_floors: z.coerce.number().int().nullable().optional(),
  condition: optionalText,
  availability_status: optionalText,
  available_from: optionalText,
  description: optionalText,
  notes: optionalText,
  external_crm_id: optionalText,
  mandate_status: z.enum(["draft","active","suspended","expired","sold","rented","archived"]).default("active"),
  feature_values: z.array(z.object({
    feature_definition_id: z.string().uuid(),
    value: z.unknown(),
  })).default([]),
});

export const featureDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().trim().regex(/^[a-z0-9_]+$/),
  label: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(80),
  field_type: z.enum(["boolean","number","range","select","multiselect","text"]),
  applies_to: z.enum(["request","property","both"]).default("both"),
  default_weight: z.coerce.number().min(0).max(30).default(5),
  is_active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});

export const matchStatusSchema = z.enum([
  "new","to_propose","proposed","interested","visit_scheduled",
  "not_interested","excluded","negotiation","completed",
]);

