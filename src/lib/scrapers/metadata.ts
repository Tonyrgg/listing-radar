import { decodeHtmlEntities } from "@/lib/scrapers/html";

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const attributePattern =
    /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const match of tag.matchAll(attributePattern)) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    if (key) {
      attributes[key] = decodeHtmlEntities(value.trim());
    }
  }

  return attributes;
}

export function extractJsonLd(html: string): unknown[] {
  const jsonLdBlocks: unknown[] = [];
  const scriptPattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    const rawJson = match[1]?.trim();

    if (!rawJson) {
      continue;
    }

    const candidates = [
      rawJson,
      decodeHtmlEntities(rawJson),
      rawJson.replace(/\\\//g, "/"),
    ];

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        jsonLdBlocks.push(parsed);
        break;
      } catch {
        // Try the next representation of the same block.
      }
    }
  }

  return jsonLdBlocks;
}

export function extractMetaTags(html: string) {
  const tags: Record<string, string> = {};

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key =
      attributes.property ?? attributes.name ?? attributes.itemprop ?? attributes["http-equiv"];

    if (key && attributes.content) {
      tags[key.toLowerCase()] = attributes.content;
    }
  }

  const canonicalMatch = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i);

  if (canonicalMatch) {
    const attributes = parseAttributes(canonicalMatch[0]);

    if (attributes.href) {
      tags.canonical = attributes.href;
    }
  }

  return tags;
}
