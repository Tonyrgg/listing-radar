import { load } from "cheerio";

import { HttpClient, type HttpResponse } from "@/lib/http/client";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type EvidenceClaim,
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
  parseInteger,
  parseItalianNumber,
  structureFingerprint,
} from "@/lib/property-lifecycle/adapters/shared";

export const GAROFALO_BASE_URL = "https://garofaloimmobiliare.com";
export const GAROFALO_INVENTORY_URL = `${GAROFALO_BASE_URL}/immobili`;
export const GAROFALO_API_URL = `${GAROFALO_BASE_URL}/manager/includer.php`;

const GAROFALO_REALESTATE_ID = "50";
const GAROFALO_PAGE_SIZE = 100;
const GLOBAL_USER_FILES_BASE_URL = "https://globaluserfiles.com/media/";

interface GarofaloImage {
  id?: string | null;
  property_id?: string | null;
  source?: string | null;
  name?: string | null;
  is_main?: string | null;
  is_active?: string | null;
  create_dt?: string | null;
  updated_dt?: string | null;
}

interface GarofaloProperty {
  id?: string | null;
  property_id?: string | null;
  realestate_id?: string | null;
  code?: string | null;
  city_name?: string | null;
  province_name?: string | null;
  address?: string | null;
  lat?: string | null;
  lng?: string | null;
  price?: string | null;
  surface?: string | null;
  agreement_id?: string | null;
  rooms_n?: string | null;
  restrooms_n?: string | null;
  on_sale?: string | null;
  sold?: string | null;
  price_on_request?: string | null;
  is_visible?: string | null;
  is_active?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  title?: string | null;
  description?: string | null;
  permalink?: string | null;
  image?: string | null;
  img_source?: string | null;
  type?: string | null;
  images?: GarofaloImage[] | null;
}

interface GarofaloPayload {
  result?: boolean;
  data?: {
    properties?: GarofaloProperty[];
    properties_count_all_filtered?: string | number | null;
    filter?: {
      agreement_id?: unknown;
      nation_id?: unknown;
      visible_only?: unknown;
    };
    property?: GarofaloProperty;
    options?: Record<string, unknown>;
  };
  message?: string;
}

interface GarofaloInventoryPage extends InventoryResult {
  start: number;
  length: number;
  reportedTotal: number | null;
  rawRecordCount: number;
}

function parsePayload(body: string): GarofaloPayload | null {
  try {
    return JSON.parse(body) as GarofaloPayload;
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function detailUrl(property: GarofaloProperty, externalId: string): string {
  const slug = slugify(cleanText(property.title) ?? cleanText(property.address) ?? externalId);
  return `${GAROFALO_BASE_URL}/realestate-detail/reid/${externalId}/${slug}`;
}

function filterContains(value: unknown, expected: string): boolean {
  return Array.isArray(value)
    ? value.some((entry) => String(entry) === expected)
    : String(value) === expected;
}

export function parseGarofaloInventoryJson(
  body: string,
  response: HttpResponse | null = null,
  input: { start?: number; length?: number } = {},
): GarofaloInventoryPage {
  const start = input.start ?? 0;
  const length = input.length ?? GAROFALO_PAGE_SIZE;
  const payload = parsePayload(body);
  const rawProperties = Array.isArray(payload?.data?.properties)
    ? payload.data.properties
    : [];
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;

  for (const property of rawProperties) {
    const externalId = cleanText(property.id);
    if (
      !externalId ||
      !/^\d+$/.test(externalId) ||
      property.realestate_id !== GAROFALO_REALESTATE_ID ||
      property.agreement_id !== "1" ||
      property.is_visible !== "1" ||
      property.is_active !== "1"
    ) {
      parseErrorCount += 1;
      continue;
    }

    extracted.push({
      sourceKey: externalId,
      externalId,
      url: detailUrl(property, externalId),
      summary: {
        agencyReference: cleanAgencyReference(property.code),
        municipality: cleanText(property.city_name),
        address: cleanText(property.address),
        title: cleanText(property.title),
        propertyType: cleanText(property.type),
        priceAmount: parseInteger(property.price),
        surfaceSqm: parseItalianNumber(property.surface),
        rooms: positiveNumber(property.rooms_n),
        bathrooms: positiveNumber(property.restrooms_n),
        latitude: coordinate(property.lat, 90),
        longitude: coordinate(property.lng, 180),
        sold: property.sold === "1",
        sourceCreatedAt: cleanText(property.created_at),
        sourceUpdatedAt: cleanText(property.updated_at),
        imageSource: cleanText(property.img_source),
      },
    });
  }

  const deduplicated = deduplicateInventoryItems(extracted);
  const reportedTotal = parseInteger(String(payload?.data?.properties_count_all_filtered ?? ""));
  const requiredMarkers = {
    apiResult: payload?.result === true,
    propertiesArray: Array.isArray(payload?.data?.properties),
    reportedTotal: reportedTotal != null && reportedTotal > 0,
    saleFilter: filterContains(payload?.data?.filter?.agreement_id, "1"),
    visibleFilter: String(payload?.data?.filter?.visible_only) === "1",
    agencyIdentity:
      rawProperties.length > 0 &&
      rawProperties.every((property) => property.realestate_id === GAROFALO_REALESTATE_ID),
    recordContract:
      rawProperties.length > 0 && extracted.length + parseErrorCount === rawProperties.length,
  };
  const expectedPages = reportedTotal == null ? 1 : Math.max(1, Math.ceil(reportedTotal / length));
  const diagnostics = {
    expectedCount: reportedTotal,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: Object.values(requiredMarkers).every(Boolean) ? 1 : 0,
    expectedPages,
    requiredMarkers,
    reasons: payload?.message ? [`source_message:${payload.message}`] : [],
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(requiredMarkers),
    diagnostics,
    response,
    start,
    length,
    reportedTotal,
    rawRecordCount: rawProperties.length,
  };
}

function inventoryForm(start: number, length: number): URLSearchParams {
  return new URLSearchParams({
    action: "read_properties",
    "filter[price_min]": "0",
    "filter[price_max]": "0",
    "filter[area_min]": "0",
    "filter[area_max]": "0",
    "filter[not_sold_only]": "0",
    "filter[on_sale_only]": "0",
    "filter[agreement_id][]": "1",
    "filter[order_by]": "0",
    "filter[nation_id][]": "110",
    "filter[features][f_583][]": "0",
    "filter[features][f_597][]": "0",
    "filter[view_type]": "list",
    start: String(start),
    length: String(length),
    f: "RealEstateManager/services/reader_realestate",
    language_code: "it",
    fallback_lang: "it",
    realestate_id: GAROFALO_REALESTATE_ID,
  });
}

function detailForm(externalId: string): URLSearchParams {
  return new URLSearchParams({
    action: "read_property",
    property_id: externalId,
    "filter[type]": "0",
    f: "RealEstateManager/services/reader_realestate",
    language_code: "it",
    fallback_lang: "it",
    realestate_id: GAROFALO_REALESTATE_ID,
  });
}

function coordinate(value: string | null | undefined, maximum: number): number | null {
  const parsed = Number(value?.trim().replace(",", "."));
  return Number.isFinite(parsed) && Math.abs(parsed) <= maximum ? parsed : null;
}

function positiveNumber(value: string | null | undefined): number | null {
  const parsed = parseItalianNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function dateTimeDayRange(
  value: string | null | undefined,
  observedAt: string,
): { lowerBound: string; upperBound: string } | null {
  const match = value?.match(/^(20\d{2})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const lower = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(lower) || !Number.isFinite(observed) || lower > observed) {
    return null;
  }
  return {
    lowerBound: new Date(lower).toISOString(),
    upperBound: new Date(Math.min(lower + 86_400_000 - 1, observed)).toISOString(),
  };
}

function optionValues(options: Record<string, unknown>, label: string): string[] {
  const value = options[label];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => cleanText(String(entry))).filter((entry): entry is string => !!entry);
}

function firstOption(options: Record<string, unknown>, label: string): string | null {
  return optionValues(options, label)[0] ?? null;
}

function sourceAddress(value: string | null | undefined): string | null {
  return cleanText(value)?.replace(/\s*:\s*\d+\s+vani\b.*$/i, "") ?? null;
}

function cleanDescription(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const text = cleanText(load(`<body>${value}</body>`)("body").text());
  if (!text) {
    return null;
  }
  return (
    cleanText(
      text
        .replace(
          /\s+(?:per (?:ulteriori|maggiori) informazioni|non esitare a contattarci|contattaci|chiamaci)\b[\s\S]*$/i,
          "",
        )
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact removed]")
        .replace(/https?:\/\/\S+/gi, "[link removed]")
        .replace(/\b(?:\+39\s*)?(?:0\d{1,3}|3\d{2})(?:[\s.-]*\d){6,9}\b/g, "[contact removed]"),
    ) ?? null
  );
}

function originalMediaUrl(source: string | null | undefined): string | null {
  const normalized = cleanText(source);
  if (!normalized || !/^4350_[a-f0-9]{40}\.(?:jpe?g|png|webp)$/i.test(normalized)) {
    return null;
  }
  return `${GLOBAL_USER_FILES_BASE_URL}${encodeURIComponent(normalized)}`;
}

function garofaloAssets(property: GarofaloProperty): NormalizedAsset[] {
  const seen = new Set<string>();
  const images = Array.isArray(property.images) ? property.images : [];
  return images
    .filter((image) => image.is_active !== "0")
    .sort((left, right) => Number(right.is_main === "1") - Number(left.is_main === "1"))
    .flatMap((image): NormalizedAsset[] => {
      const url = originalMediaUrl(image.source);
      if (!url || seen.has(url)) {
        return [];
      }
      seen.add(url);
      const sourceName = cleanText(image.name);
      return [
        {
          kind: /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(sourceName ?? "")
            ? "FLOORPLAN"
            : "IMAGE",
          url,
          canonicalUrl: url,
          sourceRecordedAt: null,
          dateEvidenceMethod: null,
          metadata: {
            originalGlobalUserFile: true,
            transformedDerivativeExcluded: true,
            lastModifiedEligibleForMarketStart: true,
            sourceImageId: cleanText(image.id),
            sourceName,
            sourceCreatedAt: cleanText(image.create_dt),
            sourceUpdatedAt: cleanText(image.updated_dt),
            isMain: image.is_main === "1",
          },
        },
      ];
    })
    .slice(0, 60);
}

function plausibleCoordinatesForDeclaredMunicipality(
  municipality: string | null,
  latitude: number | null,
  longitude: number | null,
): boolean {
  if (latitude == null || longitude == null) {
    return true;
  }
  if (!/^(?:bitonto|palombaio|mariotto)$/i.test(municipality ?? "")) {
    return true;
  }
  return latitude >= 40.95 && latitude <= 41.25 && longitude >= 16.4 && longitude <= 16.9;
}

function statusFromProperty(
  property: GarofaloProperty,
  canonical: string,
  observedAt: string,
): { value: SourceStatus; sourceLabel: string | null; confidence: number; evidence: EvidenceClaim[] } {
  if (property.sold === "1") {
    return {
      value: "SOLD",
      sourceLabel: "sold=1",
      confidence: 1,
      evidence: [
        createEvidence({
          kind: "SOURCE_STATUS",
          claimKey: "publication.status",
          sourceUrl: canonical,
          extractionMethod: "FLAZIO_SOLD_FLAG",
          rawValue: "1",
          normalizedValue: "SOLD",
          confidence: 1,
          observedAt,
          sourceRecordedAt: null,
        }),
      ],
    };
  }

  if (property.is_active === "0" || property.is_visible === "0") {
    return {
      value: "REMOVED",
      sourceLabel: `active=${property.is_active ?? "unknown"};visible=${property.is_visible ?? "unknown"}`,
      confidence: 0.95,
      evidence: [
        createEvidence({
          kind: "SOURCE_STATUS",
          claimKey: "publication.status",
          sourceUrl: canonical,
          extractionMethod: "FLAZIO_VISIBILITY_FLAGS",
          rawValue: `active=${property.is_active ?? "unknown"};visible=${property.is_visible ?? "unknown"}`,
          normalizedValue: "REMOVED",
          confidence: 0.95,
          observedAt,
          sourceRecordedAt: null,
        }),
      ],
    };
  }

  return { value: "UNKNOWN", sourceLabel: null, confidence: 0.25, evidence: [] };
}

export function normalizeGarofaloDetail(document: SourceDocument): NormalizedListingV2 {
  const payload = parsePayload(document.response.body);
  const property = payload?.data?.property;
  if (payload?.result !== true || !property) {
    throw new Error(`Garofalo detail ${document.item.url} has an invalid API payload.`);
  }

  const externalId = cleanText(property.id ?? property.property_id);
  if (
    !externalId ||
    externalId !== document.item.externalId ||
    property.realestate_id !== GAROFALO_REALESTATE_ID
  ) {
    throw new Error(`Garofalo detail ${document.item.url} identity does not match inventory.`);
  }
  if (property.agreement_id !== "1") {
    throw new Error(`Garofalo detail ${document.item.url} is not a sale publication.`);
  }

  const canonical = canonicalUrl(document.item.url, GAROFALO_BASE_URL);
  const title = cleanText(property.title);
  if (!title) {
    throw new Error(`Garofalo detail ${canonical} has no title.`);
  }

  const options = payload.data?.options ?? {};
  const address = sourceAddress(property.address);
  const municipality = cleanText(property.city_name);
  const reportedLatitude = coordinate(property.lat, 90);
  const reportedLongitude = coordinate(property.lng, 180);
  const coordinatesPlausible = plausibleCoordinatesForDeclaredMunicipality(
    municipality,
    reportedLatitude,
    reportedLongitude,
  );
  const latitude = coordinatesPlausible ? reportedLatitude : null;
  const longitude = coordinatesPlausible ? reportedLongitude : null;
  const assets = garofaloAssets(property);
  const status = statusFromProperty(property, canonical, document.observedAt);
  const createdAt = cleanText(property.created_at);
  const updatedAt = cleanText(property.updated_at);
  const createdRange = dateTimeDayRange(createdAt, document.observedAt);
  const marketEvidence = createdRange
    ? createEvidence({
        kind: "MARKET_START",
        claimKey: "publication.sourceRecordCreatedAt",
        sourceUrl: canonical,
        extractionMethod: "FLAZIO_PROPERTY_CREATED_AT",
        rawValue: createdAt,
        normalizedValue: createdRange,
        confidence: 0.88,
        observedAt: document.observedAt,
        sourceRecordedAt: createdRange.upperBound,
        metadata: {
          timezoneAbsent: true,
          limitation: "source record creation may represent an import or relaunch",
          sourceUpdatedAtIgnoredForStart: updatedAt,
        },
      })
    : createEvidence({
        kind: "MARKET_START_BOUND",
        claimKey: "publication.firstObservedInInventoryAt",
        sourceUrl: canonical,
        extractionMethod: "CRAWLER_FIRST_SEEN",
        rawValue: document.observedAt,
        normalizedValue: { lowerBound: null, upperBound: document.observedAt },
        confidence: 0.3,
        observedAt: document.observedAt,
        sourceRecordedAt: null,
      });

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "garofalo",
    source: {
      agencySlug: "garofalo-immobiliare-bitonto",
      sourceKey: document.item.sourceKey,
      externalId,
      canonicalUrl: canonical,
      agencyReference: cleanAgencyReference(property.code),
      transactionType: "SALE",
    },
    commercial: {
      title,
      description: cleanDescription(property.description),
      propertyType: firstOption(options, "Tipologia") ?? cleanText(property.type),
      priceAmount: property.price_on_request === "1" ? null : parseInteger(property.price),
      priceCurrency: "EUR",
      surfaceSqm: positiveNumber(property.surface),
      rooms: positiveNumber(property.rooms_n),
      bedrooms: null,
      bathrooms: positiveNumber(property.restrooms_n),
      floor: optionValues(options, "Piano").join(", ") || null,
      features: {
        occupancy: firstOption(options, "Stato"),
        condition: firstOption(options, "Stato Immobile"),
        kitchen: firstOption(options, "Cucina"),
        heating: firstOption(options, "Riscaldamento"),
        elevator: firstOption(options, "Ascensore"),
        totalFloors: firstOption(options, "Totale Piani"),
        terrace: firstOption(options, "Terrazzo"),
        garage: firstOption(options, "Garage"),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [address, municipality].filter(Boolean).join(", "),
      municipality,
      streetName: address,
      latitude,
      longitude,
      coordinatesExact: false,
    }),
    status,
    assets,
    marketStart: {
      lowerBound: createdRange?.lowerBound ?? null,
      upperBound: createdRange?.upperBound ?? document.observedAt,
      method: createdRange ? "FLAZIO_PROPERTY_CREATED_AT" : "CRAWLER_FIRST_SEEN",
      confidence: createdRange ? 0.88 : 0.3,
      evidence: [marketEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: document.response.url,
      status: document.response.status,
      etag: cleanText(document.response.headers.get("etag")),
      lastModified: cleanText(document.response.headers.get("last-modified")),
    },
    extractionWarnings: [
      ...(status.value === "UNKNOWN" ? ["missing_dedicated_active_source_status"] : []),
      ...(createdRange ? ["source_record_creation_may_represent_relaunch"] : []),
      ...(coordinatesPlausible ? [] : ["implausible_reported_coordinates_omitted"]),
      ...(assets.length === 0 ? ["missing_scoped_original_gallery"] : []),
    ],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_flazio_realestate_api",
      flazioRealestateId: Number(GAROFALO_REALESTATE_ID),
      sourceCreatedAt: createdAt,
      sourceUpdatedAt: updatedAt,
      sourceProvince: cleanText(property.province_name),
      sourceUpdatedAtIgnoredForMarketStart: true,
      categoryPrefixedAgencyReferenceNotChronological: true,
      originalGlobalUserFilesLastModifiedEligible: true,
      transformedV1MediaExcluded: true,
      publisherContactDataExcluded: true,
      reportedCoordinates: {
        latitude: reportedLatitude,
        longitude: reportedLongitude,
        accepted: coordinatesPlausible,
      },
    },
  });
}

export class GarofaloAdapter implements PropertyLifecycleAdapter {
  readonly key = "garofalo";
  readonly agencySlug = "garofalo-immobiliare-bitonto";
  readonly inventoryUrl = GAROFALO_INVENTORY_URL;

  constructor(
    private readonly http = new HttpClient({
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 400,
      minIntervalMs: 1_000,
      headers: {
        "user-agent": "ListingRadarLifecycle/2.0 (+local validation)",
        "accept-language": "it-IT,it;q=0.9,en;q=0.7",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
    }),
  ) {}

  async fetchInventory(): Promise<InventoryResult> {
    const firstResponse = await this.http.post(
      GAROFALO_API_URL,
      inventoryForm(0, GAROFALO_PAGE_SIZE),
    );
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

    const firstPage = parseGarofaloInventoryJson(firstResponse.body, firstResponse);
    const allItems = [...firstPage.items];
    const reasons = [...firstPage.diagnostics.reasons];
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let perPageDuplicateCount = firstPage.diagnostics.duplicateCount;
    let pagesVisited = firstPage.diagnostics.pagesVisited;
    let rawRecordCount = firstPage.rawRecordCount;
    let allPagesStructured = Object.values(firstPage.diagnostics.requiredMarkers).every(Boolean);
    let totalsConsistent = true;

    for (let pageIndex = 1; pageIndex < firstPage.diagnostics.expectedPages; pageIndex += 1) {
      const start = pageIndex * GAROFALO_PAGE_SIZE;
      const pageResponse = await this.http.post(
        GAROFALO_API_URL,
        inventoryForm(start, GAROFALO_PAGE_SIZE),
      );
      if (!pageResponse.ok) {
        parseErrorCount += 1;
        allPagesStructured = false;
        reasons.push(`pagination_http_status:${pageResponse.status}:start=${start}`);
        continue;
      }
      const page = parseGarofaloInventoryJson(pageResponse.body, pageResponse, {
        start,
        length: GAROFALO_PAGE_SIZE,
      });
      const structured = Object.values(page.diagnostics.requiredMarkers).every(Boolean);
      allPagesStructured &&= structured;
      totalsConsistent &&= page.reportedTotal === firstPage.reportedTotal;
      if (structured) {
        pagesVisited += 1;
      }
      allItems.push(...page.items);
      rawRecordCount += page.rawRecordCount;
      parseErrorCount += page.diagnostics.parseErrorCount;
      perPageDuplicateCount += page.diagnostics.duplicateCount;
    }

    const deduplicated = deduplicateInventoryItems(allItems);
    const requiredMarkers = {
      ...firstPage.diagnostics.requiredMarkers,
      allPagesStructured,
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
      expectedPages: firstPage.diagnostics.expectedPages,
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
    const response = await this.http.post(GAROFALO_API_URL, detailForm(item.externalId));
    if (!response.ok) {
      throw new Error(`Garofalo detail ${item.url} returned HTTP ${response.status}.`);
    }
    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeGarofaloDetail(document);
  }
}
