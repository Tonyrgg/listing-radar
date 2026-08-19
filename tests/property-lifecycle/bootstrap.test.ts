import { describe, expect, it, vi } from "vitest";

import type {
  AdapterHealthResult,
  InventoryItem,
  InventoryResult,
  PropertyLifecycleAdapter,
  SourceDocument,
} from "@/lib/property-lifecycle/adapters/types";
import type { AssetProcessingResult } from "@/lib/property-lifecycle/assets/pipeline";
import {
  runBootstrapDryRun,
  type BootstrapExistingProperty,
  type BootstrapExistingState,
} from "@/lib/property-lifecycle/bootstrap/dry-run";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type GeographyScope,
  type NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";

const OBSERVED_AT = "2026-08-19T09:00:00.000Z";
const PERCEPTUAL_HASH = "01".repeat(32);

function listing(input: {
  adapterKey: string;
  agencySlug: string;
  sourceKey: string;
  street?: string;
  scope?: GeographyScope;
}): NormalizedListingV2 {
  const canonicalUrl =
    "https://source.example/" + input.agencySlug + "/" + input.sourceKey;
  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: input.adapterKey,
    source: {
      agencySlug: input.agencySlug,
      sourceKey: input.sourceKey,
      externalId: input.sourceKey,
      canonicalUrl,
      agencyReference: null,
      transactionType: "SALE",
    },
    commercial: {
      title: "Appartamento a Bitonto",
      description: null,
      propertyType: "Appartamento",
      priceAmount: 150_000,
      priceCurrency: "EUR",
      surfaceSqm: 100,
      rooms: 4,
      bedrooms: null,
      bathrooms: 2,
      floor: "2",
      features: {},
    },
    location: {
      rawText: (input.street ?? "Via Mazzini 10") + ", Bitonto",
      municipality: input.scope === "OUT_OF_SCOPE" ? "Bari" : "Bitonto",
      locality: "Bitonto",
      postalCode: null,
      streetName: input.street ?? "Via Mazzini 10",
      streetNumber: "10",
      latitude: null,
      longitude: null,
      precision: "EXACT_ADDRESS",
      scope: input.scope ?? "IN_SCOPE",
      resolutionMethod: "FIXTURE",
      resolutionConfidence: 1,
      reasons: ["fixture"],
    },
    status: { value: "ACTIVE", sourceLabel: "Disponibile", confidence: 1, evidence: [] },
    assets: [
      {
        kind: "IMAGE",
        url: canonicalUrl + "/front.jpg",
        canonicalUrl: canonicalUrl + "/front.jpg",
        sourceRecordedAt: null,
        dateEvidenceMethod: null,
        metadata: {},
      },
    ],
    marketStart: {
      lowerBound: null,
      upperBound: OBSERVED_AT,
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.25,
      evidence: [],
    },
    observedAt: OBSERVED_AT,
    response: {
      url: canonicalUrl,
      status: 200,
      etag: null,
      lastModified: null,
    },
    extractionWarnings: [],
    provenance: {},
  });
}

class FixtureAdapter implements PropertyLifecycleAdapter {
  readonly inventoryUrl: string;

  constructor(
    readonly key: string,
    readonly agencySlug: string,
    private readonly listings: NormalizedListingV2[],
    private readonly healthState: InventoryResult["healthState"] = "HEALTHY",
    private readonly complete = true,
  ) {
    this.inventoryUrl = "https://source.example/" + agencySlug;
  }

  async fetchInventory(): Promise<InventoryResult> {
    const items = this.listings.map((value) => ({
      sourceKey: value.source.sourceKey,
      externalId: value.source.externalId,
      url: value.source.canonicalUrl,
      summary: {},
    }));
    const diagnostics = {
      expectedCount: items.length,
      observedCount: items.length,
      duplicateCount: 0,
      parseErrorCount: 0,
      pagesVisited: this.complete ? 1 : 0,
      expectedPages: 1,
      requiredMarkers: { fixture: this.complete },
      reasons: this.complete ? [] : ["fixture_incomplete"],
    };
    return {
      items,
      healthState: this.healthState,
      complete: this.complete,
      structureFingerprint: "fixture",
      diagnostics,
      response: null,
    };
  }

  async healthCheck(): Promise<AdapterHealthResult> {
    const inventory = await this.fetchInventory();
    return {
      state: inventory.healthState,
      complete: inventory.complete,
      structureFingerprint: inventory.structureFingerprint,
      diagnostics: inventory.diagnostics,
    };
  }

  async fetchDetail(item: InventoryItem): Promise<SourceDocument> {
    return {
      item,
      observedAt: OBSERVED_AT,
      response: {
        body: "",
        headers: new Headers(),
        ok: true,
        status: 200,
        url: item.url,
      },
    };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    const result = this.listings.find(
      (value) => value.source.sourceKey === document.item.sourceKey,
    );
    if (!result) {
      throw new Error("Missing fixture listing.");
    }
    return result;
  }
}

function processedAssets(): AssetProcessingResult {
  return {
    warnings: [],
    assets: [
      {
        canonicalUrl: "https://media.example/front.jpg",
        position: 0,
        classification: "IMAGE",
        sha256: "a".repeat(64),
        perceptualHash: PERCEPTUAL_HASH,
        width: 1200,
        height: 800,
        format: "jpeg",
        etag: null,
        lastModified: null,
        contentType: "image/jpeg",
        sourceRecordedAt: null,
        exif: null,
        representativeThumbnail: null,
      },
    ],
  };
}

function existingProperty(propertyId: string): BootstrapExistingProperty {
  return {
    propertyId,
    agencySlugs: ["existing-agency"],
    agencyReferences: {},
    address: "Via Mazzini 10",
    locality: "Bitonto",
    propertyType: "Appartamento",
    surfaceSqm: 100,
    rooms: 4,
    imageFingerprints: ["DHASH64:" + PERCEPTUAL_HASH],
    floorplanFingerprints: [],
  };
}

describe("Property Lifecycle bootstrap dry run", () => {
  it("predicts a cross-agency match in memory without mutating seed state", async () => {
    const state: BootstrapExistingState = { properties: [], publicationKeys: [] };
    const originalState = structuredClone(state);
    const report = await runBootstrapDryRun({
      adapters: [
        new FixtureAdapter("alpha", "alpha-agency", [
          listing({
            adapterKey: "alpha",
            agencySlug: "alpha-agency",
            sourceKey: "a-1",
          }),
          listing({
            adapterKey: "alpha",
            agencySlug: "alpha-agency",
            sourceKey: "a-out",
            scope: "OUT_OF_SCOPE",
          }),
        ]),
        new FixtureAdapter("beta", "beta-agency", [
          listing({
            adapterKey: "beta",
            agencySlug: "beta-agency",
            sourceKey: "b-1",
          }),
        ]),
      ],
      existingState: state,
      generatedAt: OBSERVED_AT,
      assetProcessor: async () => processedAssets(),
    });

    expect(state).toEqual(originalState);
    expect(report.nonMutating).toBe(true);
    expect(report.totals).toMatchObject({
      rawListings: 3,
      acceptedListings: 2,
      predictedProperties: 1,
      predictedNewProperties: 1,
      predictedPublications: 2,
      duplicateMatches: 1,
      crossAgencyMatches: 1,
      reviewRequiredCases: 0,
      sourceFailures: 0,
    });
    expect(report.agencies[0]).toMatchObject({
      acceptedListings: 1,
      excludedListings: 1,
    });
    expect(report.decisions[1]).toMatchObject({
      agencySlug: "beta-agency",
      action: "MATCH_PROPERTY",
      identityOutcome: "AUTO_MATCH",
      crossAgencyMatch: true,
      predictedPropertyId: "dry-run-property-1",
    });
  });

  it("reports ambiguous candidates for review instead of auto-merging", async () => {
    const report = await runBootstrapDryRun({
      adapters: [
        new FixtureAdapter("alpha", "alpha-agency", [
          listing({
            adapterKey: "alpha",
            agencySlug: "alpha-agency",
            sourceKey: "a-1",
          }),
        ]),
      ],
      existingState: {
        properties: [existingProperty("property-1"), existingProperty("property-2")],
        publicationKeys: [],
      },
      assetProcessor: async () => processedAssets(),
    });

    expect(report.totals).toMatchObject({
      predictedNewProperties: 1,
      reviewRequiredCases: 1,
      duplicateMatches: 0,
    });
    expect(report.decisions[0]).toMatchObject({
      action: "CREATE_REVIEW_PROPERTY",
      identityOutcome: "REVIEW_REQUIRED",
      candidateCount: 2,
    });
  });

  it("skips unhealthy sources before detail or asset work", async () => {
    const assetProcessor = vi.fn(async () => processedAssets());
    const report = await runBootstrapDryRun({
      adapters: [
        new FixtureAdapter(
          "alpha",
          "alpha-agency",
          [
            listing({
              adapterKey: "alpha",
              agencySlug: "alpha-agency",
              sourceKey: "a-1",
            }),
          ],
          "STRUCTURE_CHANGED",
          false,
        ),
      ],
      assetProcessor,
    });

    expect(assetProcessor).not.toHaveBeenCalled();
    expect(report.totals).toMatchObject({
      rawListings: 1,
      acceptedListings: 0,
      predictedPublications: 0,
      sourceFailures: 1,
    });
    expect(report.sourceFailures[0]?.reasons).toContain("inventory_incomplete");
  });

  it("recognizes publications already present in V2 without fingerprint downloads", async () => {
    const assetProcessor = vi.fn(async () => processedAssets());
    const report = await runBootstrapDryRun({
      adapters: [
        new FixtureAdapter("alpha", "alpha-agency", [
          listing({
            adapterKey: "alpha",
            agencySlug: "alpha-agency",
            sourceKey: "a-1",
          }),
        ]),
      ],
      existingState: {
        properties: [],
        publicationKeys: ["alpha-agency\u0000a-1"],
      },
      assetProcessor,
    });

    expect(assetProcessor).not.toHaveBeenCalled();
    expect(report.totals).toMatchObject({
      existingPublications: 1,
      duplicateMatches: 1,
      predictedPublications: 0,
      predictedProperties: 0,
    });
    expect(report.decisions[0]?.action).toBe("EXISTING_PUBLICATION");
  });
});
