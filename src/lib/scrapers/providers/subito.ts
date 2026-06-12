import { SCRAPER_CONFIG, getScraperRuntimeConfig, getSubitoSearchUrl } from "@/lib/scrapers/config";
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
import type { NormalizedListing, SellerType } from "@/types";

type JsonObject = Record<string, unknown>;

const DETAIL_PATHS = [
  "appartamenti",
  "ville-singole-e-a-schiera",
  "immobili",
  "terreni-e-rustici",
  "garage-e-box",
  "uffici-e-locali-commerciali",
  "case-vacanza",
];

let lastRunLog: ProviderRunLog | null = null;

function createRunLog(): ProviderRunLog {
  return {
    provider: "subito",
    searchUrls: [],
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

  console.warn(`[subito] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value === "string") {
    return cleanText(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const numeric = Number(value.replace(/\./g, "").replace(",", "."));

    if (Number.isFinite(numeric)) {
      return Math.round(numeric);
    }

    return parsePrice(value);
  }

  return null;
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

function findFirstString(jsonLd: unknown[], keys: string[]) {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  for (const object of flattenJsonObjects(jsonLd)) {
    for (const [key, value] of Object.entries(object)) {
      if (!keySet.has(key.toLowerCase())) {
        continue;
      }

      const stringValue = asString(value);

      if (stringValue) {
        return stringValue;
      }
    }
  }

  return null;
}

function findFirstNumber(jsonLd: unknown[], keys: string[]) {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  for (const object of flattenJsonObjects(jsonLd)) {
    for (const [key, value] of Object.entries(object)) {
      if (!keySet.has(key.toLowerCase())) {
        continue;
      }

      const numberValue = asNumber(value);

      if (numberValue != null) {
        return numberValue;
      }
    }
  }

  return null;
}

function findNestedString(jsonLd: unknown[], parentKeys: string[], childKeys: string[]) {
  const parentKeySet = new Set(parentKeys.map((key) => key.toLowerCase()));
  const childKeySet = new Set(childKeys.map((key) => key.toLowerCase()));

  for (const object of flattenJsonObjects(jsonLd)) {
    for (const [key, value] of Object.entries(object)) {
      if (!parentKeySet.has(key.toLowerCase())) {
        continue;
      }

      for (const nestedObject of flattenJsonObjects(value)) {
        for (const [childKey, childValue] of Object.entries(nestedObject)) {
          if (!childKeySet.has(childKey.toLowerCase())) {
            continue;
          }

          const stringValue = asString(childValue);

          if (stringValue) {
            return stringValue;
          }
        }
      }
    }
  }

  return null;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? null;
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

function extractHtmlTitle(html: string) {
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);

  if (h1Match?.[1]) {
    return stripHtml(h1Match[1]);
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  return titleMatch?.[1] ? stripHtml(titleMatch[1]) : null;
}

function cleanTitle(title: string | null) {
  return title
    ?.replace(/\s*[-|]\s*Subito\.it\s*$/i, "")
    .replace(/\s*-\s*Annunci\s+Subito\s*$/i, "")
    .trim() ?? null;
}

function extractSourceListingId(url: string) {
  return url.match(/-(\d+)\.htm(?:[?#].*)?$/)?.[1] ?? null;
}

function parseFloor(text: string) {
  const normalized = cleanText(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\bsu piu livelli\b/.test(normalized)) {
    return "su piu livelli";
  }

  const floorMatch = normalized.match(
    /\b(?:piano|p\.)\s*(terra|rialzato|seminterrato|interrato|t|[0-9]{1,2}\s*[°o]?)/i,
  );

  return floorMatch?.[1]?.trim() ?? null;
}

function parsePhoneFromVisibleText(text: string) {
  const match = text.match(
    /(?:\+39\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{1,3}[\s.-]?\d{5,8})/,
  );

  return match?.[0]?.replace(/[^\d+]/g, "") ?? null;
}

function parseSellerName(jsonLd: unknown[], visibleText: string) {
  const jsonSeller = findNestedString(
    jsonLd,
    ["seller", "provider", "author", "publisher"],
    ["name"],
  );

  if (jsonSeller) {
    return jsonSeller;
  }

  const agencyMatch = visibleText.match(
    /\b(Agenzia\s+[A-Z0-9][A-Z0-9 .,'&-]{2,80})(?:\s+Mostra\s+numero|\s+Pubblicato|\s*$)/i,
  );

  return agencyMatch?.[1] ? cleanText(agencyMatch[1]) : null;
}

function parseSellerType(sellerName: string | null, visibleText: string): SellerType {
  const value = `${sellerName ?? ""} ${visibleText}`.toLowerCase();

  if (/\bprivato\b|\bno agenzie\b/.test(value)) {
    return "private";
  }

  if (
    /\bagenzia\b|immobiliare|tecnocasa|re\/max|rockagent|studio\s+immobiliare/.test(
      value,
    )
  ) {
    return "agency";
  }

  return "unknown";
}

function extractAddress(jsonLd: unknown[], visibleText: string) {
  const street = findNestedString(jsonLd, ["address"], ["streetAddress"]);
  const locality =
    findNestedString(jsonLd, ["address"], ["addressLocality"]) ??
    findFirstString(jsonLd, ["addressLocality"]);
  const region = findNestedString(jsonLd, ["address"], ["addressRegion"]);
  const address = [street, locality, region].filter(Boolean).join(", ");

  if (address) {
    return address;
  }

  const bitontoMatch = visibleText.match(/(?:zona\s+)?[A-Z][A-Za-z .'-]{0,50}Bitonto\s*\(BA\)/);

  return bitontoMatch?.[0] ? cleanText(bitontoMatch[0]) : null;
}

function extractZone(addressRaw: string | null, visibleText: string) {
  if (addressRaw?.toLowerCase().includes("bitonto")) {
    return addressRaw;
  }

  const cityMatch = visibleText.match(/\bBitonto\s*\(BA\)/i);

  if (cityMatch) {
    return "Bitonto (BA)";
  }

  return SCRAPER_CONFIG.monitoredCity;
}

function extractDateFromVisibleText(visibleText: string) {
  const match = visibleText.match(
    /\b(?:pubblicato|inserito|aggiornato)\b.{0,80}?(?:oggi|ieri|\d{1,2}[/. -]\d{1,2}(?:[/. -]\d{2,4})?|\d{1,2}\s+[a-z]+(?:\s+\d{4})?|\d+\s+(?:minuti|ore|giorni|settimane|mesi|anni)\s+fa)/i,
  );

  return match?.[0] ? parseItalianDate(match[0]) : null;
}

function toReadableMarkup(html: string) {
  return html
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

function isSubitoListingUrl(value: string) {
  return (
    value.startsWith("https://www.subito.it/") &&
    value.includes(".htm") &&
    DETAIL_PATHS.some((path) => value.includes(`/${path}/`))
  );
}

function collectUrlsFromJson(value: unknown, urls: Set<string>) {
  if (typeof value === "string") {
    const readable = toReadableMarkup(value);

    if (readable.includes("subito.it") && readable.includes(".htm")) {
      try {
        const normalized = normalizeUrl(readable);

        if (isSubitoListingUrl(normalized)) {
          urls.add(normalized);
        }
      } catch {
        // Ignore malformed values in portal data.
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlsFromJson(item, urls);
    }
  } else if (isObject(value)) {
    for (const child of Object.values(value)) {
      collectUrlsFromJson(child, urls);
    }
  }
}

function extractListingUrls(html: string) {
  const urls = new Set<string>();
  const readableHtml = toReadableMarkup(html);
  const jsonLd = extractJsonLd(readableHtml);

  collectUrlsFromJson(jsonLd, urls);

  const absolutePattern = new RegExp(
    `https://www\\.subito\\.it/(?:${DETAIL_PATHS.join("|")})/[^"'<>\\\\\\s]+?\\.htm(?:\\?[^"'<>\\\\\\s]*)?`,
    "gi",
  );
  const relativePattern = new RegExp(
    `href=["'](/(?:${DETAIL_PATHS.join("|")})/[^"']+?\\.htm(?:\\?[^"']*)?)["']`,
    "gi",
  );

  for (const match of readableHtml.matchAll(absolutePattern)) {
    try {
      urls.add(normalizeUrl(match[0]));
    } catch {
      // Ignore malformed hrefs.
    }
  }

  for (const match of readableHtml.matchAll(relativePattern)) {
    if (!match[1]) {
      continue;
    }

    try {
      urls.add(normalizeUrl(match[1]));
    } catch {
      // Ignore malformed hrefs.
    }
  }

  return [...urls].filter(isSubitoListingUrl);
}

function normalizeListingFromDetail(url: string, html: string, searchUrl: string) {
  const jsonLd = extractJsonLd(html);
  const meta = extractMetaTags(html);
  const visibleText = stripHtml(html);
  const canonicalUrl = normalizeUrl(getMeta(meta, "canonical", "og:url") ?? url);
  const title = cleanTitle(
    firstNonEmpty(
      findFirstString(jsonLd, ["headline", "name"]),
      getMeta(meta, "og:title", "twitter:title"),
      extractHtmlTitle(html),
    ),
  );

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const description = firstNonEmpty(
    findFirstString(jsonLd, ["description"]),
    getMeta(meta, "og:description", "description", "twitter:description"),
  );
  const contentForParsers = [title, description, visibleText].filter(Boolean).join(" ");
  const price =
    findFirstNumber(jsonLd, ["price"]) ??
    asNumber(getMeta(meta, "product:price:amount", "og:price:amount")) ??
    parsePrice(contentForParsers);
  const addressRaw = extractAddress(jsonLd, visibleText);
  const sellerName = parseSellerName(jsonLd, visibleText);
  const metadataDatePublished =
    parseItalianDate(
      firstNonEmpty(
        findFirstString(jsonLd, ["datePublished", "uploadDate"]),
        getMeta(meta, "article:published_time", "date"),
      ),
    ) ?? extractDateFromVisibleText(visibleText);
  const metadataDateModified = parseItalianDate(
    firstNonEmpty(
      findFirstString(jsonLd, ["dateModified"]),
      getMeta(meta, "article:modified_time", "last-modified"),
    ),
  );
  const now = new Date().toISOString();
  const listing: NormalizedListing = {
    source: "subito",
    sourceListingId: extractSourceListingId(canonicalUrl) ?? extractSourceListingId(url),
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price,
    sqm: parseSqm(contentForParsers),
    rooms: parseRooms(contentForParsers),
    floor: parseFloor(contentForParsers),
    zone: extractZone(addressRaw, visibleText),
    addressRaw,
    sellerType: parseSellerType(sellerName, visibleText),
    sellerName,
    phone: parsePhoneFromVisibleText(visibleText),
    portalDeclaredDate: metadataDatePublished,
    metadataDatePublished,
    metadataDateModified,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: "subito",
      searchUrl,
      extractedAt: now,
      meta,
      jsonLd,
      descriptionHash: hashDescription(description),
    },
  };

  return listing;
}

export async function fetchListings(): Promise<NormalizedListing[]> {
  const runtimeConfig = getScraperRuntimeConfig();
  const runLog = createRunLog();
  const listings: NormalizedListing[] = [];

  lastRunLog = runLog;

  for (let page = 1; page <= runtimeConfig.maxSearchPages; page += 1) {
    const searchUrl = getSubitoSearchUrl(page);
    runLog.searchUrls.push(searchUrl);

    let searchHtml: string;

    try {
      searchHtml = await fetchHtml(searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch Subito search page.", searchUrl, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const detailUrls = extractListingUrls(searchHtml).slice(
      0,
      runtimeConfig.maxDetailPages,
    );

    runLog.foundUrls += detailUrls.length;
    console.info("[subito] search page parsed", {
      searchUrl,
      foundUrls: detailUrls.length,
      maxDetailPages: runtimeConfig.maxDetailPages,
    });

    if (detailUrls.length === 0) {
      logIssue(
        runLog,
        "search",
        "No listing URLs extracted from Subito search page.",
        searchUrl,
        {
          page,
          monitoredCity: SCRAPER_CONFIG.monitoredCity,
          htmlTitle: extractHtmlTitle(searchHtml),
        },
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
        listings.push(normalizeListingFromDetail(detailUrl, detailHtml, searchUrl));
      } catch (error) {
        logIssue(runLog, "parse", "Unable to read or parse Subito detail page.", detailUrl, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return listings;
}

export const subitoProvider: ListingsProvider = {
  name: "subito",
  fetchListings,
  getLastRunLog() {
    return lastRunLog;
  },
};
