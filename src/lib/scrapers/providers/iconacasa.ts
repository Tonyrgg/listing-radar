import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { fetchHtml, stripHtml } from "@/lib/scrapers/html";
import { extractMetaTags } from "@/lib/scrapers/metadata";
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

let lastRunLog: ProviderRunLog | null = null;

function createRunLog(): ProviderRunLog {
  return {
    provider: "iconacasa",
    searchUrls: [SCRAPER_CONFIG.iconacasa.searchUrl],
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

  console.warn(`[iconacasa] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractListingUrls(html: string) {
  const urls = new Set<string>();
  const hrefPattern = /\bhref=["']([^"']*\/index\.php\/opportunita\/property\/[^"']+)["']/gi;

  for (const match of html.matchAll(hrefPattern)) {
    const value = match[1];

    if (!value || !/vendita/i.test(value) || /affitto/i.test(value)) {
      continue;
    }

    try {
      urls.add(normalizeUrl(new URL(value, SCRAPER_CONFIG.iconacasa.baseUrl).toString()));
    } catch {
      // Ignore malformed links from template markup.
    }
  }

  return [...urls];
}

function extractTitle(html: string, metaTitle: string | undefined) {
  const pageTitleMatch = html.match(
    /<h3\b[^>]*class=["'][^"']*\bpage_title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
  );
  const propertyTitleMatch = html.match(
    /<h4\b[^>]*class=["'][^"']*\bproperty-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i,
  );
  const rawTitle =
    (pageTitleMatch?.[1] ? stripHtml(pageTitleMatch[1]) : null) ??
    (propertyTitleMatch?.[1] ? stripHtml(propertyTitleMatch[1]) : null) ??
    cleanText(metaTitle);

  return rawTitle.replace(/\s*€\s*\d[\d.\s]*(?:,\d{1,2})?\s*$/i, "").trim();
}

function extractPrice(html: string) {
  const subnavPrice = extractSubnavValue(html, "Prezzo");
  const pageTitleMatch = html.match(
    /<h3\b[^>]*class=["'][^"']*\bpage_title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
  );
  const rawPageTitle = pageTitleMatch?.[1] ? stripHtml(pageTitleMatch[1]) : null;
  const currencyFirstAmount = [subnavPrice, rawPageTitle]
    .filter(Boolean)
    .join(" ")
    .match(/€\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{1,2})?/i)?.[1];

  return (
    parsePrice(subnavPrice) ??
    parsePrice(rawPageTitle) ??
    (currencyFirstAmount
      ? Number(currencyFirstAmount.replace(/\s/g, "").replace(/\./g, ""))
      : null)
  );
}

function extractLocation(html: string) {
  const locationMatch = html.match(
    /<div\b[^>]*class=["'][^"']*\bpage_location\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const location = locationMatch?.[1] ? stripHtml(locationMatch[1]) : null;

  if (!location) {
    return null;
  }

  return location
    .replace(/\b(?:appartamento|box|villa|casa indipendente|semi indipendente)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSubnavValue(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<p\\b[^>]*class=["'][^"']*customlabel[^"']*["'][^>]*>[\\s\\S]*?<span\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/span>\\s*<br\\s*\\/?>\\s*([\\s\\S]*?)<\\/p>`,
    "i",
  );
  const match = html.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  return stripHtml(match[1])
    .replace(/\s*€\s*\d+(?:[,.]\d+)?\s*\/\s*mese.*$/i, "")
    .trim();
}

function extractInfoValue(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<li\\b[^>]*>\\s*${escaped}\\s*<br\\s*\\/?>\\s*<strong>([\\s\\S]*?)<\\/strong>\\s*<\\/li>`,
    "i",
  );
  const match = html.match(pattern);

  return match?.[1] ? stripHtml(match[1]) : null;
}

function extractDescription(html: string, fallback: string | undefined) {
  const descriptionMatch = html.match(
    /<div\b[^>]*class=["'][^"']*\bproperty-text\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bfleft\b[^"']*["'][^>]*>[\s\S]*?<\/span>[\s\S]*?<br\s*\/?>\s*<br\s*\/?>([\s\S]*?)<\/div>\s*<\/div>\s*<br\s*\/?>/i,
  );
  const description = descriptionMatch?.[1] ? stripHtml(descriptionMatch[1]) : null;

  return description || cleanText(fallback) || null;
}

function extractPhone(text: string) {
  const match = text.match(
    /(?:\+39\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{1,3}[\s.-]?\d{5,8})/,
  );

  return match?.[0]?.replace(/[^\d+]/g, "") ?? null;
}

function extractImageUrls(html: string) {
  const urls = new Set<string>();
  const imagePattern =
    /\b(?:href|src)=["']((?:https?:\/\/[^"']+)?\/media\/com_iproperty\/pictures\/[^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;

  for (const match of html.matchAll(imagePattern)) {
    const value = match[1];

    if (!value) {
      continue;
    }

    try {
      const url = new URL(value, SCRAPER_CONFIG.iconacasa.baseUrl);
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed image URLs.
    }
  }

  const ogImage = extractMetaTags(html)["og:image"];

  if (ogImage) {
    try {
      const url = new URL(ogImage, SCRAPER_CONFIG.iconacasa.baseUrl);
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed image URLs.
    }
  }

  return [...urls].slice(0, 40);
}

function extractSourceListingId(url: string) {
  return (
    new URL(url).pathname.match(/\/property\/(\d+)-/)?.[1] ??
    new URL(url).pathname.replace(/^\/index\.php\/opportunita\/property\//, "")
  );
}

function normalizeListingFromDetail(url: string, html: string): NormalizedListing {
  const meta = extractMetaTags(html);
  const canonicalUrl = normalizeUrl(meta["og:url"] ?? meta["ic:base"] ?? url);
  const title = extractTitle(html, meta["og:title"]);

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const visibleText = stripHtml(html);
  const description = extractDescription(html, meta["og:description"]);
  const location = extractLocation(html);
  const contentForParsers = [title, location, description].filter(Boolean).join(" ");
  const rawArea = extractSubnavValue(html, "Area");
  const now = new Date().toISOString();

  return {
    source: "iconacasa",
    sourceListingId: extractSourceListingId(canonicalUrl),
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: extractPrice(html),
    sqm: parseSqm(rawArea ? `${rawArea} mq` : null) ?? parseSqm(contentForParsers),
    rooms: parseRooms(extractSubnavValue(html, "Locali")) ?? parseRooms(contentForParsers),
    floor: extractInfoValue(html, "Piano") ?? contentForParsers.match(/\bpiano\s+([a-z0-9 ]{2,20})/i)?.[1]?.trim() ?? null,
    zone: location || SCRAPER_CONFIG.monitoredCity,
    addressRaw: location,
    sellerType: "agency",
    sellerName: "Iconacasa Bitonto Piazza Aldo Moro",
    phone: extractPhone(visibleText),
    imageUrls: extractImageUrls(html),
    portalDeclaredDate: null,
    metadataDatePublished: null,
    metadataDateModified: null,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: "iconacasa",
      extractedAt: now,
      meta,
      location,
      descriptionHash: hashDescription(description),
      extra: {
        area: rawArea,
        bagni: extractSubnavValue(html, "Bagni"),
        tipo: extractInfoValue(html, "Tipo"),
        giardinoAtrio: extractInfoValue(html, "Giardino/Atrio"),
        piani: extractInfoValue(html, "Piani"),
        postoAuto: extractInfoValue(html, "Posto auto"),
        garageBox: extractInfoValue(html, "Garage/Box"),
      },
    },
  };
}

export const iconacasaProvider: ListingsProvider = {
  name: "iconacasa",
  async fetchListings(): Promise<NormalizedListing[]> {
    const runtimeConfig = getScraperRuntimeConfig();
    const runLog = createRunLog();
    const listings: NormalizedListing[] = [];

    lastRunLog = runLog;

    let searchHtml: string;

    try {
      searchHtml = await fetchHtml(SCRAPER_CONFIG.iconacasa.searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch Iconacasa search page.", SCRAPER_CONFIG.iconacasa.searchUrl, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const extractedDetailUrls = extractListingUrls(searchHtml);
    const detailUrls = extractedDetailUrls.slice(
      0,
      runtimeConfig.maxDetailPages,
    );

    runLog.foundUrls = extractedDetailUrls.length;

    if (detailUrls.length === 0) {
      logIssue(
        runLog,
        "search",
        "No listing URLs extracted from Iconacasa search page.",
        SCRAPER_CONFIG.iconacasa.searchUrl,
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
        logIssue(runLog, "parse", "Unable to read or parse Iconacasa detail page.", detailUrl, {
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
