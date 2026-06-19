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
    provider: "puntocasa",
    searchUrls: [SCRAPER_CONFIG.puntocasa.searchUrl],
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

  console.warn(`[puntocasa] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractListingUrls(html: string) {
  const urls = new Set<string>();
  const pattern =
    /https:\/\/www\.puntocasagroup\.it\/property-item\/[^"'<>\\\s]+\/?/gi;

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
  const headingMatch = html.match(
    /<h2\b[^>]*class=["'][^"']*\bptitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
  );

  if (headingMatch?.[1]) {
    return stripHtml(headingMatch[1]);
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1] ? stripHtml(titleMatch[1]) : null;

  return title?.replace(/\s*-\s*PuntoCasaGroup\s*$/i, "").trim() || null;
}

function extractSubtitle(html: string) {
  const match = html.match(
    /<h4\b[^>]*class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>[\s\S]*?<label\b[^>]*>([\s\S]*?)<\/label>/i,
  );

  return match?.[1] ? stripHtml(match[1]) : null;
}

function extractSourceListingId(html: string, url: string) {
  const match = html.match(
    /<div\b[^>]*class=["'][^"']*\bproperty-page-id\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i,
  );
  const id = match?.[1] ? stripHtml(match[1]) : null;

  if (id) {
    return id;
  }

  return new URL(url).pathname
    .replace(/^\/property-item\//, "")
    .replace(/\/$/, "");
}

function extractDescription(html: string, fallback: string | null) {
  const contentMatch = html.match(
    /<div\b[^>]*class=["'][^"']*\bproperty-content\b[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*\bproperty-info-agent\b|<div\b[^>]*class=["'][^"']*\bproperty-amenities\b|<div\b[^>]*class=["'][^"']*\bshare\b)/i,
  );
  const description = contentMatch?.[1] ? stripHtml(contentMatch[1]) : null;

  return description || fallback;
}

function extractPrice(html: string) {
  const meta = extractMetaTags(html);
  const priceMatch =
    html.match(
      /<span\b[^>]*class=["'][^"']*\bproperty-page-price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    ) ??
    html.match(
      /<[^>]+\bclass=["'][^"']*(?:\bproperty-price\b|\bprice\b)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    ) ??
    html.match(/(\u20ac\s*\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?(?:\s*\/\s*\w+)?)/i);

  return (
    parsePrice(priceMatch?.[1] ? stripHtml(priceMatch[1]) : null) ??
    parsePrice(meta["product:price:amount"] ? `${meta["product:price:amount"]} euro` : null) ??
    parsePrice(meta["og:price:amount"] ? `${meta["og:price:amount"]} euro` : null)
  );
}

function extractInfoValue(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<span\\b[^>]*>[\\s\\S]*?<strong>\\s*${escaped}\\s*:?\\s*<\\/strong>\\s*([\\s\\S]*?)<\\/span>`,
    "i",
  );
  const match = html.match(pattern);

  return match?.[1] ? stripHtml(match[1]) : null;
}

function extractStandaloneMq(html: string) {
  const match = html.match(
    /<div\b[^>]*class=["'][^"']*\bproperty-info-agent\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?MQ[\s\S]*?)<\/span>/i,
  );

  return parseSqm(match?.[1] ? stripHtml(match[1]) : null);
}

function extractImageUrls(html: string) {
  const urls = new Set<string>();
  const srcsetPattern = /\bsrcset=["']([^"']+)["']/gi;
  const srcPattern = /\bsrc=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
  const ogImage = extractMetaTags(html)["og:image"];
  const galleryHtml =
    html.match(
      /<div\b[^>]*class=["'][^"']*\bproperties-flexslider\b[^"']*["'][^>]*>[\s\S]*?(?:<span\b[^>]*class=["'][^"']*\bproperty-page-price\b|<div\b[^>]*class=["'][^"']*\bproperty-info-agent\b)/i,
    )?.[0] ??
    html.match(
      /<div\b[^>]*class=["'][^"']*\bproperty-list-page\b[^"']*["'][^>]*>[\s\S]*?(?:<div\b[^>]*class=["'][^"']*\bproperty-amenities\b|<div\b[^>]*class=["'][^"']*\bshare\b)/i,
    )?.[0] ??
    "";

  function add(value: string | undefined) {
    if (!value || /(?:logo|banner|partner|avatar|emoji|smiley)/i.test(value)) {
      return;
    }

    try {
      const url = new URL(value, SCRAPER_CONFIG.puntocasa.baseUrl);
      url.pathname = url.pathname.replace(
        /-\d+x\d+(\.(?:jpe?g|png|webp))$/i,
        "$1",
      );

      if (
        url.hostname.includes("puntocasagroup.it") &&
        /\/wp-content\/uploads\//i.test(url.pathname)
      ) {
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed image URLs.
    }
  }

  add(ogImage);

  for (const match of galleryHtml.matchAll(srcsetPattern)) {
    const candidates = (match[1] ?? "")
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter(Boolean);

    for (const candidate of candidates) {
      add(candidate);
    }
  }

  for (const match of galleryHtml.matchAll(srcPattern)) {
    add(match[1]);
  }

  return [...urls].slice(0, 40);
}

function extractPhone(text: string) {
  const match = text.match(
    /(?:\+39\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{1,3}[\s.-]?\d{5,8})/,
  );

  return match?.[0]?.replace(/[^\d+]/g, "") ?? null;
}

function normalizeListingFromDetail(url: string, html: string): NormalizedListing {
  const meta = extractMetaTags(html);
  const visibleText = stripHtml(html);
  const canonicalUrl = normalizeUrl(meta["og:url"] ?? url);
  const title =
    extractHtmlTitle(html) ??
    cleanText(meta["og:title"] ?? "").replace(/\s*-\s*PuntoCasaGroup\s*$/i, "");

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const subtitle = extractSubtitle(html);
  const description = extractDescription(
    html,
    cleanText(meta["og:description"] ?? "") || null,
  );
  const contentForParsers = [title, subtitle, description]
    .filter(Boolean)
    .join(" ");
  const now = new Date().toISOString();
  const sqm =
    extractStandaloneMq(html) ??
    parseSqm(extractInfoValue(html, "Superficie")) ??
    parseSqm(contentForParsers);
  const rooms =
    parseRooms(extractInfoValue(html, "Vani")) ??
    parseRooms(extractInfoValue(html, "Stanze da letto")) ??
    parseRooms(contentForParsers);

  return {
    source: "puntocasa",
    sourceListingId: extractSourceListingId(html, canonicalUrl),
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: extractPrice(html),
    sqm: sqm == null ? null : Math.round(sqm),
    rooms,
    floor:
      cleanText(contentForParsers).match(
        /\b(?:piano|al)\s+(terra|rialzato|seminterrato|interrato|ultimo|[0-9]{1,2})\b/i,
      )?.[1] ?? null,
    zone: subtitle?.includes("Bitonto") || title.includes("BITONTO")
      ? "Bitonto"
      : SCRAPER_CONFIG.monitoredCity,
    addressRaw: subtitle,
    sellerType: "agency",
    sellerName: "PuntoCasa Group",
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
      provider: "puntocasa",
      extractedAt: now,
      meta,
      descriptionHash: hashDescription(description),
      subtitle,
    },
  };
}

export const puntocasaProvider: ListingsProvider = {
  name: "puntocasa",
  async fetchListings(): Promise<NormalizedListing[]> {
    const runtimeConfig = getScraperRuntimeConfig();
    const runLog = createRunLog();
    const listings: NormalizedListing[] = [];

    lastRunLog = runLog;

    let searchHtml: string;

    try {
      searchHtml = await fetchHtml(SCRAPER_CONFIG.puntocasa.searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch PuntoCasa search page.", SCRAPER_CONFIG.puntocasa.searchUrl, {
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
        "No listing URLs extracted from PuntoCasa search page.",
        SCRAPER_CONFIG.puntocasa.searchUrl,
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
        logIssue(runLog, "parse", "Unable to read or parse PuntoCasa detail page.", detailUrl, {
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
