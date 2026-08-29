import { describe, expect, it } from "vitest";

import type {
  AdapterHealthResult,
  InventoryItem,
  InventoryResult,
  PropertyLifecycleAdapter,
  SourceDocument,
} from "@/lib/property-lifecycle/adapters/types";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type GeographyScope,
  type NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import type { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { runAgencySync } from "@/lib/property-lifecycle/sync/engine";

/**
 * Il caso di posizione, dall'apertura alla risposta.
 *
 * Un annuncio di cui non sappiamo dire il comune resta fuori dall'archivio e
 * apre un caso da decidere: è voluto. Quello che non era voluto è che il caso
 * tornasse aperto a ogni sincronia, e che una volta risposto la risposta non
 * cambiasse nulla — la coda restava ferma a ventitré per giorni.
 */

const OBSERVED_AT = "2026-08-29T09:00:00.000Z";

function listing(scope: GeographyScope): NormalizedListingV2 {
  const canonicalUrl = "https://source.example/agenzia/1";
  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "fixture",
    source: {
      agencySlug: "agenzia",
      sourceKey: "1",
      externalId: "1",
      canonicalUrl,
      agencyReference: null,
      transactionType: "SALE",
    },
    commercial: {
      title: "Villa zona Palese",
      description: null,
      propertyType: "Villa",
      priceAmount: 200_000,
      priceCurrency: "EUR",
      surfaceSqm: 120,
      rooms: 4,
      bedrooms: null,
      bathrooms: 1,
      floor: null,
      features: {},
    },
    location: {
      rawText: "PALESE ZONA VIALE DEL TURCO",
      municipality: null,
      locality: null,
      postalCode: "70032",
      streetName: "Viale del Turco",
      streetNumber: null,
      latitude: null,
      longitude: null,
      precision: "STREET_ONLY",
      scope,
      resolutionMethod: "STRICT_PLACE_NAME_V1",
      resolutionConfidence: 0.35,
      reasons: ["postal_code_only_requires_review"],
    },
    status: { value: "ACTIVE", sourceLabel: "Disponibile", confidence: 1, evidence: [] },
    assets: [],
    marketStart: {
      lowerBound: null,
      upperBound: OBSERVED_AT,
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.25,
      evidence: [],
    },
    observedAt: OBSERVED_AT,
    response: { url: canonicalUrl, status: 200, etag: null, lastModified: null },
    extractionWarnings: [],
    provenance: {},
  });
}

class FixtureAdapter implements PropertyLifecycleAdapter {
  readonly key = "fixture";
  readonly agencySlug = "agenzia";
  readonly inventoryUrl = "https://source.example/agenzia";

  constructor(private readonly listings: NormalizedListingV2[]) {}

  async fetchInventory(): Promise<InventoryResult> {
    const items = this.listings.map((value) => ({
      sourceKey: value.source.sourceKey,
      externalId: value.source.externalId,
      url: value.source.canonicalUrl,
      summary: {},
    }));
    return {
      items,
      healthState: "HEALTHY",
      complete: true,
      structureFingerprint: "fixture",
      diagnostics: {
        expectedCount: items.length,
        observedCount: items.length,
        duplicateCount: 0,
        parseErrorCount: 0,
        pagesVisited: 1,
        expectedPages: 1,
        requiredMarkers: { fixture: true },
        reasons: [],
      },
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
      response: { body: "", headers: new Headers(), ok: true, status: 200, url: item.url },
    };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    const found = this.listings.find(
      (value) => value.source.sourceKey === document.item.sourceKey,
    );
    if (!found) throw new Error("Missing fixture listing.");
    return found;
  }
}

function repository(decision: "IN_SCOPE" | "OUT_OF_SCOPE" | null) {
  const queued: NormalizedListingV2[] = [];
  const persisted: NormalizedListingV2[] = [];
  const closed: string[] = [];
  const fake = {
    async closeSettledGeographyReview(input: { sourceKey: string }) {
      closed.push(input.sourceKey);
    },
    async getAgencyBySlug() {
      return { id: "agenzia-id", slug: "agenzia", adapter_key: "fixture", settings: {} };
    },
    async createSyncRun() {
      return "sync-run-id";
    },
    async resolvedGeographyScope() {
      return decision;
    },
    async recordGeographyReview(input: { listing: NormalizedListingV2 }) {
      queued.push(input.listing);
    },
    async persistObservation(
      _agencyId: string,
      _syncRunId: string,
      value: NormalizedListingV2,
    ) {
      persisted.push(value);
      return { createdPublication: true };
    },
    async recordAdapterHealth() {
      return {
        effectiveState: "HEALTHY" as const,
        inventoryComplete: true,
        absenceEvaluationAllowed: false,
      };
    },
    async finalizeSyncRun() {},
  };
  return {
    queued,
    persisted,
    closed,
    repository: fake as unknown as PropertyLifecycleRepository,
  };
}

describe("geography reviews across syncs", () => {
  it("queues the case and keeps the listing out while nobody has answered", async () => {
    const { queued, persisted, repository: repo } = repository(null);

    const result = await runAgencySync({
      adapter: new FixtureAdapter([listing("REVIEW")]),
      repository: repo,
    });

    expect(queued).toHaveLength(1);
    expect(persisted).toHaveLength(0);
    expect(result.counts).toMatchObject({ excludedCount: 1, inScopeCount: 0 });
  });

  /* Rispondere «è nella zona» deve far entrare l'annuncio, non solo chiudere la
   * riga della coda: prima la decisione non arrivava fino alla sincronia e lo
   * stesso annuncio veniva riscartato. */
  it("lets a listing in once a person has placed it in the monitored area", async () => {
    const { queued, persisted, repository: repo } = repository("IN_SCOPE");

    const result = await runAgencySync({
      adapter: new FixtureAdapter([listing("REVIEW")]),
      repository: repo,
    });

    expect(queued).toHaveLength(0);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].location).toMatchObject({
      scope: "IN_SCOPE",
      municipality: "Bitonto",
      resolutionMethod: "HUMAN_DECISION_V1",
      resolutionConfidence: 1,
    });
    expect(persisted[0].location.reasons).toContain("human_geography_decision");
    expect(result.counts).toMatchObject({ inScopeCount: 1, excludedCount: 0 });
  });

  it("does not reopen a case a person has closed as out of area", async () => {
    const { queued, persisted, repository: repo } = repository("OUT_OF_SCOPE");

    await runAgencySync({
      adapter: new FixtureAdapter([listing("REVIEW")]),
      repository: repo,
    });

    expect(queued).toHaveLength(0);
    expect(persisted).toHaveLength(0);
  });

  /* Il risolutore migliora, e i casi che aveva aperto quando non capiva quegli
   * indirizzi devono chiudersi da soli: altrimenti restano in coda per sempre. */
  it("closes a standing case once the resolver can read the address on its own", async () => {
    const { queued, closed, repository: repo } = repository(null);

    await runAgencySync({
      adapter: new FixtureAdapter([listing("IN_SCOPE")]),
      repository: repo,
    });

    expect(closed).toEqual(["1"]);
    expect(queued).toHaveLength(0);
  });
});
