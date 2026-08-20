import { HttpClient, type HttpResponse } from "@/lib/http/client";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type NormalizedAsset,
  type NormalizedListingV2,
  type SourceStatus,
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
  cleanAgencyReference,
  cleanText,
  createEvidence,
  deduplicateInventoryItems,
  structureFingerprint,
} from "@/lib/property-lifecycle/adapters/shared";

export const STUDIO_CASA_BASE_URL = "https://www.casa.it";
export const STUDIO_CASA_PUBLISHER_ID = 1_098_672;
export const STUDIO_CASA_INVENTORY_URL =
  `${STUDIO_CASA_BASE_URL}/srp/?pId=${STUDIO_CASA_PUBLISHER_ID}`;

type JsonObject = Record<string, unknown>;

interface StudioCasaInventoryPage extends InventoryResult {
  pageNumber: number | null;
  totalPages: number;
  reportedTotal: number | null;
  rawRecordCount: number;
  excludedNonSaleCount: number;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectValue(parent: JsonObject | null, key: string): JsonObject | null {
  const value = parent?.[key];
  return isObject(value) ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed != null && Number.isInteger(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? cleanText(value) : null;
}

function decodeCasaInitialState(html: string): JsonObject | null {
  const match = html.match(
    /window\.__INITIAL_STATE__\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/,
  );
  if (!match?.[1]) {
    return null;
  }

  try {
    const serialized = JSON.parse(match[1]) as unknown;
    if (typeof serialized !== "string") {
      return null;
    }
    const state = JSON.parse(serialized) as unknown;
    return isObject(state) ? state : null;
  } catch {
    return null;
  }
}

function decodeCasaDetail(html: string): JsonObject | null {
  const match = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) {
    return null;
  }

  try {
    const nextData = JSON.parse(match[1]) as unknown;
    if (!isObject(nextData)) {
      return null;
    }
    return objectValue(objectValue(objectValue(nextData, "props"), "pageProps"), "pdp");
  } catch {
    return null;
  }
}

function safeInventorySummary(record: JsonObject): Record<string, unknown> {
  const title = objectValue(record, "title");
  const features = objectValue(record, "features");
  const price = objectValue(features, "price");
  const marker = objectValue(price, "marker");
  const geography = objectValue(record, "geoInfos");
  const media = objectValue(record, "media");
  const mediaItems = Array.isArray(media?.items) ? media.items : [];

  return {
    casaListingId: integerValue(record.id),
    partnerId: integerValue(record.partnerId),
    portalReference: stringValue(record.refPublisher),
    channel: stringValue(record.channel),
    title: stringValue(title?.main),
    titleAdditional: Array.isArray(title?.additional)
      ? title.additional.filter((value): value is string => typeof value === "string")
      : [],
    description: stringValue(record.description),
    propertyType: stringValue(record.propertyType),
    priceAmount: integerValue(marker?.originalPrice),
    surfaceSqm: numberValue(features?.mq),
    rooms: numberValue(features?.rooms),
    bathrooms: numberValue(features?.bathrooms),
    floor: stringValue(features?.level),
    availability: stringValue(features?.availability),
    street: stringValue(geography?.street),
    municipality: stringValue(geography?.city),
    district: stringValue(geography?.block_name ?? geography?.district_name),
    latitude: numberValue(geography?.lat),
    longitude: numberValue(geography?.lon),
    coordinateVisibilityLevel: integerValue(geography?.geo_visibility_level),
    media: mediaItems.slice(0, 60).flatMap((value) => {
      if (!isObject(value)) {
        return [];
      }
      const uri = stringValue(value.uri);
      return uri
        ? [{ uri, alt: stringValue(value.alt), hasFloorplan: value.hasFotoplano === true }]
        : [];
    }),
  };
}

export function parseStudioCasaInventoryHtml(
  html: string,
  response: HttpResponse | null = null,
): StudioCasaInventoryPage {
  const state = decodeCasaInitialState(html);
  const inventory = objectValue(state, "agencySrp");
  const publisher = objectValue(inventory, "publisher");
  const paginator = objectValue(inventory, "paginator");
  const records = Array.isArray(inventory?.list) ? inventory.list : [];
  const reportedTotal = integerValue(inventory?.total);
  const pageNumber = integerValue(paginator?.currentPage);
  const totalPages = integerValue(paginator?.totalPages) ?? 1;
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;
  let excludedNonSaleCount = 0;

  for (const value of records) {
    if (!isObject(value)) {
      parseErrorCount += 1;
      continue;
    }
    const channel = stringValue(value.channel)?.toLocaleLowerCase("it");
    if (channel !== "vendita") {
      if (channel) {
        excludedNonSaleCount += 1;
      } else {
        parseErrorCount += 1;
      }
      continue;
    }

    const id = integerValue(value.id);
    const uri = stringValue(value.uri);
    if (id == null || !uri) {
      parseErrorCount += 1;
      continue;
    }

    try {
      const url = canonicalUrl(uri, STUDIO_CASA_BASE_URL);
      const urlId = new URL(url).pathname.match(/^\/immobili\/(\d+)$/)?.[1];
      if (urlId !== String(id)) {
        parseErrorCount += 1;
        continue;
      }
      extracted.push({
        sourceKey: String(id),
        externalId: String(id),
        url,
        summary: safeInventorySummary(value),
      });
    } catch {
      parseErrorCount += 1;
    }
  }

  const deduplicated = deduplicateInventoryItems(extracted);
  const requiredMarkers = {
    initialState: state !== null,
    agencySearchResults:
      inventory !== null &&
      (inventory.isPublisherPage === true || inventory.isAgencySrp === true),
    publisherIdentity: integerValue(publisher?.publisherId) === STUDIO_CASA_PUBLISHER_ID,
    paginationContract:
      pageNumber != null && totalPages >= 1 && pageNumber >= 1 && pageNumber <= totalPages,
    listingRecords: records.length > 0,
  };
  const diagnostics = {
    expectedCount: reportedTotal,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: pageNumber == null ? 0 : 1,
    expectedPages: totalPages,
    requiredMarkers,
    reasons: excludedNonSaleCount > 0
      ? [`non_sale_records_excluded:${excludedNonSaleCount}`]
      : [],
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(requiredMarkers),
    diagnostics,
    response,
    pageNumber,
    totalPages,
    reportedTotal,
    rawRecordCount: records.length,
    excludedNonSaleCount,
  };
}

function italianPortalDate(value: string | null): string | null {
  const match = value?.match(/^(\d{1,2})\s+([a-zÃ ]+)\s+(20\d{2})$/i);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const months = new Map([
    ["gennaio", 0],
    ["febbraio", 1],
    ["marzo", 2],
    ["aprile", 3],
    ["maggio", 4],
    ["giugno", 5],
    ["luglio", 6],
    ["agosto", 7],
    ["settembre", 8],
    ["ottobre", 9],
    ["novembre", 10],
    ["dicembre", 11],
  ]);
  const month = months.get(match[2].toLocaleLowerCase("it"));
  if (month == null) {
    return null;
  }
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function portalStatus(pdp: JsonObject): {
  value: SourceStatus;
  label: string | null;
  confidence: number;
  method: string | null;
} {
  const label = stringValue(pdp.status);
  const normalized = label?.toLocaleLowerCase("it") ?? "";
  if (/vendut/.test(normalized)) {
    return { value: "SOLD", label, confidence: 0.95, method: "CASA_IT_DEDICATED_STATUS" };
  }
  if (/trattativa|opzionat/.test(normalized)) {
    return {
      value: "NEGOTIATION",
      label,
      confidence: 0.9,
      method: "CASA_IT_DEDICATED_STATUS",
    };
  }
  if (/rimoss|non disponibile|disattivat/.test(normalized) || pdp.disabled === true) {
    return {
      value: "REMOVED",
      label: label ?? "disabled=true",
      confidence: 0.9,
      method: label ? "CASA_IT_DEDICATED_STATUS" : "CASA_IT_DISABLED_FLAG",
    };
  }
  return { value: "UNKNOWN", label, confidence: 0.25, method: null };
}

function casaAssets(pdp: JsonObject): NormalizedAsset[] {
  const media = objectValue(pdp, "media");
  const host = stringValue(media?.hostImages);
  const gallery = Array.isArray(media?.gallery) ? media.gallery : [];
  if (!host) {
    return [];
  }

  const seen = new Set<string>();
  return gallery.slice(0, 60).flatMap((value) => {
    if (!isObject(value)) {
      return [];
    }
    const mediaId = stringValue(value.mediaid)?.replace(/^\/+/, "");
    if (!mediaId || !/^[a-z0-9/_-]+\.(?:jpe?g|png|webp)$/i.test(mediaId)) {
      return [];
    }
    const url = new URL(`800x600/listing/${mediaId}`, host).toString();
    if (seen.has(url)) {
      return [];
    }
    seen.add(url);
    return [{
      kind: stringValue(value.type)?.toLocaleLowerCase("it") === "floorplan"
        ? "FLOORPLAN" as const
        : "IMAGE" as const,
      url,
      canonicalUrl: url,
      sourceRecordedAt: null,
      dateEvidenceMethod: null,
      metadata: {
        portalMediaId: mediaId,
        portalMediaType: stringValue(value.type),
        alt: stringValue(value.alt),
        aiGenerated: value.aiGenerated === true,
        transformedPublicAssetRequired: true,
      },
    }];
  });
}

function casaInventoryAssets(summary: Record<string, unknown>): NormalizedAsset[] {
  const media = Array.isArray(summary.media) ? summary.media : [];
  const seen = new Set<string>();
  return media.slice(0, 60).flatMap((value) => {
    if (!isObject(value)) return [];
    const uri = stringValue(value.uri);
    if (!uri || !/^\/listing\/[a-z0-9/_-]+\.(?:jpe?g|png|webp)$/i.test(uri)) return [];
    const url = `https://images-1.casa.it/800x600${uri}`;
    if (seen.has(url)) return [];
    seen.add(url);
    return [{
      kind: value.hasFloorplan === true ? "FLOORPLAN" as const : "IMAGE" as const,
      url,
      canonicalUrl: url,
      sourceRecordedAt: null,
      dateEvidenceMethod: null,
      metadata: {
        portalMediaType: value.hasFloorplan === true ? "floorplan" : "image",
        alt: stringValue(value.alt),
        transformedPublicAssetRequired: true,
        inventoryPayloadFallback: true,
      },
    }];
  });
}

function studioCasaLocalityHint(title: string | null, description: string | null): string | null {
  const titleMatch = title?.match(/\b(Palombaio|Mariotto)\b/i)?.[1];
  if (titleMatch) return titleMatch;
  return description?.match(/^\s*(Palombaio|Mariotto)\b/i)?.[1] ?? null;
}

function normalizeStudioCasaInventoryFallback(document: SourceDocument): NormalizedListingV2 {
  const summary = document.item.summary;
  const title = typeof summary.title === "string" ? summary.title : null;
  const description = typeof summary.description === "string" ? summary.description : null;
  if (!title) {
    throw new Error(`Studio Casa inventory fallback ${document.item.url} has no title.`);
  }
  const municipality = typeof summary.municipality === "string" ? summary.municipality : null;
  const district = typeof summary.district === "string" ? summary.district : null;
  const street = typeof summary.street === "string" ? summary.street : null;
  const localityHint = district ?? studioCasaLocalityHint(title, description);
  const observedAt = document.observedAt;
  const inventoryPrimary =
    document.response.headers.get("x-listing-radar-source") === "casa-it-inventory";
  const marketEvidence = createEvidence({
    kind: "MARKET_START_BOUND",
    claimKey: "publication.firstPublicEvidenceAt",
    sourceUrl: document.item.url,
    extractionMethod: "CRAWLER_FIRST_SEEN",
    rawValue: observedAt,
    normalizedValue: { lowerBound: null, upperBound: observedAt },
    confidence: 0.2,
    observedAt,
    sourceRecordedAt: null,
    metadata: {
      sourceLimitation: inventoryPrimary
        ? "normalized from complete public publisher inventory to avoid detail rate limiting"
        : "detail blocked; normalized from public publisher inventory",
    },
  });
  const agencyReference = cleanAgencyReference(
    typeof summary.portalReference === "string" ? summary.portalReference : null,
  );

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "studiocasa",
    source: {
      agencySlug: "studio-casa-bitonto",
      sourceKey: document.item.sourceKey,
      externalId: document.item.externalId,
      canonicalUrl: document.item.url,
      agencyReference,
      transactionType: summary.channel === "vendita" ? "SALE" : "UNKNOWN",
    },
    commercial: {
      title,
      description,
      propertyType: typeof summary.propertyType === "string" ? summary.propertyType : null,
      priceAmount: numberValue(summary.priceAmount),
      priceCurrency: "EUR",
      surfaceSqm: numberValue(summary.surfaceSqm),
      rooms: numberValue(summary.rooms),
      bedrooms: null,
      bathrooms: numberValue(summary.bathrooms),
      floor: typeof summary.floor === "string" ? summary.floor : null,
      features: {
        partnerId: integerValue(summary.partnerId),
        availability: typeof summary.availability === "string" ? summary.availability : null,
        portalPositionAccuracy: integerValue(summary.coordinateVisibilityLevel),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [street, localityHint, municipality].filter(Boolean).join(", "),
      municipality,
      locality: localityHint,
      latitude: numberValue(summary.latitude),
      longitude: numberValue(summary.longitude),
      coordinatesExact: false,
    }),
    status: { value: "UNKNOWN", sourceLabel: null, confidence: 0.2, evidence: [] },
    assets: casaInventoryAssets(summary),
    marketStart: {
      lowerBound: null,
      upperBound: observedAt,
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.2,
      evidence: [marketEvidence],
    },
    observedAt,
    response: {
      url: document.response.url,
      status: document.response.status,
      etag: cleanText(document.response.headers.get("etag")),
      lastModified: cleanText(document.response.headers.get("last-modified")),
    },
    extractionWarnings: [
      "portal_only_source",
      inventoryPrimary
        ? "inventory_payload_primary_detail_not_requested"
        : `detail_http_${document.response.status}_inventory_summary_fallback`,
      "portal_modified_date_not_market_start",
      "missing_dedicated_source_status",
      ...(agencyReference ? [] : ["missing_agency_reference"]),
    ],
    provenance: {
      inventorySummary: summary,
      reportedSource: inventoryPrimary
        ? "public_casa_it_agency_inventory"
        : "public_casa_it_agency_inventory_fallback",
      publisherId: STUDIO_CASA_PUBLISHER_ID,
      detailHttpStatus: inventoryPrimary ? null : document.response.status,
      detailRequestSkippedForSourceSafety: inventoryPrimary,
      sourceCreatedAtUnavailable: true,
      publisherContactDataExcluded: true,
    },
  });
}

function numericField(parent: JsonObject | null, key: string): number | null {
  const field = objectValue(parent, key);
  return numberValue(field?.value);
}

export function normalizeStudioCasaDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const pdp = decodeCasaDetail(body);
  if (!pdp) {
    if (
      [403, 429].includes(responseStatus) ||
      headers.get("x-listing-radar-source") === "casa-it-inventory"
    ) {
      return normalizeStudioCasaInventoryFallback(document);
    }
    throw new Error(`Studio Casa detail ${document.item.url} has no Casa.it detail payload.`);
  }

  const id = integerValue(pdp.id);
  if (id == null || String(id) !== document.item.externalId) {
    throw new Error(
      `Studio Casa detail ${document.item.url} identity does not match inventory ${document.item.externalId}.`,
    );
  }
  const publisher = objectValue(pdp, "publisher");
  if (integerValue(publisher?.publisherId) !== STUDIO_CASA_PUBLISHER_ID) {
    throw new Error(`Studio Casa detail ${document.item.url} has an unexpected publisher.`);
  }

  const helmet = objectValue(objectValue(pdp, "helmetData"), "seoData");
  const canonical = canonicalUrl(
    stringValue(helmet?.linkCanonical) ?? document.item.url,
    STUDIO_CASA_BASE_URL,
  );
  const title =
    stringValue(helmet?.h1) ??
    stringValue(objectValue(pdp, "mainCardAggregator")?.title);
  if (!title) {
    throw new Error(`Studio Casa detail ${canonical} has no title.`);
  }

  const address = objectValue(pdp, "address");
  const description = objectValue(objectValue(pdp, "description"), "it");
  const propertyType = objectValue(pdp, "propertyType");
  const mainFeatures = objectValue(pdp, "mainFeatures");
  const rawStreet = stringValue(address?.street);
  const municipality = stringValue(address?.town);
  const district = stringValue(address?.block ?? address?.zone);
  const localityHint = district ?? studioCasaLocalityHint(title, stringValue(description?.text));
  const status = portalStatus(pdp);
  const statusEvidence = status.method
    ? [createEvidence({
        kind: "SOURCE_STATUS",
        claimKey: "publication.status",
        sourceUrl: canonical,
        extractionMethod: status.method,
        rawValue: status.label,
        normalizedValue: status.value,
        confidence: status.confidence,
        observedAt: document.observedAt,
        sourceRecordedAt: null,
      })]
    : [];
  const marketEvidence = createEvidence({
    kind: "MARKET_START_BOUND",
    claimKey: "publication.firstPublicEvidenceAt",
    sourceUrl: canonical,
    extractionMethod: "CRAWLER_FIRST_SEEN",
    rawValue: document.observedAt,
    normalizedValue: { lowerBound: null, upperBound: document.observedAt },
    confidence: 0.25,
    observedAt: document.observedAt,
    sourceRecordedAt: null,
    metadata: {
      sourceLimitation: "portal exposes modification date but no publication date",
    },
  });
  const modifiedLabel = stringValue(pdp.modified);
  const portalModifiedAt = italianPortalDate(modifiedLabel);
  const agencyReference = cleanAgencyReference(
    stringValue(pdp.refPublisher) ??
      (typeof document.item.summary.portalReference === "string"
        ? document.item.summary.portalReference
        : null),
  );
  const price = objectValue(pdp, "price");
  const channel = stringValue(pdp.channel)?.toLocaleLowerCase("it");

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "studiocasa",
    source: {
      agencySlug: "studio-casa-bitonto",
      sourceKey: document.item.sourceKey,
      externalId: String(id),
      canonicalUrl: canonical,
      agencyReference,
      transactionType: channel === "vendita" ? "SALE" : channel === "affitto" ? "RENT" : "UNKNOWN",
    },
    commercial: {
      title,
      description: stringValue(description?.text),
      propertyType: stringValue(propertyType?.label),
      priceAmount: integerValue(price?.value),
      priceCurrency: "EUR",
      surfaceSqm: numericField(pdp, "size"),
      rooms: numericField(pdp, "rooms"),
      bedrooms: null,
      bathrooms: numberValue(mainFeatures?.baths),
      floor: stringValue(mainFeatures?.level),
      features: {
        partnerId: integerValue(pdp.idlId),
        energyClass: stringValue(objectValue(pdp, "energyClass")?.class),
        availability: stringValue(mainFeatures?.availability),
        parkingSpaces: numberValue(mainFeatures?.parkings),
        portalPositionAccuracy: integerValue(address?.positionAccuracy),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [rawStreet, localityHint, municipality].filter(Boolean).join(", "),
      municipality,
      locality: localityHint,
      latitude: numberValue(address?.lat),
      longitude: numberValue(address?.lon),
      coordinatesExact: false,
    }),
    status: {
      value: status.value,
      sourceLabel: status.label,
      confidence: status.confidence,
      evidence: statusEvidence,
    },
    assets: casaAssets(pdp),
    marketStart: {
      lowerBound: null,
      upperBound: document.observedAt,
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.25,
      evidence: [marketEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: responseUrl,
      status: responseStatus,
      etag: cleanText(headers.get("etag")),
      lastModified: cleanText(headers.get("last-modified")),
    },
    extractionWarnings: [
      "portal_only_source",
      "portal_modified_date_not_market_start",
      ...(status.value === "UNKNOWN" ? ["missing_dedicated_source_status"] : []),
      ...(agencyReference ? [] : ["missing_agency_reference"]),
    ],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_casa_it_agency_inventory_and_detail",
      publisherId: STUDIO_CASA_PUBLISHER_ID,
      partnerId: integerValue(pdp.idlId),
      portalModifiedLabel: modifiedLabel,
      portalModifiedAt,
      portalModifiedIgnoredForMarketStart: true,
      sourceCreatedAtUnavailable: true,
      publisherContactDataExcluded: true,
    },
  });
}

export class StudioCasaAdapter implements PropertyLifecycleAdapter {
  readonly key = "studiocasa";
  readonly agencySlug = "studio-casa-bitonto";
  readonly inventoryUrl = STUDIO_CASA_INVENTORY_URL;

  constructor(
    private readonly http = new HttpClient({
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 500,
      minIntervalMs: 1_000,
      headers: {
        "user-agent": "ListingRadarLifecycle/2.0 (+local validation)",
        "accept-language": "it-IT,it;q=0.9,en;q=0.7",
      },
    }),
  ) {}

  async fetchInventory(): Promise<InventoryResult> {
    const response = await this.http.get(this.inventoryUrl);
    if (!response.ok) {
      const requiredMarkers = { successfulResponse: false };
      const diagnostics = {
        expectedCount: null,
        observedCount: 0,
        duplicateCount: 0,
        parseErrorCount: 1,
        pagesVisited: 0,
        expectedPages: 1,
        requiredMarkers,
        reasons: [`http_status:${response.status}`],
      };
      return {
        items: [],
        healthState: "FAILED",
        complete: false,
        structureFingerprint: structureFingerprint(requiredMarkers),
        diagnostics,
        response,
      };
    }

    const firstPage = parseStudioCasaInventoryHtml(response.body, response);
    const allItems = [...firstPage.items];
    const reasons = [...firstPage.diagnostics.reasons];
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let perPageDuplicateCount = firstPage.diagnostics.duplicateCount;
    let pagesVisited = firstPage.pageNumber === 1 ? 1 : 0;
    let rawRecordCount = firstPage.rawRecordCount;
    let excludedNonSaleCount = firstPage.excludedNonSaleCount;
    let allPagesStructured = Object.values(firstPage.diagnostics.requiredMarkers).every(Boolean);
    let totalsConsistent = true;

    for (let pageNumber = 2; pageNumber <= firstPage.totalPages; pageNumber += 1) {
      const pageUrl = `${STUDIO_CASA_BASE_URL}/srp/?page=${pageNumber}&pId=${STUDIO_CASA_PUBLISHER_ID}`;
      const pageResponse = await this.http.get(pageUrl);
      if (!pageResponse.ok) {
        parseErrorCount += 1;
        reasons.push(`pagination_http_status:${pageResponse.status}:page=${pageNumber}`);
        allPagesStructured = false;
        continue;
      }
      const page = parseStudioCasaInventoryHtml(pageResponse.body, pageResponse);
      const structured = Object.values(page.diagnostics.requiredMarkers).every(Boolean);
      const expectedPage = page.pageNumber === pageNumber;
      allPagesStructured &&= structured && expectedPage;
      totalsConsistent &&=
        page.reportedTotal === firstPage.reportedTotal &&
        page.totalPages === firstPage.totalPages;
      if (!expectedPage) {
        reasons.push(`pagination_page_mismatch:expected=${pageNumber}:actual=${page.pageNumber}`);
      }
      if (structured && expectedPage) {
        pagesVisited += 1;
      }
      allItems.push(...page.items);
      rawRecordCount += page.rawRecordCount;
      excludedNonSaleCount += page.excludedNonSaleCount;
      parseErrorCount += page.diagnostics.parseErrorCount;
      perPageDuplicateCount += page.diagnostics.duplicateCount;
    }

    const deduplicated = deduplicateInventoryItems(allItems);
    const expectedSaleCount = firstPage.reportedTotal == null
      ? null
      : Math.max(0, firstPage.reportedTotal - excludedNonSaleCount);
    const requiredMarkers = {
      ...firstPage.diagnostics.requiredMarkers,
      allPagesStructured,
      totalsConsistent,
      rawCountReconciled:
        firstPage.reportedTotal != null && rawRecordCount === firstPage.reportedTotal,
    };
    reasons.push(`portal_records:${rawRecordCount}`);
    reasons.push(`non_sale_records_excluded:${excludedNonSaleCount}`);
    const diagnostics = {
      expectedCount: expectedSaleCount,
      observedCount: deduplicated.items.length,
      duplicateCount: perPageDuplicateCount + deduplicated.duplicateCount,
      parseErrorCount,
      pagesVisited,
      expectedPages: firstPage.totalPages,
      requiredMarkers,
      reasons,
    };
    const health = classifyInventoryHealth(diagnostics);

    return {
      ...firstPage,
      items: deduplicated.items,
      healthState: health.state,
      complete: health.complete,
      structureFingerprint: structureFingerprint(requiredMarkers),
      diagnostics,
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
    return {
      item,
      observedAt: new Date().toISOString(),
      response: {
        body: "",
        headers: new Headers({ "x-listing-radar-source": "casa-it-inventory" }),
        ok: true,
        status: 200,
        url: item.url,
      },
    };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeStudioCasaDetail(document);
  }
}
