import { load } from "cheerio";
import type { ExternalFacts } from "./adapters";

const object = (value: unknown): Record<string, unknown> | null => value != null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const positive = (value: unknown): number | null => {
  const number = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
};
const canonicalIdentity = (value: string) => new URL(value).href.replace(/\/$/, "");

/** Primary, URL-bound JSON-LD. No inference from related cards or generic organization nodes. */
export function parseRemaxFacts(html: string, url: string, externalId: string, observedAt: string): ExternalFacts {
  const $ = load(html);
  const canonical = $("link[rel='canonical']").attr("href");
  if (!canonical || canonicalIdentity(canonical) !== canonicalIdentity(url)) throw new Error("RE/MAX canonical identity mismatch");
  const listings: Record<string, unknown>[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      const root = object(parsed);
      const nodes = Array.isArray(parsed) ? parsed : Array.isArray(root?.["@graph"]) ? root["@graph"] : [parsed];
      for (const value of nodes) {
        const node = object(value);
        if (node?.["@type"] === "RealEstateListing" && typeof node.url === "string" && canonicalIdentity(node.url) === canonicalIdentity(url)) listings.push(node);
      }
    } catch { /* malformed or unrelated JSON-LD cannot establish identity */ }
  });
  if (listings.length !== 1) throw new Error("RE/MAX primary listing JSON-LD missing or ambiguous");
  const listing = listings[0], address = object(listing.address), offers = object(listing.offers);
  const title = $("h1").first().text().trim();
  const municipality = text(address?.addressLocality);
  if (!title || title !== listing.name || !municipality || !/^(Bitonto|Palombaio|Mariotto)$/i.test(municipality)) throw new Error("RE/MAX property identity or scope mismatch");
  if (!offers || offers.businessFunction !== "https://schema.org/Sell") throw new Error("RE/MAX transaction is not an explicit sale offer");
  if (offers.priceCurrency !== "EUR") throw new Error("RE/MAX unsupported asking currency");
  const price = positive(offers.price), size = positive(object(listing.floorSize)?.value), rooms = positive(listing.numberOfRooms);
  if (!size && !rooms) throw new Error("RE/MAX primary property fields missing");
  const provider = object(listing.provider), agent = object(listing.realEstateAgent), geo = object(listing.geo);
  const providerUrl = text(provider?.url);
  const providerValid = provider?.["@type"] === "RealEstateAgent" && providerUrl && new URL(providerUrl).hostname === new URL(url).hostname;
  const agentUrl = text(agent?.url);
  const agentValid = agent?.["@type"] === "RealEstateAgent" && agentUrl && new URL(agentUrl).hostname === new URL(url).hostname && text(agent.name);
  const modifiedHeading = $("h2,h3,h4").filter((_, el) => $(el).text().trim() === "Ultimo aggiornamento");
  const modified = modifiedHeading.length === 1 ? modifiedHeading.next().text().trim() || null : null;
  const explicitStatus = $("main [data-testid='listing-status'],main > .listing-status").first().text().trim();
  const availability = text(offers.availability);
  const status = explicitStatus || (availability === "https://schema.org/InStock" ? "In vendita" :
    availability === "https://schema.org/SoldOut" || availability === "https://schema.org/Discontinued" ? "Non disponibile" : null);
  const latitude = positive(geo?.latitude), longitude = positive(geo?.longitude);
  return { source: "REMAX", url, observedAt, method: "PRIMARY_HTTP", externalId, title,
    municipality, address: text(address?.streetAddress), reference: externalId,
    propertyType: title.replace(/\s+in vendita a\s+.+$/i, ""), price: price != null && Number.isInteger(price) ? price : null,
    surfaceSqm: size, rooms, floor: null, description: text(listing.description),
    publishedLabel: text(listing.datePosted), publishedClaimField: "JSON_LD.RealEstateListing.datePosted",
    modifiedLabel: modified, modifiedClaimField: "Ultimo aggiornamento", statusLabel: status,
    agency: providerValid ? { externalId: text(provider?.["@id"]), name: text(provider?.name), url: providerUrl } : { externalId: null, name: null, url: null },
    agent: agentValid ? { name: String(agent!.name), url: agentUrl } : null,
    images: Array.isArray(listing.image) ? listing.image.filter((value): value is string => typeof value === "string" && /^https:\/\//.test(value)) : [],
    coordinates: latitude != null && longitude != null ? { latitude, longitude, exact: false } : undefined,
    warnings: ["inventory_not_certified", ...(availability === "https://schema.org/SoldOut" ? ["schema_soldout_is_not_sale_evidence"] : []),
      ...(!providerValid ? ["agency_identity_requires_review"] : [])] };
}
