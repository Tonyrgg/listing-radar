import { load, type CheerioAPI } from "cheerio";

import { HttpClient, type HttpResponse } from "@/lib/http/client";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type NormalizedAsset,
  type NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import type {
  AdapterHealthResult,
  InventoryItem,
  InventoryResult,
  PropertyLifecycleAdapter,
  SourceDocument,
} from "@/lib/property-lifecycle/adapters/types";
import {
  canonicalUrl,
  classifyInventoryHealth,
  cleanText,
  createEvidence,
  deduplicateInventoryItems,
  parseInteger,
  parseItalianNumber,
  structureFingerprint,
} from "@/lib/property-lifecycle/adapters/shared";

export const TROVACASA_BASE_URL = "https://www.trovacasa.it";

export interface TrovaCasaAgencyProfile {
  adapterKey: string;
  agencySlug: string;
  agencyDisplayName: string;
  agencyId: string;
  agencyPath: string;
  inventoryUrl: string;
}

export interface TrovaCasaInventoryPage extends InventoryResult {
  nextUrl: string | null;
  reportedTotal: number | null;
  rawRecordCount: number;
}

function externalId(urlValue: string, profile: TrovaCasaAgencyProfile): string | null {
  try {
    const url = new URL(urlValue, TROVACASA_BASE_URL);
    const pattern = new RegExp(
      `^/annunci/(?:[a-z]{2}-)?tc-${profile.agencyId}-(\\d+)/?$`,
      "i",
    );
    return url.pathname.match(pattern)?.[1] ?? null;
  } catch {
    return null;
  }
}

function galleryImageIds(
  value: string | null | undefined,
  listingId: string,
  agencyId: string,
): string[] {
  const ids: string[] = [];
  const pattern = new RegExp(`^X_${agencyId}_(\\d+)_(\\d+)$`);
  for (const token of value?.split("|") ?? []) {
    const match = token.match(pattern);
    if (match?.[1] === listingId && match[2]) {
      ids.push(match[2]);
    }
  }
  return [...new Set(ids)];
}

export function parseTrovaCasaInventoryHtml(
  html: string,
  profile: TrovaCasaAgencyProfile,
  response: HttpResponse | null = null,
): TrovaCasaInventoryPage {
  const $ = load(html);
  const cards = $(".agenziaAnnunci__card .card").toArray();
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;

  for (const card of cards) {
    const container = $(card);
    const anchor = container.find("a.card__title[href^='/annunci/']").first();
    const href = anchor.attr("href");
    const listingId = href ? externalId(href, profile) : null;
    if (!href || !listingId) {
      parseErrorCount += 1;
      continue;
    }
    const galleryToken = container.find("[data-src-list]").first().attr("data-src-list");
    const imageIds = galleryImageIds(galleryToken, listingId, profile.agencyId);
    const galleryTokenCount = galleryToken?.split("|").filter(Boolean).length ?? 0;
    if (galleryToken && (imageIds.length === 0 || imageIds.length !== galleryTokenCount)) {
      parseErrorCount += 1;
      continue;
    }

    const info = container
      .find(".card__info")
      .toArray()
      .map((element) => cleanText($(element).text()));
    extracted.push({
      sourceKey: listingId,
      externalId: listingId,
      url: canonicalUrl(href, TROVACASA_BASE_URL),
      summary: {
        title: cleanText(anchor.text()),
        priceAmount: parseInteger(container.find(".card__price").first().text()),
        surfaceSqm: parseItalianNumber(info.find((value) => /m[²2]/i.test(value ?? ""))),
        rooms: parseItalianNumber(info.find((value) => /local/i.test(value ?? ""))),
        descriptionExcerpt: cleanText(container.find(".card__description").first().text()),
        tags: container
          .find(".annuncioTag")
          .toArray()
          .map((element) => cleanText($(element).text()))
          .filter((value): value is string => !!value),
        inventoryImageIds: imageIds,
        portalPublisherId: Number(profile.agencyId),
      },
    });
  }

  const deduplicated = deduplicateInventoryItems(extracted);
  const reportedTotal = parseInteger(
    cleanText($("title").text())?.match(/:\s*(\d+)\s+case\s+in\s+vendita/i)?.[1] ??
      cleanText($("h2").first().text())?.match(/(\d+)\s+case\s+in\s+vendita/i)?.[1],
  );
  const nextHref =
    $("link[rel='next']").attr("href") ??
    $(".pagination a[rel='next'], .pagination a.next").first().attr("href");
  let nextUrl: string | null = null;
  if (nextHref) {
    try {
      nextUrl = canonicalUrl(nextHref, TROVACASA_BASE_URL);
    } catch {
      parseErrorCount += 1;
    }
  }
  const agencyLinks = $(`a[href^='${profile.agencyPath}']`).length;
  const requiredMarkers = {
    agencyIdentity:
      agencyLinks > 0 &&
      html.toLocaleLowerCase("it").includes(profile.agencyDisplayName.toLocaleLowerCase("it")),
    dedicatedSalePage: /case-in-vendita/i.test(response?.url ?? profile.inventoryUrl),
    reportedTotal: reportedTotal != null && reportedTotal > 0,
    listingCards: cards.length > 0 && deduplicated.items.length > 0,
    recordContract: extracted.length + parseErrorCount === cards.length,
    paginationDiscoverable:
      reportedTotal != null && (deduplicated.items.length >= reportedTotal || nextUrl != null),
  };
  const diagnostics = {
    expectedCount: reportedTotal,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: Object.values(requiredMarkers).every(Boolean) ? 1 : 0,
    expectedPages: nextUrl ? 2 : 1,
    requiredMarkers,
    reasons: [],
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(requiredMarkers),
    diagnostics,
    response,
    nextUrl,
    reportedTotal,
    rawRecordCount: cards.length,
  };
}

function detailRows($: CheerioAPI): Map<string, string> {
  const rows = new Map<string, string>();
  $(".immobileDetails__table .row").each((_, element) => {
    const label = cleanText($(element).find("dt.term").first().text())?.replace(/:$/, "");
    const value = cleanText($(element).find("dd.description").first().text());
    if (label && value) {
      rows.set(label.toLocaleLowerCase("it"), value);
    }
  });
  return rows;
}

function rowValue(rows: Map<string, string>, label: string): string | null {
  return rows.get(label.toLocaleLowerCase("it")) ?? null;
}

function stripPublisherContacts(value: string | null | undefined): string | null {
  return (
    cleanText(value)
      ?.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact removed]")
      .replace(/https?:\/\/\S+/gi, "[link removed]")
      .replace(/\b(?:\+39\s*)?(?:0\d{1,3}|3\d{2})(?:[\s.-]*\d){6,9}\b/g, "[contact removed]") ??
    null
  );
}

function assets(
  $: CheerioAPI,
  listingId: string,
  profile: TrovaCasaAgencyProfile,
): NormalizedAsset[] {
  const gallery = $(".immobile__imagesBox a[href='#gallery'][data-src-list]")
    .first()
    .attr("data-src-list");
  return galleryImageIds(gallery, listingId, profile.agencyId)
    .slice(0, 60)
    .map((imageId) => {
      const url = `https://pic.trovacasa.it/image/${imageId}/m-c.jpg`;
      return {
        kind: "IMAGE" as const,
        url,
        canonicalUrl: url,
        sourceRecordedAt: null,
        dateEvidenceMethod: null,
        metadata: {
          portalGalleryAsset: true,
          portalResizedAsset: true,
          lastModifiedEligibleForMarketStart: true,
          sourceImageId: imageId,
          limitation: "no original asset or deterministic floorplan role is exposed",
        },
      };
    });
}

export function normalizeTrovaCasaDetail(
  document: SourceDocument,
  profile: TrovaCasaAgencyProfile,
): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const canonical = canonicalUrl(document.item.url, TROVACASA_BASE_URL);
  const listingId = externalId(canonical, profile);
  if (!listingId || listingId !== document.item.externalId) {
    throw new Error(`${profile.agencyDisplayName} detail ${canonical} identity does not match inventory.`);
  }
  const agencyHref = $(".sideBox__agenzia a.agenzia__name, .sideBox__agenzia a")
    .first()
    .attr("href");
  if (
    !agencyHref ||
    !new URL(agencyHref, TROVACASA_BASE_URL).pathname.startsWith(profile.agencyPath)
  ) {
    throw new Error(`${profile.agencyDisplayName} detail ${canonical} has an unexpected publisher identity.`);
  }

  const rows = detailRows($);
  if (rowValue(rows, "Codice annuncio") !== `TC${listingId}`) {
    throw new Error(`${profile.agencyDisplayName} detail ${canonical} has an unexpected source code.`);
  }
  if (!/^vendita$/i.test(rowValue(rows, "Contratto") ?? "")) {
    throw new Error(`${profile.agencyDisplayName} detail ${canonical} is not a sale publication.`);
  }
  const title = cleanText($("h1.immobile__title").first().text());
  if (!title) {
    throw new Error(`${profile.agencyDisplayName} detail ${canonical} has no title.`);
  }

  const municipality = rowValue(rows, "Comune");
  const address = rowValue(rows, "Indirizzo");
  const geographyAddress = address?.replace(/\b(\d+)\s+([a-z])$/i, "$1$2") ?? null;
  const galleryAssets = assets($, listingId, profile);
  const upstreamPortalReference = rowValue(rows, "Riferimento");
  const firstObservedEvidence = createEvidence({
    kind: "MARKET_START_BOUND",
    claimKey: "publication.firstObservedInInventoryAt",
    sourceUrl: canonical,
    extractionMethod: "CRAWLER_FIRST_SEEN",
    rawValue: document.observedAt,
    normalizedValue: { lowerBound: null, upperBound: document.observedAt },
    confidence: 0.25,
    observedAt: document.observedAt,
    sourceRecordedAt: null,
    metadata: { limitation: "portal exposes no reliable public creation timestamp" },
  });

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: profile.adapterKey,
    source: {
      agencySlug: profile.agencySlug,
      sourceKey: document.item.sourceKey,
      externalId: listingId,
      canonicalUrl: canonical,
      agencyReference: null,
      transactionType: "SALE",
    },
    commercial: {
      title,
      description: stripPublisherContacts(
        $(".immobileDetails__text.js_fit_descr, .immobileDetails__text").first().text(),
      ),
      propertyType: rowValue(rows, "Tipologia"),
      priceAmount: parseInteger(rowValue(rows, "Prezzo")),
      priceCurrency: "EUR",
      surfaceSqm: parseItalianNumber(rowValue(rows, "Superficie")),
      rooms: parseItalianNumber(rowValue(rows, "Numero locali")),
      bedrooms: parseItalianNumber(rowValue(rows, "Numero camere")),
      bathrooms: parseItalianNumber(rowValue(rows, "Numero bagni")),
      floor: rowValue(rows, "Piano"),
      features: {
        energyClass: rowValue(rows, "Classe energetica"),
        tags: $(".immobileDetails__tagLabel")
          .toArray()
          .map((element) => cleanText($(element).text()))
          .filter((value): value is string => !!value),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [geographyAddress, municipality].filter(Boolean).join(", "),
      municipality,
      coordinatesExact: false,
    }),
    status: { value: "UNKNOWN", sourceLabel: null, confidence: 0.25, evidence: [] },
    assets: galleryAssets,
    marketStart: {
      lowerBound: null,
      upperBound: document.observedAt,
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.25,
      evidence: [firstObservedEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: responseUrl,
      status: responseStatus,
      etag: cleanText(headers.get("etag")),
      lastModified: cleanText(headers.get("last-modified")),
    },
    extractionWarnings: [
      "portal_source_not_full_agency_mandate_inventory",
      "missing_dedicated_source_status",
      "source_publication_date_unavailable",
      ...(galleryAssets.length === 0 ? ["missing_scoped_portal_gallery"] : []),
    ],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_trovacasa_agency_sale_page",
      trovaCasaAgencyId: Number(profile.agencyId),
      upstreamPortalReference,
      upstreamPortalReferenceNotAgencyCode: true,
      sourceCreatedAtUnavailable: true,
      pageHttpLastModifiedIgnoredForMarketStart: true,
      portalGalleryLastModifiedEligibleAsPublicEvidence: true,
      portalGalleryAssetsAreResized: true,
      publisherContactDataExcluded: true,
    },
  });
}

export class TrovaCasaPortalAdapter implements PropertyLifecycleAdapter {
  readonly key: string;
  readonly agencySlug: string;
  readonly inventoryUrl: string;
  private readonly http: HttpClient;

  constructor(
    private readonly profile: TrovaCasaAgencyProfile,
    http?: HttpClient,
  ) {
    this.key = profile.adapterKey;
    this.agencySlug = profile.agencySlug;
    this.inventoryUrl = profile.inventoryUrl;
    this.http =
      http ??
      new HttpClient({
        timeoutMs: 15_000,
        retries: 2,
        retryDelayMs: 400,
        minIntervalMs: 1_000,
        headers: {
          "user-agent": "ListingRadarLifecycle/2.0 (+local validation)",
          "accept-language": "it-IT,it;q=0.9,en;q=0.7",
        },
      });
  }

  async fetchInventory(): Promise<InventoryResult> {
    const firstResponse = await this.http.get(this.inventoryUrl);
    if (!firstResponse.ok) {
      const requiredMarkers = { successfulResponse: false };
      const diagnostics = {
        expectedCount: null,
        observedCount: 0,
        duplicateCount: 0,
        parseErrorCount: 1,
        pagesVisited: 0,
        expectedPages: 1,
        requiredMarkers,
        reasons: [`http_status:${firstResponse.status}`],
      };
      return {
        items: [],
        healthState: "FAILED",
        complete: false,
        structureFingerprint: structureFingerprint(requiredMarkers),
        diagnostics,
        response: firstResponse,
      };
    }

    const firstPage = parseTrovaCasaInventoryHtml(
      firstResponse.body,
      this.profile,
      firstResponse,
    );
    const allItems = [...firstPage.items];
    const reasons = [...firstPage.diagnostics.reasons];
    const visitedUrls = new Set([canonicalUrl(firstResponse.url, TROVACASA_BASE_URL)]);
    let nextUrl = firstPage.nextUrl;
    let pagesVisited = firstPage.diagnostics.pagesVisited;
    let rawRecordCount = firstPage.rawRecordCount;
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let perPageDuplicateCount = firstPage.diagnostics.duplicateCount;
    let allPagesStructured = Object.entries(firstPage.diagnostics.requiredMarkers)
      .filter(([name]) => name !== "paginationDiscoverable")
      .every(([, present]) => present);
    let totalsConsistent = true;

    while (nextUrl && visitedUrls.size < 100) {
      if (visitedUrls.has(nextUrl)) {
        reasons.push(`pagination_loop:${nextUrl}`);
        allPagesStructured = false;
        break;
      }
      visitedUrls.add(nextUrl);
      const pageResponse = await this.http.get(nextUrl);
      if (!pageResponse.ok) {
        reasons.push(`pagination_http_status:${pageResponse.status}:${nextUrl}`);
        parseErrorCount += 1;
        allPagesStructured = false;
        break;
      }
      const page = parseTrovaCasaInventoryHtml(pageResponse.body, this.profile, pageResponse);
      const structured = Object.entries(page.diagnostics.requiredMarkers)
        .filter(([name]) => name !== "paginationDiscoverable")
        .every(([, present]) => present);
      allPagesStructured &&= structured;
      totalsConsistent &&= page.reportedTotal === firstPage.reportedTotal;
      if (structured) {
        pagesVisited += 1;
      }
      allItems.push(...page.items);
      rawRecordCount += page.rawRecordCount;
      parseErrorCount += page.diagnostics.parseErrorCount;
      perPageDuplicateCount += page.diagnostics.duplicateCount;
      nextUrl = page.nextUrl;
    }

    const deduplicated = deduplicateInventoryItems(allItems);
    const requiredMarkers = {
      ...firstPage.diagnostics.requiredMarkers,
      paginationDiscoverable: true,
      allPagesStructured,
      paginationTerminated: nextUrl == null,
      totalsConsistent,
      rawCountReconciled:
        firstPage.reportedTotal != null && rawRecordCount === firstPage.reportedTotal,
    };
    const diagnostics = {
      expectedCount: firstPage.reportedTotal,
      observedCount: deduplicated.items.length,
      duplicateCount: perPageDuplicateCount + deduplicated.duplicateCount,
      parseErrorCount,
      pagesVisited,
      expectedPages: visitedUrls.size,
      requiredMarkers,
      reasons,
    };
    const health = classifyInventoryHealth(diagnostics);

    return {
      items: deduplicated.items,
      healthState: health.state,
      complete: health.complete,
      structureFingerprint: structureFingerprint(requiredMarkers),
      diagnostics,
      response: firstResponse,
    };
  }

  async healthCheck(): Promise<AdapterHealthResult> {
    const result = await this.fetchInventory();
    return {
      state: result.healthState,
      complete: result.complete,
      structureFingerprint: result.structureFingerprint,
      diagnostics: result.diagnostics,
    };
  }

  async fetchDetail(item: InventoryItem): Promise<SourceDocument> {
    const response = await this.http.get(item.url);
    if (!response.ok) {
      throw new Error(`${this.profile.agencyDisplayName} detail ${item.url} returned HTTP ${response.status}.`);
    }
    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeTrovaCasaDetail(document, this.profile);
  }
}
