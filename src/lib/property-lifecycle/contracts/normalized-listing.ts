import { createHash } from "node:crypto";

import { z } from "zod";

export const CONTRACT_VERSION = 1 as const;

export const adapterHealthStateSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "FAILED",
  "STRUCTURE_CHANGED",
]);

export const geographyScopeSchema = z.enum([
  "IN_SCOPE",
  "OUT_OF_SCOPE",
  "REVIEW",
]);

export const locationPrecisionSchema = z.enum([
  "EXACT_ADDRESS",
  "EXACT_COORDINATES",
  "STREET_ONLY",
  "APPROXIMATE_AREA",
  "UNKNOWN",
]);

export const sourceStatusSchema = z.enum([
  "ACTIVE",
  "NEGOTIATION",
  "SOLD",
  "REMOVED",
  "UNKNOWN",
]);

const nullableText = z.string().trim().min(1).nullable();
const nullableNonNegativeNumber = z.number().nonnegative().finite().nullable();
const confidenceSchema = z.number().min(0).max(1);

export const evidenceClaimSchema = z.object({
  kind: z.string().trim().min(1),
  claimKey: z.string().trim().min(1),
  sourceUrl: z.url(),
  extractionMethod: z.string().trim().min(1),
  rawValue: nullableText,
  normalizedValue: z.unknown().nullable(),
  confidence: confidenceSchema,
  observedAt: z.iso.datetime(),
  sourceRecordedAt: z.iso.datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const normalizedLocationSchema = z.object({
  rawText: nullableText,
  municipality: nullableText,
  locality: nullableText,
  postalCode: nullableText,
  streetName: nullableText,
  streetNumber: nullableText,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  precision: locationPrecisionSchema,
  scope: geographyScopeSchema,
  resolutionMethod: z.string().trim().min(1),
  resolutionConfidence: confidenceSchema,
  reasons: z.array(z.string().trim().min(1)),
});

export const normalizedAssetSchema = z.object({
  kind: z.enum(["IMAGE", "FLOORPLAN"]),
  url: z.url(),
  canonicalUrl: z.url(),
  sourceRecordedAt: z.iso.datetime().nullable(),
  dateEvidenceMethod: nullableText,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const marketStartEstimateSchema = z
  .object({
    lowerBound: z.iso.datetime().nullable(),
    upperBound: z.iso.datetime().nullable(),
    method: z.string().trim().min(1),
    confidence: confidenceSchema,
    evidence: z.array(evidenceClaimSchema),
  })
  .refine(
    ({ lowerBound, upperBound }) =>
      !lowerBound || !upperBound || Date.parse(lowerBound) <= Date.parse(upperBound),
    { message: "Market start lowerBound must not be after upperBound." },
  );

export const normalizedListingV2Schema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  adapterKey: z.string().trim().min(1),
  source: z.object({
    agencySlug: z.string().trim().min(1),
    sourceKey: z.string().trim().min(1),
    externalId: z.string().trim().min(1),
    canonicalUrl: z.url(),
    agencyReference: nullableText,
    transactionType: z.enum(["SALE", "RENT", "OTHER", "UNKNOWN"]),
  }),
  commercial: z.object({
    title: z.string().trim().min(1),
    description: nullableText,
    propertyType: nullableText,
    priceAmount: z.number().int().nonnegative().nullable(),
    priceCurrency: z.string().length(3).nullable(),
    surfaceSqm: nullableNonNegativeNumber,
    rooms: nullableNonNegativeNumber,
    bedrooms: nullableNonNegativeNumber,
    bathrooms: nullableNonNegativeNumber,
    floor: nullableText,
    features: z.record(z.string(), z.unknown()),
  }),
  location: normalizedLocationSchema,
  status: z.object({
    value: sourceStatusSchema,
    sourceLabel: nullableText,
    confidence: confidenceSchema,
    evidence: z.array(evidenceClaimSchema),
  }),
  assets: z.array(normalizedAssetSchema),
  marketStart: marketStartEstimateSchema,
  observedAt: z.iso.datetime(),
  response: z.object({
    url: z.url(),
    status: z.number().int().min(100).max(599).nullable(),
    etag: nullableText,
    lastModified: nullableText,
  }),
  extractionWarnings: z.array(z.string().trim().min(1)),
  provenance: z.record(z.string(), z.unknown()),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type AdapterHealthState = z.infer<typeof adapterHealthStateSchema>;
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;
export type GeographyScope = z.infer<typeof geographyScopeSchema>;
export type NormalizedAsset = z.infer<typeof normalizedAssetSchema>;
export type NormalizedListingV2 = z.infer<typeof normalizedListingV2Schema>;
export type NormalizedLocation = z.infer<typeof normalizedLocationSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export type ListingWithoutHash = Omit<NormalizedListingV2, "contentHash">;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
    );
  }

  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function finalizeNormalizedListing(input: ListingWithoutHash): NormalizedListingV2 {
  const hashInput = {
    ...input,
    observedAt: undefined,
    response: {
      ...input.response,
      etag: undefined,
      lastModified: undefined,
    },
    status: {
      ...input.status,
      evidence: input.status.evidence.map((claim) => ({
        ...claim,
        observedAt: undefined,
      })),
    },
    marketStart: {
      ...input.marketStart,
      lowerBound:
        input.marketStart.method === "CRAWLER_FIRST_SEEN"
          ? undefined
          : input.marketStart.lowerBound,
      upperBound:
        input.marketStart.method === "CRAWLER_FIRST_SEEN"
          ? undefined
          : input.marketStart.upperBound,
      evidence: input.marketStart.evidence.map((claim) => ({
        ...claim,
        observedAt: undefined,
        rawValue:
          claim.extractionMethod === "CRAWLER_FIRST_SEEN" ? undefined : claim.rawValue,
        normalizedValue:
          claim.extractionMethod === "CRAWLER_FIRST_SEEN"
            ? undefined
            : claim.normalizedValue,
      })),
    },
  };

  return normalizedListingV2Schema.parse({
    ...input,
    contentHash: hashValue(hashInput),
  });
}

export function rehashNormalizedListing(
  listing: NormalizedListingV2,
  transform: (input: ListingWithoutHash) => ListingWithoutHash,
): NormalizedListingV2 {
  const { contentHash, ...input } = listing;
  if (!contentHash) {
    throw new Error("Cannot rehash a listing without its prior content hash.");
  }
  return finalizeNormalizedListing(transform(input));
}
