import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { parseItalianDate } from "@/lib/scrapers/date-parser";
import { fetchHtml, stripHtml } from "@/lib/scrapers/html";
import { extractJsonLd, extractMetaTags } from "@/lib/scrapers/metadata";
import {
  cleanText,
  hashDescription,
  normalizeUrl,
  parsePrice,
  parseRooms,
  parseSqm,
} from "@/lib/scrapers/parsers";
import type {
  ListingsProvider,
  ProviderRunIssueType,
  ProviderRunLog,
} from "@/lib/scrapers/providers/types";
import type { NormalizedListing } from "@/types";

type JsonObject = Record<string, unknown>;

let lastRunLog: ProviderRunLog | null = null;

function createRunLog(): ProviderRunLog {
  return {
    provider: "admaiora",
    searchUrls: [SCRAPER_CONFIG.admaiora.searchUrl],
    foundUrls: 0,
    detailPagesRead: 0,
    errors: [],
  };
}

function logIssue(
  runLog: ProviderRunLog,
  type: ProviderRunIssueType,
  message: string,
  url?: string,
  details?: Record<string, unknown> | null,
) {
  runLog.errors.push({
    type,
    message,
    url,
    details: details ?? null,
  });

  console.warn(`[admaiora] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenJsonObjects(value: unknown, objects: JsonObject[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenJsonObjects(item, objects);
    }
  } else if (isObject(value)) {
    objects.push(value);

    for (const child of Object.values(value)) {
      flattenJsonObjects(child, objects);
    }
  }

  return objects;
}

function findFirstJsonString(jsonLd: unknown[], keys: string[]) {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  for (const object of flattenJsonObjects(jsonLd)) {
    for (const [key, value] of Object.entries(object)) {
      if (!keySet.has(key.toLowerCase()) || typeof value !== "string") {
        continue;
      }

      const cleaned = cleanText(value);

      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
}

function getMeta(meta: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = meta[key.toLowerCase()];

    if (value) {
      return cleanText(value);
    }
  }

  return null;
}

function extractListingUrls(html: string) {
  const urls = new Set<string>();
  const pattern =
    /https:\/\/www\.admaioraimmobiliare\.it\/immobile\/[^"'<>\\\s]+\/?/gi;

  for (const match of html.matchAll(pattern)) {
    try {
      urls.add(normalizeUrl(match[0]));
    } catch {
      // Ignore malformed URLs in theme markup.
    }
  }

  return [...urls];
}

function extractHtmlTitle(html: string) {
  const h1Match = html.match(/<h1\b[^>]*class=["'][^"']*rh_page__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);

  if (h1Match?.[1]) {
    return stripHtml(h1Match[1]);
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  return titleMatch?.[1] ? stripHtml(titleMatch[1]) : null;
}

function extractAddress(html: string) {
  const addressMatch = html.match(
    /<p\b[^>]*class=["'][^"']*rh_page__property_address[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  );

  return addressMatch?.[1] ? stripHtml(addressMatch[1]) : null;
}

function extractPrice(html: string) {
  const priceBlockMatch = html.match(
    /<div\b[^>]*class=["'][^"']*rh_page__property_price[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const priceText = priceBlockMatch?.[1] ? stripHtml(priceBlockMatch[1]) : null;

  return parsePrice(priceText);
}

function extractPropertyId(html: string, url: string) {
  const idMatch = html.match(
    /<p\b[^>]*class=["'][^"']*\bid\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  );
  const id = idMatch?.[1] ? stripHtml(idMatch[1]).replace(/\D+/g, "") : null;

  if (id) {
    return id;
  }

  return new URL(url).pathname.replace(/^\/immobile\//, "").replace(/\/$/, "");
}

function extractMetaNumber(html: string, className: string) {
  const pattern = new RegExp(
    `<div\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<span\\b[^>]*class=["'][^"']*figure[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`,
    "i",
  );
  const match = html.match(pattern);
  const rawValue = match?.[1] ? stripHtml(match[1]) : null;

  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

function extractDescription(html: string, fallback: string | null) {
  const contentMatch = html.match(
    /<div\b[^>]*id=["']property-content-section-content["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*rh_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const description = contentMatch?.[1] ? stripHtml(contentMatch[1]) : null;

  return description || fallback;
}

function extractImageUrls(html: string, meta: Record<string, string>) {
  const urls = new Set<string>();
  const galleryHtml =
    html.match(
      /<div\b[^>]*id=["']property-detail-slider-two["'][^>]*>[\s\S]*?(?:<div\b[^>]*id=["']property-detail-slider-carousel-nav["']|<div\b[^>]*class=["'][^"']*\brh_property__meta_wrap\b)/i,
    )?.[0] ??
    html.match(
      /<div\b[^>]*class=["'][^"']*\bproperty-detail-slider-wrapper\b[^"']*["'][^>]*>[\s\S]*?(?:<div\b[^>]*class=["'][^"']*\brh_property__meta_wrap\b|<section\b[^>]*id=["']property-content-section["'])/i,
    )?.[0] ??
    "";
  const urlPatterns = [
    /\b(?:href|src|data-src)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi,
    /\bsrcset=["']([^"']+)["']/gi,
    /background-image\s*:\s*url\(["']?([^"')]+\.(?:jpe?g|png|webp)(?:\?[^"')]+)?)["']?\)/gi,
  ];

  function add(value: string | undefined) {
    if (
      !value ||
      /(?:logo|banner|cropped|favicon|icon|facebook|instagram|youtube|whatsapp|linkedin|emoji|schema\/logo)/i.test(
        value,
      )
    ) {
      return;
    }

    try {
      const url = new URL(value.replace(/&amp;/gi, "&"), SCRAPER_CONFIG.admaiora.baseUrl);

      if (
        url.hostname === "www.admaioraimmobiliare.it" &&
        /\/wp-content\/uploads\//i.test(url.pathname)
      ) {
        url.pathname = url.pathname.replace(
          /-\d+x\d+(\.(?:jpe?g|png|webp))$/i,
          "$1",
        );
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed image URLs from theme markup.
    }
  }

  for (const pattern of urlPatterns) {
    for (const match of galleryHtml.matchAll(pattern)) {
      if (pattern.source.includes("srcset")) {
        const candidates = (match[1] ?? "")
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/)[0])
          .filter(Boolean);

        for (const candidate of candidates) {
          add(candidate);
        }
      } else {
        add(match[1]);
      }
    }
  }

  add(meta["og:image"]);
  add(meta["twitter:image"]);

  return [...urls].slice(0, 50);
}

function extractPhone(visibleText: string) {
  const match = visibleText.match(
    /(?:\+39\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{1,3}[\s.-]?\d{5,8})/,
  );

  return match?.[0]?.replace(/[^\d+]/g, "") ?? null;
}

function normalizeListingFromDetail(url: string, html: string) {
  const meta = extractMetaTags(html);
  const jsonLd = extractJsonLd(html);
  const visibleText = stripHtml(html);
  const canonicalUrl = normalizeUrl(getMeta(meta, "canonical", "og:url") ?? url);
  const title =
    extractHtmlTitle(html) ??
    findFirstJsonString(jsonLd, ["name", "headline"]) ??
    getMeta(meta, "og:title", "twitter:title");

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const metadataDatePublished = parseItalianDate(
    findFirstJsonString(jsonLd, ["datePublished"]) ??
      getMeta(meta, "article:published_time"),
  );
  const metadataDateModified = parseItalianDate(
    findFirstJsonString(jsonLd, ["dateModified"]) ??
      getMeta(meta, "article:modified_time"),
  );
  const description = extractDescription(
    html,
    findFirstJsonString(jsonLd, ["description"]) ??
      getMeta(meta, "og:description", "description"),
  );
  const addressRaw = extractAddress(html);
  const rooms = extractMetaNumber(html, "prop_bedrooms") ?? parseRooms(title);
  const sqm = extractMetaNumber(html, "prop_area") ?? parseSqm(description);
  const imageUrls = extractImageUrls(html, meta);
  const now = new Date().toISOString();

  return {
    source: "admaiora",
    sourceListingId: extractPropertyId(html, canonicalUrl),
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: extractPrice(html),
    sqm: sqm == null ? null : Math.round(sqm),
    rooms,
    floor: cleanText(`${title} ${description}`).match(
      /\b(?:piano|al)\s+(terra|rialzato|seminterrato|interrato|[0-9]{1,2})\b/i,
    )?.[1] ?? null,
    zone: addressRaw?.includes("Bitonto") ? addressRaw : SCRAPER_CONFIG.monitoredCity,
    addressRaw,
    sellerType: "agency",
    sellerName: "Ad Maiora Immobiliare",
    phone: extractPhone(visibleText),
    imageUrls,
    portalDeclaredDate: metadataDatePublished,
    metadataDatePublished,
    metadataDateModified,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: "admaiora",
      extractedAt: now,
      meta,
      jsonLd,
      imageUrls,
      descriptionHash: hashDescription(description),
    },
  } satisfies NormalizedListing;
}

export const admaioraProvider: ListingsProvider = {
  name: "admaiora",
  async fetchListings(): Promise<NormalizedListing[]> {
    const runtimeConfig = getScraperRuntimeConfig();
    const runLog = createRunLog();
    const listings: NormalizedListing[] = [];

    lastRunLog = runLog;

    let searchHtml: string;

    try {
      searchHtml = await fetchHtml(SCRAPER_CONFIG.admaiora.searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch Ad Maiora search page.", SCRAPER_CONFIG.admaiora.searchUrl, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const detailUrls = extractListingUrls(searchHtml).slice(
      0,
      runtimeConfig.maxDetailPages,
    );

    runLog.foundUrls = detailUrls.length;

    if (detailUrls.length === 0) {
      logIssue(
        runLog,
        "search",
        "No listing URLs extracted from Ad Maiora search page.",
        SCRAPER_CONFIG.admaiora.searchUrl,
      );
      return [];
    }

    for (const [index, detailUrl] of detailUrls.entries()) {
      if (index > 0) {
        await delay(runtimeConfig.detailDelayMs);
      }

      try {
        const detailHtml = await fetchHtml(detailUrl);
        runLog.detailPagesRead += 1;
        listings.push(normalizeListingFromDetail(detailUrl, detailHtml));
      } catch (error) {
        logIssue(runLog, "parse", "Unable to read or parse Ad Maiora detail page.", detailUrl, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return listings;
  },
  getLastRunLog() {
    return lastRunLog;
  },
};
