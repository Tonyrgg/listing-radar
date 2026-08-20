import { load, type CheerioAPI } from "cheerio";

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
  earliestAssetDate,
  extractMeta,
  parseInteger,
  parseItalianNumber,
  structureFingerprint,
  wordpressUploadDate,
} from "@/lib/property-lifecycle/adapters/shared";

export const PUNTOCASA_BASE_URL = "https://www.puntocasagroup.it";
export const PUNTOCASA_INVENTORY_URL =
  "https://www.puntocasagroup.it/acquista-la-tua-casa-2/";

function slugFromUrl(url: string): string {
  return new URL(url).pathname.match(/\/property-item\/([^/]+)/)?.[1] ?? new URL(url).pathname;
}

function dedicatedInfoValue($: CheerioAPI, label: string): string | null {
  const normalizedLabel = label.toLocaleLowerCase("it");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const element of $(
    ".property-info-agent span, .property-details li, .property-meta li, [data-property-field]",
  ).toArray()) {
    const container = $(element);
    const fullText = cleanText(container.text());
    if (!fullText?.toLocaleLowerCase("it").startsWith(normalizedLabel)) {
      continue;
    }

    const value = cleanText(fullText.replace(new RegExp(`^${escapedLabel}\\s*:?`, "i"), ""));
    if (value) {
      return value;
    }
  }

  return null;
}

function dedicatedStatusLabel($: CheerioAPI): string | null {
  const direct = cleanText(
    $(
      "[data-property-status], .property-page-status, .property-detail-status, .property-info-agent .property-status",
    )
      .first()
      .attr("data-property-status") ??
      $(
        "[data-property-status], .property-page-status, .property-detail-status, .property-info-agent .property-status",
      )
        .first()
        .text(),
  );

  if (direct) {
    return direct;
  }

  const dedicatedTaxonomyLinks = $(
    ".property-info-agent a[href*='/property-status/'], .property-meta a[href*='/property-status/'], article.type-property > a[href*='/property-status/']",
  )
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter((value): value is string => Boolean(value));

  return dedicatedTaxonomyLinks.length > 0 ? dedicatedTaxonomyLinks.join(", ") : null;
}

function puntoCasaStatus(label: string | null): {
  value: SourceStatus;
  confidence: number;
} {
  const normalized = label?.toLocaleLowerCase("it") ?? "";

  if (/vendut/.test(normalized)) {
    return { value: "SOLD", confidence: 0.99 };
  }

  if (/trattativa|opzionat/.test(normalized)) {
    return { value: "NEGOTIATION", confidence: 0.97 };
  }

  if (/ritirat|non disponibile/.test(normalized)) {
    return { value: "REMOVED", confidence: 0.95 };
  }

  if (/vendita|disponibile|attiv/.test(normalized)) {
    return { value: "ACTIVE", confidence: 0.95 };
  }

  return { value: "UNKNOWN", confidence: 0.25 };
}

function originalWordpressUrl(value: string): string | null {
  try {
    const url = new URL(value, PUNTOCASA_BASE_URL);
    if (!url.hostname.endsWith("puntocasagroup.it") || !/\/wp-content\/uploads\//i.test(url.pathname)) {
      return null;
    }

    url.search = "";
    url.pathname = url.pathname.replace(/-\d+x\d+(\.(?:jpe?g|png|webp))$/i, "$1");
    return url.toString();
  } catch {
    return null;
  }
}

function puntoCasaAssets($: CheerioAPI): NormalizedAsset[] {
  const scoped = $(
    ".properties-flexslider, .property-gallery, .property-list-page .flexslider, [data-property-gallery]",
  );
  const urls = new Set<string>();

  scoped.find("a[href], img[src], source[srcset]").each((_, element) => {
    const candidates = [
      $(element).attr("href"),
      $(element).attr("src"),
      ...($(element).attr("srcset") ?? "")
        .split(",")
        .map((candidate) => candidate.trim().split(/\s+/)[0]),
    ];

    for (const candidate of candidates) {
      if (!candidate || /logo|avatar|emoji|partner|banner/i.test(candidate)) {
        continue;
      }

      const normalized = originalWordpressUrl(candidate);
      if (normalized) {
        urls.add(normalized);
      }
    }
  });

  return [...urls].slice(0, 60).map((url) => {
    const uploadDate = wordpressUploadDate(url);
    return {
      kind: /planimetr|piantina|floor.?plan/i.test(url) ? "FLOORPLAN" : "IMAGE",
      url,
      canonicalUrl: url,
      sourceRecordedAt: null,
      dateEvidenceMethod: uploadDate ? "WORDPRESS_UPLOAD_PATH_YYYY_MM" : null,
      metadata: uploadDate ?? {},
    };
  });
}

export function parsePuntoCasaInventoryHtml(
  html: string,
  response: HttpResponse | null = null,
): InventoryResult {
  const $ = load(html);
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;
  let excludedTransactionCount = 0;
  const propertyCards = $(".agent-properties .grid > ul > li, .agent-properties .property-list > li")
    .toArray()
    .filter((element) => $(element).find("a[href*='/property-item/']").length > 0);
  const links =
    propertyCards.length > 0
      ? propertyCards.map((card) => {
          const container = $(card);
          const transactionLabel = cleanText(
            container.find("a[href*='/property-status/']").first().text(),
          );
          if (/affitt|locaz|rent\s*to\s*buy/i.test(transactionLabel ?? "")) {
            excludedTransactionCount += 1;
            return null;
          }
          const anchor = container.find("a[href*='/property-item/']").first();
          return { anchor, transactionLabel };
        })
      : $("a[href*='/property-item/']")
          .toArray()
          .map((element) => ({ anchor: $(element), transactionLabel: null }));

  for (const entry of links) {
    if (!entry) {
      continue;
    }
    const href = entry.anchor.attr("href");
    if (!href) {
      continue;
    }

    try {
      const url = canonicalUrl(href, PUNTOCASA_BASE_URL);
      const externalId = slugFromUrl(url);
      if (!externalId) {
        parseErrorCount += 1;
        continue;
      }

      extracted.push({
        sourceKey: externalId,
        externalId,
        url,
        summary: {
          anchorText: cleanText(entry.anchor.text()),
          transactionLabel: entry.transactionLabel,
        },
      });
    } catch {
      parseErrorCount += 1;
    }
  }

  const deduplicated = deduplicateInventoryItems(extracted);
  const visibleText = cleanText($.root().text());
  const expectedCount =
    parseInteger($("[data-v2-property-count]").first().attr("data-v2-property-count")) ??
    parseInteger(visibleText?.match(/(\d+)\s+(?:immobili|propriet[aà]|properties)/i)?.[1]);
  const paginationUrls = extractPuntoCasaPaginationUrls(html);
  const markers = {
    inventoryContainer: /property-list|property-item|acquista-la-tua-casa/i.test(html),
    propertyLinks: deduplicated.items.length > 0,
    wordpressPage: /wp-content|wordpress|puntocasa/i.test(html),
  };
  const diagnostics = {
    expectedCount,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: 1,
    expectedPages: paginationUrls.length + 1,
    requiredMarkers: markers,
    reasons: [
      ...(expectedCount != null ? [`source_reported_total_all_contracts:${expectedCount}`] : []),
      ...(excludedTransactionCount > 0
        ? [`non_sale_inventory_records_excluded:${excludedTransactionCount}`]
        : []),
    ],
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(markers),
    diagnostics,
    response,
  };
}

export function extractPuntoCasaPaginationUrls(html: string): string[] {
  const $ = load(html);
  let maximumPage = 1;

  $("a[href*='/acquista-la-tua-casa-2/page/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    try {
      const match = new URL(href, PUNTOCASA_BASE_URL).pathname.match(/\/page\/(\d+)\/?$/);
      const page = Number(match?.[1]);
      if (Number.isInteger(page) && page > maximumPage) {
        maximumPage = page;
      }
    } catch {
      // Invalid pagination links are reflected by incomplete inventory health.
    }
  });

  return Array.from({ length: Math.max(0, maximumPage - 1) }, (_, index) =>
    new URL(`/acquista-la-tua-casa-2/page/${index + 2}/`, PUNTOCASA_BASE_URL).toString(),
  );
}

export function normalizePuntoCasaDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const canonical = canonicalUrl(
    extractMeta($, "og:url") ?? document.item.url,
    PUNTOCASA_BASE_URL,
  );
  const title =
    cleanText($("h2.ptitle, h1.entry-title").first().text()) ??
    cleanText(extractMeta($, "og:title")?.replace(/\s*-\s*PuntoCasaGroup\s*$/i, ""));

  if (!title) {
    throw new Error(`PuntoCasa detail ${canonical} has no title.`);
  }

  const agencyReference = cleanAgencyReference(
    cleanText($(".property-page-id span").first().text()) ??
    dedicatedInfoValue($, "Riferimento") ??
    dedicatedInfoValue($, "Rif."),
  );
  const locationText =
    cleanText($("h4.subtitle label, .property-address").first().text()) ??
    dedicatedInfoValue($, "Località");
  const statusLabel = dedicatedStatusLabel($);
  if (/affitt|locaz|rent\s*to\s*buy/i.test(statusLabel ?? "")) {
    throw new Error(`PuntoCasa detail ${canonical} is not a sale publication (${statusLabel}).`);
  }
  const status = puntoCasaStatus(statusLabel);
  const assets = puntoCasaAssets($);
  const assetDate = earliestAssetDate(assets);
  const marketEvidence = assetDate
    ? createEvidence({
        kind: "MARKET_START_BOUND",
        claimKey: "publication.mediaUploadMonth",
        sourceUrl: assetDate.asset.canonicalUrl,
        extractionMethod: "WORDPRESS_UPLOAD_PATH_YYYY_MM",
        rawValue: new URL(assetDate.asset.canonicalUrl).pathname,
        normalizedValue: {
          lowerBound: assetDate.lowerBound,
          upperBound: assetDate.upperBound,
        },
        confidence: 0.4,
        observedAt: document.observedAt,
        sourceRecordedAt: null,
        metadata: { limitation: "media date may predate or be reused by publication" },
      })
    : createEvidence({
        kind: "MARKET_START_BOUND",
        claimKey: "publication.firstObservedActiveAt",
        sourceUrl: canonical,
        extractionMethod: "CRAWLER_FIRST_SEEN",
        rawValue: document.observedAt,
        normalizedValue: { lowerBound: null, upperBound: document.observedAt },
        confidence: 0.3,
        observedAt: document.observedAt,
        sourceRecordedAt: null,
      });
  const statusEvidence = statusLabel
    ? [
        createEvidence({
          kind: "SOURCE_STATUS",
          claimKey: "publication.status",
          sourceUrl: canonical,
          extractionMethod: "PUNTOCASA_DEDICATED_STATUS_TAXONOMY",
          rawValue: statusLabel,
          normalizedValue: status.value,
          confidence: status.confidence,
          observedAt: document.observedAt,
          sourceRecordedAt: null,
        }),
      ]
    : [];
  const description =
    cleanText($(".property-content").first().clone().find(".related-properties").remove().end().text()) ??
    extractMeta($, "og:description");

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "puntocasa",
    source: {
      agencySlug: "puntocasa-bitonto",
      sourceKey: document.item.sourceKey,
      externalId: agencyReference ?? slugFromUrl(canonical),
      canonicalUrl: canonical,
      agencyReference,
      transactionType: "SALE",
    },
    commercial: {
      title,
      description,
      propertyType: dedicatedInfoValue($, "Tipologia"),
      priceAmount: parseInteger(
        cleanText($(".property-page-price, .property-price").first().text()) ??
          extractMeta($, "product:price:amount"),
      ),
      priceCurrency: "EUR",
      surfaceSqm: parseItalianNumber(
        dedicatedInfoValue($, "Superficie") ?? dedicatedInfoValue($, "MQ"),
      ),
      rooms: parseItalianNumber(
        dedicatedInfoValue($, "Vani") ?? dedicatedInfoValue($, "Locali"),
      ),
      bedrooms: parseItalianNumber(dedicatedInfoValue($, "Stanze da letto")),
      bathrooms: parseItalianNumber(dedicatedInfoValue($, "Bagni")),
      floor: dedicatedInfoValue($, "Piano"),
      features: {},
    },
    location: resolveMonitoredGeography({
      rawText: [title, locationText].filter(Boolean).join(" | "),
      postalCode: dedicatedInfoValue($, "CAP"),
    }),
    status: {
      value: status.value,
      sourceLabel: statusLabel,
      confidence: status.confidence,
      evidence: statusEvidence,
    },
    assets,
    marketStart: {
      lowerBound: assetDate?.lowerBound ?? null,
      upperBound: assetDate?.upperBound ?? document.observedAt,
      method: assetDate ? "WORDPRESS_UPLOAD_PATH_YYYY_MM" : "CRAWLER_FIRST_SEEN",
      confidence: assetDate ? 0.4 : 0.3,
      evidence: [marketEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: responseUrl,
      status: responseStatus,
      etag: cleanText(headers.get("etag")),
      lastModified: cleanText(headers.get("last-modified")),
    },
    extractionWarnings: status.value === "UNKNOWN" ? ["missing_dedicated_source_status"] : [],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_html",
      ignoredHttpLastModifiedForMarketStart: true,
    },
  });
}

export class PuntoCasaAdapter implements PropertyLifecycleAdapter {
  readonly key = "puntocasa";
  readonly agencySlug = "puntocasa-bitonto";
  readonly inventoryUrl = PUNTOCASA_INVENTORY_URL;

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
      const diagnostics = {
        expectedCount: null,
        observedCount: 0,
        duplicateCount: 0,
        parseErrorCount: 1,
        pagesVisited: 1,
        expectedPages: 1,
        requiredMarkers: { successfulResponse: false },
        reasons: [`http_status:${response.status}`],
      };
      return {
        items: [],
        healthState: "FAILED",
        complete: false,
        structureFingerprint: structureFingerprint(diagnostics.requiredMarkers),
        diagnostics,
        response,
      };
    }

    const firstPage = parsePuntoCasaInventoryHtml(response.body, response);
    const paginationUrls = extractPuntoCasaPaginationUrls(response.body);
    const allItems = [...firstPage.items];
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let perPageDuplicateCount = firstPage.diagnostics.duplicateCount;
    let pagesVisited = 1;
    const reasons = [...firstPage.diagnostics.reasons];
    let excludedTransactionCount = Number(
      firstPage.diagnostics.reasons
        .find((reason) => reason.startsWith("non_sale_inventory_records_excluded:"))
        ?.split(":")[1] ?? 0,
    );

    for (const pageUrl of paginationUrls) {
      const pageResponse = await this.http.get(pageUrl);
      if (!pageResponse.ok) {
        parseErrorCount += 1;
        reasons.push(`pagination_http_status:${pageResponse.status}:${pageUrl}`);
        continue;
      }

      const page = parsePuntoCasaInventoryHtml(pageResponse.body, pageResponse);
      allItems.push(...page.items);
      parseErrorCount += page.diagnostics.parseErrorCount;
      perPageDuplicateCount += page.diagnostics.duplicateCount;
      pagesVisited += 1;
      excludedTransactionCount += Number(
        page.diagnostics.reasons
          .find((reason) => reason.startsWith("non_sale_inventory_records_excluded:"))
          ?.split(":")[1] ?? 0,
      );
    }

    const deduplicated = deduplicateInventoryItems(allItems);
    const rawExpectedCount = firstPage.diagnostics.expectedCount;
    const diagnostics = {
      ...firstPage.diagnostics,
      expectedCount:
        rawExpectedCount == null
          ? null
          : Math.max(0, rawExpectedCount - excludedTransactionCount),
      observedCount: deduplicated.items.length,
      duplicateCount: perPageDuplicateCount + deduplicated.duplicateCount,
      parseErrorCount,
      pagesVisited,
      expectedPages: paginationUrls.length + 1,
      reasons: [
        ...reasons.filter(
          (reason) => !reason.startsWith("non_sale_inventory_records_excluded:"),
        ),
        ...(excludedTransactionCount > 0
          ? [`non_sale_inventory_records_excluded:${excludedTransactionCount}`]
          : []),
      ],
    };
    const health = classifyInventoryHealth(diagnostics);

    return {
      ...firstPage,
      items: deduplicated.items,
      healthState: health.state,
      complete: health.complete,
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
      throw new Error(`PuntoCasa detail ${item.url} returned HTTP ${response.status}.`);
    }

    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizePuntoCasaDetail(document);
  }
}
