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
  cleanAgencyReference,
  cleanText,
  createEvidence,
  deduplicateInventoryItems,
  earliestAssetDate,
  extractMeta,
  parseInteger,
  parseItalianNumber,
  structureFingerprint,
} from "@/lib/property-lifecycle/adapters/shared";

export const AD_MAIORA_BASE_URL = "https://www.admaioraimmobiliare.it";
export const AD_MAIORA_INVENTORY_URL = "https://www.admaioraimmobiliare.it/vendita/";
export const AD_MAIORA_REST_URL =
  "https://www.admaioraimmobiliare.it/wp-json/wp/v2/immobile?per_page=100&_fields=id,date_gmt,modified_gmt,link,status";

interface RestProperty {
  id: number;
  date_gmt?: string;
  modified_gmt?: string;
  link: string;
  status?: string;
}

type JsonObject = Record<string, unknown>;

function slugFromUrl(urlValue: string): string | null {
  return new URL(urlValue, AD_MAIORA_BASE_URL).pathname.match(/\/immobile\/([^/]+)/i)?.[1] ?? null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flattenJsonObjects(value: unknown, output: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(value)) {
    for (const child of value) {
      flattenJsonObjects(child, output);
    }
  } else if (isObject(value)) {
    output.push(value);
    for (const child of Object.values(value)) {
      flattenJsonObjects(child, output);
    }
  }
  return output;
}

function jsonLdObjects($: CheerioAPI): JsonObject[] {
  const objects: JsonObject[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      flattenJsonObjects(JSON.parse($(element).text()), objects);
    } catch {
      // Invalid JSON-LD is handled by HTML fallbacks and extraction warnings.
    }
  });
  return objects;
}

function jsonString(objects: JsonObject[], key: string): string | null {
  for (const object of objects) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function realEstateListing(objects: JsonObject[]): JsonObject | null {
  return (
    objects.find((object) => {
      const type = object["@type"];
      return type === "RealEstateListing" ||
        (Array.isArray(type) && type.includes("RealEstateListing"));
    }) ?? null
  );
}

function nestedNumber(object: JsonObject | null, objectKey: string, valueKey: string): number | null {
  const nested = object?.[objectKey];
  if (!isObject(nested)) {
    return null;
  }
  const value = nested[valueKey];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function propertyMetaNumber($: CheerioAPI, className: string): number | null {
  return parseItalianNumber(
    $(`.rh_property__meta.${className} .figure, .rh_property__meta.${className}`)
      .first()
      .text(),
  );
}

function wordpressAssetUrl(value: string): string | null {
  try {
    const url = new URL(value.replace(/&amp;/gi, "&"), AD_MAIORA_BASE_URL);
    if (
      url.hostname.toLocaleLowerCase("it") !== "www.admaioraimmobiliare.it" ||
      !/\/wp-content\/uploads\//i.test(url.pathname) ||
      !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    ) {
      return null;
    }
    url.search = "";
    url.pathname = url.pathname.replace(/-\d+x\d+(\.(?:jpe?g|png|webp))$/i, "$1");
    return url.toString();
  } catch {
    return null;
  }
}

function adMaioraAssets($: CheerioAPI): NormalizedAsset[] {
  const urls = new Set<string>();
  const scope = $("#property-detail-slider-two, #property-detail-slider-carousel-nav");
  scope.find("a[href], img[src], img[data-src], source[srcset]").each((_, element) => {
    const candidates = [
      $(element).attr("href"),
      $(element).attr("src"),
      $(element).attr("data-src"),
      ...($(element).attr("srcset") ?? "")
        .split(",")
        .map((candidate) => candidate.trim().split(/\s+/)[0]),
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const normalized = wordpressAssetUrl(candidate);
      if (normalized) {
        urls.add(normalized);
      }
    }
  });

  const metaImage = extractMeta($, "og:image");
  const normalizedMetaImage = metaImage ? wordpressAssetUrl(metaImage) : null;
  if (normalizedMetaImage) {
    urls.add(normalizedMetaImage);
  }

  return [...urls].slice(0, 60).map((url) => {
    const uploadRange = new URL(url).pathname.match(/\/uploads\/(20\d{2})\/(0[1-9]|1[0-2])\//);
    return {
      kind: /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(new URL(url).pathname)
        ? "FLOORPLAN"
        : "IMAGE",
      url,
      canonicalUrl: url,
      sourceRecordedAt: null,
      dateEvidenceMethod: uploadRange ? "WORDPRESS_UPLOAD_PATH_YYYY_MM" : null,
      metadata: uploadRange
        ? { uploadYear: Number(uploadRange[1]), uploadMonth: Number(uploadRange[2]) }
        : {},
    };
  });
}

function bodyPostId($: CheerioAPI): string | null {
  return $("body").attr("class")?.match(/\bpostid-(\d+)\b/i)?.[1] ?? null;
}

function validIsoDate(value: string | null, observedAt: string): string | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.parse(observedAt) ? new Date(time).toISOString() : null;
}

export function extractAdMaioraPaginationUrls(html: string): string[] {
  const $ = load(html);
  let maximumPage = 1;
  $("a[href*='/vendita/page/']").each((_, element) => {
    try {
      const match = new URL($(element).attr("href") ?? "", AD_MAIORA_BASE_URL).pathname.match(
        /\/vendita\/page\/(\d+)\/?$/i,
      );
      const page = Number(match?.[1]);
      if (Number.isInteger(page) && page > maximumPage) {
        maximumPage = page;
      }
    } catch {
      // Malformed page links are reflected in incomplete page diagnostics.
    }
  });
  return Array.from({ length: Math.max(0, maximumPage - 1) }, (_, index) =>
    `${AD_MAIORA_BASE_URL}/vendita/page/${index + 2}/`,
  );
}

export function parseAdMaioraInventoryHtml(
  html: string,
  response: HttpResponse | null = null,
): InventoryResult {
  const $ = load(html);
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;
  $("article.rh_list_card").each((_, card) => {
    const element = $(card).find("a[href*='/immobile/']").first();
    const href = element.attr("href");
    if (!href) {
      return;
    }
    try {
      const url = canonicalUrl(href, AD_MAIORA_BASE_URL);
      const slug = slugFromUrl(url);
      if (!slug) {
        parseErrorCount += 1;
        return;
      }
      extracted.push({
        sourceKey: slug,
        externalId: slug,
        url,
        summary: { anchorText: cleanText(element.text()) },
      });
    } catch {
      parseErrorCount += 1;
    }
  });
  const deduplicated = deduplicateInventoryItems(extracted);
  const expectedCount =
    parseInteger($("[data-v2-property-count]").first().attr("data-v2-property-count")) ??
    parseInteger(cleanText($.root().text())?.match(/\b\d+\s+a\s+\d+\s+su\s+(\d+)\s+propriet/i)?.[1]);
  const paginationUrls = extractAdMaioraPaginationUrls(html);
  const requiredMarkers = {
    wordpressInventory: /wp-content|wp-json|wp-theme-realhomes/i.test(html),
    listingCards: $("article.rh_list_card").length > 0,
    propertyLinks: deduplicated.items.length > 0,
  };
  const diagnostics = {
    expectedCount,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: 1,
    expectedPages: paginationUrls.length + 1,
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
  };
}

export function enrichAdMaioraInventoryWithRest(
  items: InventoryItem[],
  restBody: string,
): { items: InventoryItem[]; unmatchedCount: number; backendCount: number } {
  let rows: RestProperty[];
  try {
    const parsed = JSON.parse(restBody) as unknown;
    rows = Array.isArray(parsed)
      ? parsed.filter(
          (row): row is RestProperty =>
            isObject(row) &&
            typeof row.id === "number" &&
            typeof row.link === "string" &&
            Number.isInteger(row.id),
        )
      : [];
  } catch {
    rows = [];
  }
  const byUrl = new Map(
    rows.map((row) => [canonicalUrl(row.link, AD_MAIORA_BASE_URL), row]),
  );
  let unmatchedCount = 0;
  const enriched = items.map((item) => {
    const row = byUrl.get(item.url);
    if (!row) {
      unmatchedCount += 1;
      return item;
    }
    const id = String(row.id);
    return {
      ...item,
      sourceKey: id,
      externalId: id,
      summary: {
        ...item.summary,
        wordpressPostId: row.id,
        wordpressPublishedGmt: row.date_gmt ?? null,
        wordpressModifiedGmt: row.modified_gmt ?? null,
        wordpressStatus: row.status ?? null,
        inventorySlug: slugFromUrl(item.url),
      },
    };
  });
  return { items: enriched, unmatchedCount, backendCount: rows.length };
}

export function normalizeAdMaioraDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const objects = jsonLdObjects($);
  const schemaListing = realEstateListing(objects);
  const canonical = canonicalUrl(extractMeta($, "og:url") ?? document.item.url, AD_MAIORA_BASE_URL);
  const postId = bodyPostId($) ?? document.item.externalId;
  if (!/^\d+$/.test(postId)) {
    throw new Error(`Ad Maiora detail ${canonical} has no WordPress post identity.`);
  }
  if (/^\d+$/.test(document.item.externalId) && postId !== document.item.externalId) {
    throw new Error(
      `Ad Maiora detail ${canonical} identity ${postId} does not match inventory ${document.item.externalId}.`,
    );
  }
  const title =
    cleanText($("h1.rh_page__title, .rh_page__property_title h1, h1").first().text()) ??
    cleanText(extractMeta($, "og:title")) ??
    (typeof schemaListing?.name === "string" ? schemaListing.name : null);
  if (!title) {
    throw new Error(`Ad Maiora detail ${canonical} has no title.`);
  }
  const assets = adMaioraAssets($);
  const uploadDate = earliestAssetDate(assets);
  const datePublished = validIsoDate(jsonString(objects, "datePublished"), document.observedAt);
  const dateModified = validIsoDate(jsonString(objects, "dateModified"), document.observedAt);
  const marketEvidence = datePublished
    ? createEvidence({
        kind: "MARKET_START",
        claimKey: "publication.datePublished",
        sourceUrl: canonical,
        extractionMethod: "WORDPRESS_JSON_LD_DATE_PUBLISHED",
        rawValue: jsonString(objects, "datePublished"),
        normalizedValue: { lowerBound: datePublished, upperBound: datePublished },
        confidence: 0.9,
        observedAt: document.observedAt,
        sourceRecordedAt: datePublished,
        metadata: { dateModifiedIgnoredForStart: dateModified },
      })
    : uploadDate
      ? createEvidence({
          kind: "MARKET_START_BOUND",
          claimKey: "publication.mediaUploadMonth",
          sourceUrl: uploadDate.asset.canonicalUrl,
          extractionMethod: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
          rawValue: new URL(uploadDate.asset.canonicalUrl).pathname,
          normalizedValue: {
            lowerBound: uploadDate.lowerBound,
            upperBound: uploadDate.upperBound,
          },
          confidence: 0.4,
          observedAt: document.observedAt,
          sourceRecordedAt: null,
          metadata: { limitation: "media may predate publication or be reused" },
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
  const address =
    cleanText($(".rh_page__property_address").first().text()) ??
    (isObject(schemaListing?.address) && typeof schemaListing.address.streetAddress === "string"
      ? schemaListing.address.streetAddress
      : null);
  const latitude = nestedNumber(schemaListing, "geo", "latitude");
  const longitude = nestedNumber(schemaListing, "geo", "longitude");
  const description =
    cleanText($("#property-content-section-content .rh_content").first().text()) ??
    (typeof schemaListing?.description === "string" ? cleanText(schemaListing.description) : null) ??
    extractMeta($, "og:description");
  const agencyReference = cleanAgencyReference(
    cleanText($(".rh_property__id").first().text())?.replace(/^ID\s+Immobile\s*:\s*/i, ""),
  );

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "admaiora",
    source: {
      agencySlug: "ad-maiora-bitonto",
      sourceKey: document.item.sourceKey,
      externalId: postId,
      canonicalUrl: canonical,
      agencyReference,
      transactionType: "SALE",
    },
    commercial: {
      title,
      description,
      propertyType:
        typeof document.item.summary.propertyType === "string"
          ? document.item.summary.propertyType
          : null,
      priceAmount:
        parseInteger($(".rh_page__property_price").first().text()) ??
        parseInteger(
          isObject(schemaListing?.offers) ? String(schemaListing.offers.price ?? "") : null,
        ),
      priceCurrency: "EUR",
      surfaceSqm:
        propertyMetaNumber($, "prop_size") ??
        parseItalianNumber(
          isObject(schemaListing?.additionalProperty)
            ? String(schemaListing.additionalProperty.value ?? "")
            : null,
        ),
      rooms: propertyMetaNumber($, "prop_bedrooms"),
      bedrooms: null,
      bathrooms: propertyMetaNumber($, "prop_bathrooms"),
      floor: cleanText(`${title} ${description ?? ""}`)?.match(
        /\b(?:piano|al)\s+(terra|rialzato|seminterrato|interrato|\d{1,2}(?:°|º)?)\b/i,
      )?.[1] ?? null,
      features: {
        wordpressPostId: Number(postId),
        labels: $(".rh_property__features .rh_property__feature")
          .toArray()
          .map((element) => cleanText($(element).text()))
          .filter((value): value is string => Boolean(value)),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [address, title].filter(Boolean).join(" | "),
      latitude,
      longitude,
      coordinatesExact: false,
    }),
    status: {
      value: "UNKNOWN",
      sourceLabel: null,
      confidence: 0.25,
      evidence: [],
    },
    assets,
    marketStart: {
      lowerBound: datePublished ?? uploadDate?.lowerBound ?? null,
      upperBound: datePublished ?? uploadDate?.upperBound ?? document.observedAt,
      method: datePublished
        ? "WORDPRESS_JSON_LD_DATE_PUBLISHED"
        : uploadDate
          ? "WORDPRESS_UPLOAD_PATH_YYYY_MM"
          : "CRAWLER_FIRST_SEEN",
      confidence: datePublished ? 0.9 : uploadDate ? 0.4 : 0.3,
      evidence: [marketEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: responseUrl,
      status: responseStatus,
      etag: cleanText(headers.get("etag")),
      lastModified: cleanText(headers.get("last-modified")),
    },
    extractionWarnings: ["missing_dedicated_source_status"],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_sale_archive_html_plus_public_wordpress_identity",
      wordpressDateModified: dateModified,
      backendPublishedInventoryExcludedFromAbsenceBaseline: true,
    },
  });
}

export class AdMaioraAdapter implements PropertyLifecycleAdapter {
  readonly key = "admaiora";
  readonly agencySlug = "ad-maiora-bitonto";
  readonly inventoryUrl = AD_MAIORA_INVENTORY_URL;

  constructor(
    private readonly http = new HttpClient({
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 400,
      minIntervalMs: 1_000,
      headers: { "user-agent": "ListingRadarLifecycle/2.0 (+local validation)" },
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
        pagesVisited: 1,
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

    const firstPage = parseAdMaioraInventoryHtml(response.body, response);
    const paginationUrls = extractAdMaioraPaginationUrls(response.body);
    const allItems = [...firstPage.items];
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let duplicateCount = firstPage.diagnostics.duplicateCount;
    let pagesVisited = 1;
    const reasons = [...firstPage.diagnostics.reasons];
    for (const pageUrl of paginationUrls) {
      const pageResponse = await this.http.get(pageUrl);
      if (!pageResponse.ok) {
        parseErrorCount += 1;
        reasons.push(`pagination_http_status:${pageResponse.status}:${pageUrl}`);
        continue;
      }
      const page = parseAdMaioraInventoryHtml(pageResponse.body, pageResponse);
      allItems.push(...page.items);
      parseErrorCount += page.diagnostics.parseErrorCount;
      duplicateCount += page.diagnostics.duplicateCount;
      pagesVisited += 1;
    }
    const deduplicated = deduplicateInventoryItems(allItems);
    duplicateCount += deduplicated.duplicateCount;

    const restResponses: HttpResponse[] = [];
    const firstRest = await this.http.get(AD_MAIORA_REST_URL);
    if (firstRest.ok) {
      restResponses.push(firstRest);
      const restPages = Math.max(1, Number(firstRest.headers.get("x-wp-totalpages")) || 1);
      for (let page = 2; page <= restPages; page += 1) {
        const pageResponse = await this.http.get(`${AD_MAIORA_REST_URL}&page=${page}`);
        if (pageResponse.ok) {
          restResponses.push(pageResponse);
        } else {
          reasons.push(`wordpress_rest_http_status:${pageResponse.status}:page=${page}`);
        }
      }
    } else {
      reasons.push(`wordpress_rest_http_status:${firstRest.status}`);
    }
    const restRows = restResponses.flatMap((restResponse) => {
      try {
        const parsed = JSON.parse(restResponse.body) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    });
    const enrichment = enrichAdMaioraInventoryWithRest(
      deduplicated.items,
      JSON.stringify(restRows),
    );
    parseErrorCount += enrichment.unmatchedCount;
    reasons.push(`wordpress_backend_published_records:${enrichment.backendCount}`);
    reasons.push(
      `backend_records_excluded_from_public_inventory:${Math.max(0, enrichment.backendCount - enrichment.items.length)}`,
    );
    const requiredMarkers = {
      ...firstPage.diagnostics.requiredMarkers,
      restIdentityCoverage:
        restResponses.length > 0 && enrichment.unmatchedCount === 0,
    };
    const diagnostics = {
      ...firstPage.diagnostics,
      observedCount: enrichment.items.length,
      duplicateCount,
      parseErrorCount,
      pagesVisited,
      expectedPages: paginationUrls.length + 1,
      requiredMarkers,
      reasons,
    };
    const health = classifyInventoryHealth(diagnostics);
    return {
      ...firstPage,
      items: enrichment.items,
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
    const response = await this.http.get(item.url);
    if (!response.ok) {
      throw new Error(`Ad Maiora detail ${item.url} returned HTTP ${response.status}.`);
    }
    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeAdMaioraDetail(document);
  }
}
