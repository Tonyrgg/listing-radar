import * as cheerio from "cheerio";

import { cleanText, normalizeUrl, parsePrice, parseRooms, parseSqm } from "@/lib/scrapers/parsers";
import type { AlertSource, ParsedEmailAlert } from "@/lib/email-alerts/types";

const PORTAL_HOSTS: Record<Exclude<AlertSource, "unknown">, string[]> = {
  idealista: ["idealista.it"],
  immobiliare: ["immobiliare.it"],
  subito: ["subito.it"],
  casa: ["casa.it"],
};

const GENERIC_LINK_LABELS = new Set([
  "apri",
  "apri annuncio",
  "contatta",
  "dettagli",
  "guarda",
  "guarda annuncio",
  "scopri",
  "vedi",
  "vedi annuncio",
]);

type CheerioElement = ReturnType<cheerio.CheerioAPI>;

function unwrapTrackingUrl(value: string) {
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const parsed = new URL(current);
      const nested = ["url", "u", "redirect", "redirect_url", "target", "dest"].find(
        (key) => parsed.searchParams.get(key)?.startsWith("http"),
      );

      if (!nested) {
        return current;
      }

      current = decodeURIComponent(parsed.searchParams.get(nested) ?? current);
    } catch {
      return current;
    }
  }

  return current;
}

function sourceFromUrl(value: string): AlertSource {
  try {
    const hostname = new URL(value).hostname.toLowerCase();

    for (const [source, hosts] of Object.entries(PORTAL_HOSTS)) {
      if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
        return source as AlertSource;
      }
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

function inferSource(sender: string, subject: string, links: string[]): AlertSource {
  const searchable = `${sender} ${subject}`.toLowerCase();

  for (const source of Object.keys(PORTAL_HOSTS) as Array<
    Exclude<AlertSource, "unknown">
  >) {
    if (searchable.includes(source)) {
      return source;
    }
  }

  for (const link of links) {
    const source = sourceFromUrl(unwrapTrackingUrl(link));

    if (source !== "unknown") {
      return source;
    }
  }

  return "unknown";
}

function isDetailUrl(source: AlertSource, value: string) {
  const lowered = value.toLowerCase();

  switch (source) {
    case "idealista":
      return /idealista\.it\/immobile\/\d+/.test(lowered);
    case "immobiliare":
      return /immobiliare\.it\/annunci\/\d+/.test(lowered);
    case "subito":
      return /subito\.it\/(?:appartamenti|ville-singole-e-a-schiera|loft-mansarde|rustici-terreni|uffici-locali-commerciali)\//.test(
        lowered,
      );
    case "casa":
      return /casa\.it\/immobili\//.test(lowered);
    default:
      return false;
  }
}

function extractSourceListingId(source: AlertSource, value: string) {
  const patterns: Partial<Record<AlertSource, RegExp>> = {
    idealista: /\/immobile\/(\d+)/i,
    immobiliare: /\/annunci\/(\d+)/i,
    subito: /-(\d+)\.htm/i,
    casa: /\/immobili\/(\d+)/i,
  };
  const pattern = patterns[source];

  return pattern?.exec(value)?.[1] ?? null;
}

function normalizeCandidateUrl(value: string) {
  try {
    return normalizeUrl(unwrapTrackingUrl(value));
  } catch {
    return null;
  }
}

function canonicalizeDetailUrl(source: AlertSource, value: string) {
  const normalized = normalizeCandidateUrl(value);

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);

    if (source !== "unknown" && isDetailUrl(source, normalized)) {
      url.search = "";
      url.hash = "";
    }

    return url.toString();
  } catch {
    return normalized;
  }
}

function readImageCandidate(element: CheerioElement, baseUrl: string) {
  const srcset =
    element.attr("srcset") ??
    element.attr("data-srcset") ??
    element.attr("data-lazy-srcset");
  const srcsetUrl = srcset
    ?.split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean)
    .at(-1);
  const value =
    srcsetUrl ??
    element.attr("src") ??
    element.attr("data-src") ??
    element.attr("data-lazy-src") ??
    element.attr("data-original");

  if (!value || /^(?:cid:|data:)/i.test(value)) {
    return null;
  }

  try {
    const url = new URL(value, baseUrl);
    const width = Number(element.attr("width"));
    const height = Number(element.attr("height"));
    const searchable = `${url.pathname} ${element.attr("alt") ?? ""}`.toLowerCase();

    if (
      !["http:", "https:"].includes(url.protocol) ||
      (Number.isFinite(width) && width > 0 && width < 120) ||
      (Number.isFinite(height) && height > 0 && height < 90) ||
      /(?:logo|badge|icon|sprite|spacer|pixel|tracking|\/toto)/i.test(searchable)
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function findListingImages(
  $: cheerio.CheerioAPI,
  container: CheerioElement,
  baseUrl: string,
) {
  const urls: string[] = [];

  container.find("img").each((_index, imageElement) => {
    const url = readImageCandidate($(imageElement), baseUrl);

    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  });

  return urls;
}

function findCardContext(
  $: cheerio.CheerioAPI,
  anchors: CheerioElement[],
  canonicalUrl: string,
) {
  let best = {
    container: anchors[0],
    text: cleanText(anchors[0]?.text()),
    imageUrls: [] as string[],
    score: Number.NEGATIVE_INFINITY,
  };

  for (const anchor of anchors) {
    let current = anchor;

    for (let depth = 0; depth < 20; depth += 1) {
      const parent = current.parent();

      if (!parent.length) {
        break;
      }

      const text = cleanText(parent.text());

      if (text.length <= 3000) {
        const imageUrls = findListingImages($, parent, canonicalUrl);
        const detailUrls = new Set(
          parent
            .find("a[href]")
            .map((_index, element) => {
              const href = $(element).attr("href");
              const normalized = href ? normalizeCandidateUrl(href) : null;
              const source = normalized ? sourceFromUrl(normalized) : "unknown";
              return href ? canonicalizeDetailUrl(source, href) : null;
            })
            .get()
            .filter((value): value is string => Boolean(value))
            .filter((value) => isDetailUrl(sourceFromUrl(value), value)),
        );
        const score =
          (parsePrice(text) != null ? 12 : 0) +
          (parseSqm(text) != null ? 5 : 0) +
          (parseRooms(text) != null ? 4 : 0) +
          (imageUrls.length ? 10 : 0) +
          Math.min(text.length, 600) / 100 -
          Math.max(0, detailUrls.size - 1) * 20 -
          (text.length > 1800 ? 4 : 0);

        if (score > best.score) {
          best = { container: parent, text, imageUrls, score };
        }
      }

      current = parent;
    }
  }

  return best;
}

function getTitle(
  anchorTexts: string[],
  imageAlt: string,
  context: string,
  subject: string,
) {
  const cleanedAnchor = anchorTexts
    .map(cleanText)
    .filter(
      (value) =>
        value.length >= 12 &&
        !GENERIC_LINK_LABELS.has(value.toLowerCase()) &&
        !/^vedi\s+\d+\s+foto$/i.test(value),
    )
    .sort((left, right) => right.length - left.length)[0];

  if (cleanedAnchor) {
    return cleanedAnchor.slice(0, 240);
  }

  const cleanedAlt = cleanText(imageAlt);

  if (cleanedAlt.length >= 12) {
    return cleanedAlt.slice(0, 240);
  }

  const beforePrice = context.split(/\u20ac|EUR|euro/i)[0];
  const contextTitle = cleanText(beforePrice);

  if (contextTitle.length >= 12) {
    return contextTitle.slice(0, 240);
  }

  return cleanText(subject || "Nuovo annuncio").slice(0, 240);
}

function getZone(context: string) {
  const bitontoMatch = context.match(
    /(?:zona|quartiere|comune|localit(?:a|\u00e0))?\s*[:\-]?\s*([^|,;\n]{0,60}\bBitonto\b[^|,;\n]{0,40})/i,
  );

  return bitontoMatch?.[1] ? cleanText(bitontoMatch[1]) : null;
}

export function parseAlertEmail(input: {
  html?: string | false;
  text?: string;
  sender: string;
  subject: string;
}) {
  const html = typeof input.html === "string" ? input.html : "";
  const $ = cheerio.load(
    html || `<div>${(input.text ?? "").replace(/\n/g, "<br>")}</div>`,
  );
  const links = $("a[href]")
    .map((_index, element) => $(element).attr("href") ?? "")
    .get()
    .filter(Boolean);
  const inferredSource = inferSource(input.sender, input.subject, links);
  const candidates = new Map<
    string,
    {
      source: Exclude<AlertSource, "unknown">;
      sourceListingId: string | null;
      canonicalUrl: string;
      rawUrls: string[];
      anchors: CheerioElement[];
    }
  >();

  $("a[href]").each((_index, element) => {
    const anchor = $(element);
    const rawHref = anchor.attr("href");

    if (!rawHref) {
      return;
    }

    const normalizedUrl = normalizeCandidateUrl(rawHref);

    if (!normalizedUrl) {
      return;
    }

    const detectedSource = sourceFromUrl(normalizedUrl);
    const source =
      detectedSource === "unknown" ? inferredSource : detectedSource;

    if (source === "unknown" || !isDetailUrl(source, normalizedUrl)) {
      return;
    }

    const canonicalUrl = canonicalizeDetailUrl(source, normalizedUrl);

    if (!canonicalUrl) {
      return;
    }

    const sourceListingId = extractSourceListingId(source, canonicalUrl);
    const candidateKey = sourceListingId
      ? `${source}:${sourceListingId}`
      : canonicalUrl;
    const existing = candidates.get(candidateKey);

    if (existing) {
      existing.rawUrls.push(rawHref);
      existing.anchors.push(anchor);
    } else {
      candidates.set(candidateKey, {
        source,
        sourceListingId,
        canonicalUrl,
        rawUrls: [rawHref],
        anchors: [anchor],
      });
    }
  });

  const alerts: ParsedEmailAlert[] = [];

  for (const candidate of candidates.values()) {
    const { container, text, imageUrls } = findCardContext(
      $,
      candidate.anchors,
      candidate.canonicalUrl,
    );
    const imageElement = container
      .find("img")
      .filter((_index, element) =>
        Boolean(readImageCandidate($(element), candidate.canonicalUrl)),
      )
      .eq(0);
    const imageAlt = imageElement.attr("alt") ?? "";
    const anchorTexts = candidate.anchors.map((anchor) => anchor.text());
    const title = getTitle(anchorTexts, imageAlt, text, input.subject);

    alerts.push({
      source: candidate.source,
      sourceListingId: candidate.sourceListingId,
      url: candidate.rawUrls[0] ?? candidate.canonicalUrl,
      canonicalUrl: candidate.canonicalUrl,
      title,
      description: text.length > title.length ? text.slice(0, 1800) : null,
      price: parsePrice(text),
      sqm: parseSqm(text),
      rooms: parseRooms(text),
      zone: getZone(text),
      imageUrl: imageUrls[0] ?? null,
      rawPayload: {
        anchorTexts: anchorTexts.map(cleanText).filter(Boolean),
        context: text,
        emailSubject: input.subject,
        imageUrls,
      },
    });
  }

  return alerts;
}
