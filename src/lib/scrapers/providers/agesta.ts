import { getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { extractListingCoordinates } from "@/lib/listings/coordinates";
import { fetchHtml, stripHtml } from "@/lib/scrapers/html";
import { extractMetaTags } from "@/lib/scrapers/metadata";
import {
  cleanText,
  hashDescription,
  normalizeUrl,
} from "@/lib/scrapers/parsers";
import type {
  ListingsProvider,
  ProviderRunIssueType,
  ProviderRunLog,
} from "@/lib/scrapers/providers/types";
import type { NormalizedListing } from "@/types";

type AgestaProviderConfig = {
  name: string;
  source: string;
  agencyName: string;
  baseUrl: string;
  searchUrl: string;
};

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

  console.warn(`[${runLog.provider}] ${message}`, { url, details });
}

function getValueTextById(html: string, id: string) {
  const pattern = new RegExp(
    `<[^>]+\\bid=["']${id}["'][^>]*>[\\s\\S]*?<span\\b[^>]*class=["'][^"']*valore[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`,
    "i",
  );
  const match = html.match(pattern);

  return match?.[1] ? stripHtml(match[1]) : null;
}

function getDataValueById(html: string, id: string) {
  const pattern = new RegExp(
    `<[^>]+\\bid=["']${id}["'][^>]*\\bdata-valore=["']([^"']*)["'][^>]*>`,
    "i",
  );

  return html.match(pattern)?.[1]?.trim() ?? null;
}

function getInputValue(html: string, name: string) {
  const inputPattern = new RegExp(
    `<input\\b[^>]*\\bname=["']${name}["'][^>]*>`,
    "i",
  );
  const input = html.match(inputPattern)?.[0];

  if (!input) {
    return null;
  }

  return input.match(/\bvalue=["']([^"']*)["']/i)?.[1]?.trim() ?? null;
}

function parseNumericValue(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractTitle(html: string, meta: Record<string, string>) {
  const headingMatch = html.match(
    /<h2\b[^>]*class=["'][^"']*no-btm[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
  );

  if (headingMatch?.[1]) {
    return stripHtml(headingMatch[1]);
  }

  return meta["og:title"]?.replace(/\s*-\s*rif\..*$/i, "").trim() ?? null;
}

function extractDescription(html: string, meta: Record<string, string>) {
  const descriptionMatch = html.match(
    /<div\b[^>]*class=["'][^"']*imm-det-des[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );

  if (descriptionMatch?.[1]) {
    return stripHtml(descriptionMatch[1]);
  }

  return cleanText(meta.description ?? meta["og:description"] ?? "") || null;
}

function extractListingUrls(html: string, baseUrl: string) {
  const urls = new Set<string>();
  const pattern =
    /href=["']([^"']*immobile_dettaglio\.asp\?[^"']*cod_annuncio=\d+[^"']*)["']/gi;

  for (const match of html.matchAll(pattern)) {
    if (!match[1]) {
      continue;
    }

    try {
      urls.add(normalizeUrl(new URL(match[1].replace(/&amp;/gi, "&"), baseUrl).toString()));
    } catch {
      // Ignore malformed links in agency markup.
    }
  }

  return [...urls];
}

function extractPhone(text: string) {
  const match = text.match(
    /(?:\+39\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{1,3}[\s.-]?\d{5,8})/,
  );

  return match?.[0]?.replace(/[^\d+]/g, "") ?? null;
}

function extractImageUrls(
  html: string,
  meta: Record<string, string>,
  config: AgestaProviderConfig,
) {
  const urls = new Set<string>();
  const mainPhotoHtml =
    html.match(
      /<div\b[^>]*id=["']mainfoto["'][^>]*>[\s\S]*?(?:<div\b[^>]*class=["'][^"']*\bimm-det-des\b|<div\b[^>]*class=["'][^"']*\bmap-tab\b|<div\b[^>]*class=["'][^"']*\bcontatti\b)/i,
    )?.[0] ?? html;
  const urlPatterns = [
    /\b(?:href|src|data-src)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi,
    /background-image\s*:\s*url\(["']?([^"')]+\.(?:jpe?g|png|webp)(?:\?[^"')]+)?)["']?\)/gi,
  ];

  function add(value: string | undefined) {
    if (
      !value ||
      /(?:logo|favicon|icon|facebook|instagram|youtube|whatsapp|linkedin|captcha|marker|flag|watermark)/i.test(
        value,
      )
    ) {
      return;
    }

    try {
      const url = new URL(value.replace(/&amp;/gi, "&"), config.baseUrl);

      if (
        /(?:agestanet\.risorseimmobiliari\.it|media\.agestaweb\.it|futurabitonto\.it)/i.test(
          url.hostname,
        )
      ) {
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed image URLs from legacy markup.
    }
  }

  add(meta["og:image"]);
  add(meta["twitter:image"]);

  for (const pattern of urlPatterns) {
    for (const match of mainPhotoHtml.matchAll(pattern)) {
      add(match[1]);
    }
  }

  return [...urls].slice(0, 40);
}

function buildAddress(html: string) {
  const address = getValueTextById(html, "det_indirizzo");
  const city = getValueTextById(html, "det_comune");
  const province = getValueTextById(html, "det_prov");

  return [address, city, province].filter(Boolean).join(", ") || null;
}

function normalizeDetail(
  config: AgestaProviderConfig,
  url: string,
  html: string,
): NormalizedListing {
  const meta = extractMetaTags(html);
  const title = extractTitle(html, meta);

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const description = extractDescription(html, meta);
  const sourceListingId =
    getDataValueById(html, "det_rif") ??
    getInputValue(html, "riferimento_annuncio") ??
    new URL(url).searchParams.get("cod_annuncio");
  const price =
    parseNumericValue(getDataValueById(html, "det_prezzo")) ??
    parseNumericValue(getInputValue(html, "prezzo"));
  const sqm =
    parseNumericValue(getDataValueById(html, "det_superficie")) ??
    parseNumericValue(getInputValue(html, "mq"));
  const rooms =
    parseNumericValue(getDataValueById(html, "det_vani")) ??
    parseNumericValue(getInputValue(html, "vani"));
  const floor =
    getValueTextById(html, "det_piano") ??
    getDataValueById(html, "det_piano") ??
    getInputValue(html, "piani");
  const addressRaw = buildAddress(html);
  const now = new Date().toISOString();
  const canonicalUrl = normalizeUrl(meta["og:url"]?.replace(/&amp;/gi, "&") ?? url);
  const coordinates = extractListingCoordinates({
    html,
    meta,
    source: config.name,
  });

  return {
    source: config.source,
    sourceListingId,
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: price == null ? null : Math.round(price),
    sqm: sqm == null ? null : Math.round(sqm),
    rooms,
    floor,
    zone: getValueTextById(html, "det_comune") ?? "Bitonto",
    addressRaw,
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    coordinatesSource: coordinates?.source ?? null,
    sellerType: "agency",
    sellerName: config.agencyName,
    phone: extractPhone(stripHtml(html)),
    imageUrls: extractImageUrls(html, meta, config),
    portalDeclaredDate: null,
    metadataDatePublished: null,
    metadataDateModified: null,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: config.name,
      extractedAt: now,
      meta,
      coordinates,
      imageUrls: extractImageUrls(html, meta, config),
      descriptionHash: hashDescription(description),
    },
  };
}

export function createAgestaProvider(config: AgestaProviderConfig) {
  let lastRunLog: ProviderRunLog | null = null;

  const provider: ListingsProvider = {
    name: config.name,
    async fetchListings() {
      const runtimeConfig = getScraperRuntimeConfig();
      const runLog: ProviderRunLog = {
        provider: config.name,
        searchUrls: [config.searchUrl],
        foundUrls: 0,
        detailPagesRead: 0,
        errors: [],
      };
      const listings: NormalizedListing[] = [];

      lastRunLog = runLog;

      let searchHtml: string;

      try {
        searchHtml = await fetchHtml(config.searchUrl);
      } catch (error) {
        logIssue(runLog, "fetch", "Unable to fetch agency search page.", config.searchUrl, {
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      }

      const detailUrls = extractListingUrls(searchHtml, config.baseUrl).slice(
        0,
        runtimeConfig.maxDetailPages,
      );

      runLog.foundUrls = detailUrls.length;

      if (detailUrls.length === 0) {
        logIssue(
          runLog,
          "search",
          "No listing URLs extracted from agency search page.",
          config.searchUrl,
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
          listings.push(normalizeDetail(config, detailUrl, detailHtml));
        } catch (error) {
          logIssue(runLog, "parse", "Unable to read or parse agency detail page.", detailUrl, {
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

  return provider;
}
