import { load } from "cheerio";
import { CONTRACT_VERSION, finalizeNormalizedListing, hashValue, type EvidenceClaim, type NormalizedListingV2 } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import { EXTERNAL_POLICY, explicitDate, externalClaim, type RetrievalMethod } from "./policy";
import { ExternalPublicHttp } from "./http";

export const SOURCE_HOSTS = { WIKICASA: "wikicasa.it", IMMOBILIARE: "immobiliare.it", CASA: "casa.it", IDEALISTA: "idealista.it" } as const;
type Portal = keyof typeof SOURCE_HOSTS;
export interface ExternalFacts {
  source: Portal; url: string; observedAt: string; method: RetrievalMethod;
  externalId: string; title: string; municipality: string | null; locality?: string | null;
  address: string | null; reference: string | null; propertyType: string | null;
  price: number | null; previousPrice?: number | null; priceChangedOn?: string | null;
  surfaceSqm: number | null; rooms: number | null; floor: string | null;
  publishedLabel?: string | null; modifiedLabel?: string | null;
  publishedClaimField?: string | null; modifiedClaimField?: string | null;
  statusLabel: string | null; soldLabel?: string | null;
  agency: { externalId: string | null; name: string | null; url: string | null };
  agent?: { name: string; url: string | null } | null;
  description?: string | null; images?: string[]; coordinates?: { latitude: number; longitude: number; exact: boolean };
  captureUrl?: string | null; warnings?: string[];
}
export interface ExternalObservation {
  source: Portal; agency: ExternalFacts["agency"]; agent: ExternalFacts["agent"];
  listing: NormalizedListingV2; claims: EvidenceClaim[]; warnings: string[];
}
export function publicationIdentity(source: Portal, url: string): string {
  const parsed = new URL(url);
  const paths = { WIKICASA: /^\/annuncio\/(\d+)\/?$/, IMMOBILIARE: /^\/annunci\/(\d+)\/?$/,
    CASA: /^\/immobili\/(\d+)\/?$/, IDEALISTA: /^\/immobile\/(\d+)\/?$/ };
  const id = parsed.pathname.match(paths[source])?.[1];
  if (parsed.protocol !== "https:" || parsed.hostname.replace(/^www\./, "") !== SOURCE_HOSTS[source] || !id) throw new Error("Invalid public publication URL");
  return id;
}

export function normalizeExternalFacts(facts: ExternalFacts): ExternalObservation {
  if (publicationIdentity(facts.source, facts.url) !== facts.externalId) throw new Error("Publication identity mismatch");
  if (!facts.title.trim() || !Number.isFinite(Date.parse(facts.observedAt))) throw new Error("Missing primary identity or observation time");
  const warnings = [...facts.warnings ?? []];
  const claims: EvidenceClaim[] = [];
  const claim = (kind: string, key: string, raw: string | null, value: unknown, confidence: number, date: string | null = null, metadata: Record<string, unknown> = {}) => {
    claims.push(externalClaim({ source: facts.source, url: facts.url, observedAt: facts.observedAt,
      method: facts.method, kind, key, raw, value, confidence, date, metadata: { captureUrl: facts.captureUrl ?? null, ...metadata } }));
  };
  const published = explicitDate(facts.publishedLabel ?? null, facts.observedAt);
  const modified = explicitDate(facts.modifiedLabel ?? null, facts.observedAt);
  if (facts.publishedLabel && !published) warnings.push("invalid_publication_date");
  if (facts.modifiedLabel && !modified) warnings.push("invalid_modified_date");
  if (published) claim("PORTAL_PUBLICATION_DATE", "publication.datePublished", facts.publishedLabel ?? null,
    published, EXTERNAL_POLICY.confidence.explicitDate, published, { sourceField: facts.publishedClaimField ?? (facts.source === "WIKICASA" ? "Data annuncio" : "Explicit publication date") });
  if (modified) claim("PORTAL_MODIFIED_DATE", "publication.dateModified", facts.modifiedLabel ?? null,
    modified, EXTERNAL_POLICY.confidence.explicitDate, modified, { sourceField: facts.modifiedClaimField ?? "Explicit modification date" });
  if (published && modified && modified < published) warnings.push("modified_precedes_publication");
  if (facts.price != null) claim("PRICE", "publication.askingPrice", String(facts.price), { amount: facts.price, currency: "EUR", changeDate: null }, EXTERNAL_POLICY.confidence.currentPrice);
  if (facts.previousPrice != null && facts.price != null && facts.previousPrice !== facts.price) {
    const changeDate = explicitDate(facts.priceChangedOn ?? null, facts.observedAt);
    if (facts.priceChangedOn && !changeDate) warnings.push("invalid_price_change_date");
    claim("PRICE_HISTORY", "publication.previousAskingPrice", String(facts.previousPrice),
      { amount: facts.previousPrice, currentAmount: facts.price, currency: "EUR", changeDate,
        changeLowerBound: null, changeUpperBound: facts.observedAt, datePrecision: changeDate ? "DAY" : "UNKNOWN" },
      EXTERNAL_POLICY.confidence.previousPrice, changeDate, { datePrecision: changeDate ? "DAY" : "UNKNOWN" });
  }
  const label = facts.statusLabel?.trim() ?? "";
  // A sale is an explicit status label for this publication, not a keyword anywhere in its description.
  const sold = /^(?:venduto|venduta|sold)(?:\s+il\s+\d{1,2}[/.]\d{1,2}[/.]\d{4})?$/i.test(label);
  const underOffer = /^(?:in trattativa|sotto offerta|under offer|riservato)$/i.test(label);
  const removed = /^(?:annuncio non (?:più )?disponibile|non disponibile|ritirato)$/i.test(label);
  const active = /^(?:attivo|disponibile|in vendita|vendita)$/i.test(label);
  const soldRaw = facts.soldLabel ?? label.match(/\bil\s+(.+)$/i)?.[1] ?? null;
  const soldAt = sold ? explicitDate(soldRaw, facts.observedAt) : null;
  if (sold && soldRaw && !soldAt) warnings.push("invalid_sold_date");
  const status = sold ? "SOLD" : underOffer ? "NEGOTIATION" : removed ? "REMOVED" : active ? "ACTIVE" : "UNKNOWN";
  const invalidSaleDate = sold && soldRaw != null && !soldAt;
  const statusConfidence = facts.method === "INDEX_CAPTURE" || invalidSaleDate ? EXTERNAL_POLICY.confidence.indexCapture : EXTERNAL_POLICY.confidence.explicitStatus;
  if (status !== "UNKNOWN") claim(sold ? "SOLD_EXPLICIT" : underOffer ? "UNDER_OFFER_EXPLICIT" : "STATUS", "publication.externalStatus",
    label, { status, soldAt }, statusConfidence, soldAt, invalidSaleDate ? { contradictions: ["invalid_sold_date"], interpretation: "REVIEW_REQUIRED" } : {});
  if (soldAt) claim("SOLD_EXPLICIT", "publication.soldAt", soldRaw, soldAt, statusConfidence, soldAt);
  if (facts.agency.name || facts.agency.externalId) claim("AGENCY_IDENTITY", "publication.agencyIdentity", facts.agency.name,
    facts.agency, EXTERNAL_POLICY.confidence.identity);
  if (facts.agent?.name) claim("AGENT_IDENTITY", "publication.agentIdentity", facts.agent.name, facts.agent, EXTERNAL_POLICY.confidence.agent);
  if (warnings.includes("modified_precedes_publication")) {
    for (const c of claims.filter(c => c.kind === "PORTAL_MODIFIED_DATE")) {
      c.confidence = Math.max(0, c.confidence - EXTERNAL_POLICY.confidence.contradictionPenalty);
      c.metadata.contradictions = ["modified_precedes_publication"];
    }
  }
  const location = resolveMonitoredGeography({ municipality: facts.municipality, locality: facts.locality,
    rawText: facts.address, latitude: facts.coordinates?.latitude, longitude: facts.coordinates?.longitude,
    coordinatesExact: facts.coordinates?.exact ?? false });
  const listing = finalizeNormalizedListing({ contractVersion: CONTRACT_VERSION, adapterKey: `external:${facts.source.toLowerCase()}`,
    source: { agencySlug: "external-unmapped", sourceKey: `${SOURCE_HOSTS[facts.source]}:${facts.externalId}`,
      externalId: facts.externalId, canonicalUrl: facts.url, agencyReference: facts.reference,
      portalPublishedAt: published, portalModifiedAt: modified, soldAt, transactionType: "SALE" },
    commercial: { title: facts.title, description: facts.description ?? null, propertyType: facts.propertyType,
      priceAmount: facts.price, priceCurrency: facts.price == null ? null : "EUR", surfaceSqm: facts.surfaceSqm,
      rooms: facts.rooms, bedrooms: null, bathrooms: null, floor: facts.floor, features: {} }, location,
    status: { value: invalidSaleDate ? "UNKNOWN" : status, sourceLabel: label || null, confidence: statusConfidence,
      evidence: claims.filter(c => ["SOLD_EXPLICIT", "UNDER_OFFER_EXPLICIT", "STATUS"].includes(c.kind)) },
    assets: (facts.images ?? []).flatMap(url => {
      try { const image = new URL(url); return image.protocol === "https:" ? [{ kind: "IMAGE" as const, url: image.href,
        canonicalUrl: image.href, sourceRecordedAt: null, dateEvidenceMethod: null, metadata: {} }] : []; } catch { return []; }
    }),
    marketStart: { lowerBound: published, upperBound: published ?? facts.observedAt,
      method: published ? "EXPLICIT_PORTAL_PUBLICATION_DATE" : "CRAWLER_FIRST_SEEN",
      confidence: published ? claims.find(c => c.kind === "PORTAL_PUBLICATION_DATE")!.confidence : 0.2,
      evidence: claims.filter(c => c.kind === "PORTAL_PUBLICATION_DATE") },
    observedAt: facts.observedAt, response: { url: facts.url, status: facts.method === "PRIMARY_HTTP" ? 200 : null, etag: null, lastModified: null },
    extractionWarnings: warnings, provenance: { source: facts.source, method: facts.method, policyVersion: EXTERNAL_POLICY.version,
      captureUrl: facts.captureUrl ?? null, externalAgency: facts.agency, externalAgent: facts.agent ?? null } });
  return { source: facts.source, agency: facts.agency, agent: facts.agent, listing, claims, warnings };
}

function pageText(html: string): string {
  const $ = load(html); $("script,style,nav,footer,[aria-label*='consigli'],.related,.recommendations").remove();
  const main = $("main").first();
  const body = main.length ? main.html() ?? "" : $("body").html() ?? "";
  return load(body.replace(/<\/(?:p|div|dt|dd|li|h\d|span|section)>|<br\s*\/?\s*>/gi, "\n")).text().split(/\n/)
    .map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
function after(text: string, label: string): string | null {
  return text.match(new RegExp(`(?:^|\\n)(?:${label})\\s*[:：]?\\s*(?:\\n)?([^\\n]+)`, "i"))?.[1]?.trim() ?? null;
}
function money(value: string | null): number | null {
  if (!value || !/\d/.test(value)) return null;
  const parsed = Number(value.replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseExternalHtml(source: Portal, html: string, url: string, observedAt: string): ExternalObservation {
  const externalId = publicationIdentity(source, url);
  if (source === "CASA") {
    const $ = load(html); const raw = $("script#__NEXT_DATA__").text();
    if (raw) {
      const pdp = JSON.parse(raw)?.props?.pageProps?.pdp;
      if (!pdp || String(pdp.id) !== externalId || pdp.channel !== "vendita") throw new Error("Casa identity or transaction mismatch");
      const canonical = pdp.helmetData?.seoData?.linkCanonical ?? url;
      if (publicationIdentity("CASA", canonical) !== externalId) throw new Error("Casa canonical identity mismatch");
      const label = typeof pdp.status === "string" && /^(venduto|in trattativa|disponibile|ritirato)$/i.test(pdp.status) ? pdp.status : null;
      const host = pdp.media?.hostImages;
      return normalizeExternalFacts({ source, url: canonical, observedAt, method: "PRIMARY_HTTP", externalId,
        title: pdp.helmetData?.seoData?.h1 ?? pdp.mainCardAggregator?.title ?? "",
        municipality: pdp.address?.town ?? null, address: pdp.address?.street ?? null, locality: pdp.address?.block ?? null,
        reference: pdp.refPublisher ?? null, propertyType: pdp.propertyType?.label ?? null,
        price: typeof pdp.price?.value === "number" ? pdp.price.value : null,
        surfaceSqm: typeof pdp.size?.value === "number" ? pdp.size.value : null,
        rooms: typeof pdp.rooms?.value === "number" ? pdp.rooms.value : null, floor: pdp.mainFeatures?.level ?? null,
        modifiedLabel: typeof pdp.modified === "string" ? pdp.modified : null, modifiedClaimField: "__NEXT_DATA__.props.pageProps.pdp.modified", statusLabel: label,
        agency: { externalId: pdp.publisher?.publisherId != null ? String(pdp.publisher.publisherId) : null,
          name: pdp.publisher?.publisherName ?? null, url: null },
        description: pdp.description?.it?.text ?? null,
        images: typeof host === "string" && Array.isArray(pdp.media?.gallery) ? pdp.media.gallery.flatMap((item: { type?: string; mediaid?: string }) =>
          item.type === "photo" && item.mediaid ? [new URL(item.mediaid, host).href] : []) : [] });
    }
  }
  const $ = load(html); const title = $("main h1").first().text().trim() || $("h1").first().text().trim();
  const canonical = $("link[rel='canonical']").attr("href");
  if (canonical && publicationIdentity(source, new URL(canonical, url).href) !== externalId) throw new Error("Canonical identity mismatch");
  if (!title || /captcha|cf-chl-|attention required|pagina non trovata/i.test(html)) throw new Error("Invalid primary detail structure");
  const text = pageText(html);
  if (source === "WIKICASA" && after(text, "Rif\\. Interno") !== externalId) throw new Error("Wikicasa detail identity marker missing");
  const agencies = $("main a[href*='/agenzia-immobiliare/'],main a[href*='/agenzie-immobiliari/'],a[data-testid='agency-link']")
    .toArray().map(el => ({ name: $(el).text().trim() || null, url: new URL($(el).attr("href")!, url).href,
      externalId: $(el).attr("href")!.match(/(?:-|\/)(\d+)\/?$/)?.[1] ?? null })).filter(item => item.name || item.externalId);
  const uniqueAgencies = [...new Map(agencies.map(a => [a.url, a])).values()];
  // Never use a generic contact name or brand in the description as the responsible agent.
  const agentName = $("main [data-testid='agent-name'],main [itemprop='agent'] [itemprop='name']").first().text().trim();
  // Status must have its own property field. An unverified page-wide "Venduto" is deliberately ignored.
  const explicitStatus = $("main [data-testid='listing-status'],main [itemprop='availability'],main > .listing-status").first().text().trim() || null;
  let municipality = after(text, "Comune|Città");
  const address = after(text, "Indirizzo") ?? null;
  // Wikicasa h1 ends with the actual town. A street named Bitonto elsewhere is not geography evidence.
  if (!municipality) municipality = title.match(/,\s*(Bitonto|Palombaio|Mariotto)\s*$/i)?.[1] ?? null;
  const jsonld: Record<string, unknown>[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try { const value = JSON.parse($(el).text()); const nodes = Array.isArray(value) ? value : value["@graph"] ?? [value];
      for (const node of nodes) if (node && /^(?:Apartment|House|Residence|RealEstateListing|Product)$/.test(String(node["@type"])) &&
        (!node.url || String(node.url).split("?")[0].replace(/\/$/, "") === url.split("?")[0].replace(/\/$/, ""))) jsonld.push(node);
    } catch { /* malformed structured data is not evidence */ }
  });
  const ld = jsonld.length === 1 ? jsonld[0] : null;
  const ldAddress = ld?.address as Record<string, unknown> | undefined;
  if (!municipality && typeof ldAddress?.addressLocality === "string") municipality = ldAddress.addressLocality;
  const offers = ld?.offers as Record<string, unknown> | undefined;
  const ldPrice = offers && Number(offers.price);
  const images = $("main [data-testid='property-gallery'] img,main [itemprop='image']").toArray().map(el => $(el).attr("src") ?? $(el).attr("content"))
    .filter((value): value is string => Boolean(value && /^https:\/\//.test(value))).slice(0, 60);
  const visiblePublished = source === "WIKICASA" ? after(text, "Data annuncio") : source === "IMMOBILIARE" ? after(text, "Annuncio pubblicato il") : null;
  const structuredPublished = source !== "CASA" ? (typeof ld?.datePublished === "string" ? ld.datePublished : typeof ld?.datePosted === "string" ? ld.datePosted : null) : null;
  const published = visiblePublished ?? structuredPublished;
  const visibleModified = source === "CASA" ? after(text, "Ultimo aggiornamento") : after(text, "Annuncio aggiornato il|Ultimo aggiornamento");
  const modified = visibleModified ?? (typeof ld?.dateModified === "string" ? ld.dateModified : null);
  // Require enough property markers to reject a marketing/error page that happens to contain a heading.
  const sqm = after(text, "Superficie"); const rooms = after(text, "Locali");
  if (!municipality || (!sqm && !rooms)) throw new Error("Insufficient property structure or explicit locality");
  return normalizeExternalFacts({ source, url, externalId, title, observedAt, method: "PRIMARY_HTTP", municipality,
    address: address ?? (typeof ldAddress?.streetAddress === "string" ? ldAddress.streetAddress : null),
    reference: after(text, "Rif\\. Immobile|Riferimento"), propertyType: after(text, "Tipologia"),
    price: money(after(text, "Prezzo")) ?? (Number.isInteger(ldPrice) && Number(ldPrice) > 0 ? Number(ldPrice) : null),
    previousPrice: money($("main del,main s,[data-testid='previous-price']").first().text() || null),
    priceChangedOn: after(text, "Prezzo modificato il"), surfaceSqm: sqm ? Number(sqm.match(/[\d.,]+/)?.[0]?.replace(",", ".")) || null : null,
    rooms: rooms ? Number(rooms.match(/\d+/)?.[0]) || null : null, floor: after(text, "Piano"),
    publishedLabel: published, publishedClaimField: visiblePublished ? (source === "WIKICASA" ? "Data annuncio" : "Annuncio pubblicato il") : "JSON_LD.datePublished/datePosted",
    modifiedLabel: modified, modifiedClaimField: visibleModified ? "Explicit modification label" : "JSON_LD.dateModified",
    statusLabel: explicitStatus ?? (source === "WIKICASA" && /\bin Vendita\b/i.test(title) ? "In vendita" : null),
    agency: uniqueAgencies.length === 1 ? uniqueAgencies[0] : { externalId: null, name: null, url: null },
    agent: agentName ? { name: agentName, url: null } : null, images,
    warnings: uniqueAgencies.length !== 1 ? ["agency_identity_requires_review"] : [] });
}

export interface ExternalInventoryItem { externalId: string; url: string; marker: string | null }
export interface ExternalInventoryPage { items: ExternalInventoryItem[]; next: string | null; reportedTotal: number | null; fingerprint: string; valid: boolean }
export function parseWikicasaInventory(html: string, url: string): ExternalInventoryPage {
  const $ = load(html); const main = $("main");
  const links = main.find("a[href]").toArray().flatMap(el => {
    try { const href = new URL($(el).attr("href")!, url).href; const id = publicationIdentity("WIKICASA", href);
      const card = $(el).closest("article");
      return [{ externalId: id, url: href.split("?")[0], marker: card.length ? hashValue(card.text().replace(/\s+/g, " ").trim()) : null }];
    } catch { return []; }
  });
  const items = [...new Map(links.map(item => [item.externalId, item])).values()];
  const nextHref = $("a[rel='next']").attr("href");
  const next = nextHref ? new URL(nextHref, url).href : null;
  const countText = main.find("[data-testid='results-count'],[data-total-results]").first();
  const total = Number(countText.attr("data-total-results") ?? countText.text().match(/\d+/)?.[0]);
  const reportedTotal = Number.isInteger(total) && total > 0 ? total : null;
  const canonical = $("link[rel='canonical']").attr("href");
  const valid = main.length === 1 && items.length > 0 && reportedTotal != null && Boolean(canonical) &&
    !/cf-chl-|captcha|Attention Required/i.test(html) && new URL(canonical!, url).pathname === new URL(url).pathname;
  return { items, next, reportedTotal, valid, fingerprint: hashValue({ main: main.length, article: main.find("article").length > 0,
    count: countText.length > 0, canonical: Boolean(canonical), identityPattern: "annuncio-numeric-v1" }) };
}

export async function fetchWikicasaInventory(http: ExternalPublicHttp, roots: string[], beforeFetch?: () => Promise<void>) {
  const all = new Map<string, ExternalInventoryItem>(); const visited = new Set<string>();
  let complete = true; const reasons: string[] = []; const fingerprints = new Set<string>();
  for (const root of roots) {
    const rootUrl = new URL(root);
    if (rootUrl.hostname.replace(/^www\./, "") !== SOURCE_HOSTS.WIKICASA || !/^\/vendita-(?:case|appartamenti|ville|terreni|box)\/(?:bitonto|palombaio|mariotto)\/$/.test(rootUrl.pathname)) throw new Error("Inventory outside configured geographic scope");
    const local = new Set<string>(); let next: string | null = root; let reported: number | null = null;
    while (next) {
      const pageUrl: URL = new URL(next);
      if (visited.has(next) || visited.size >= EXTERNAL_POLICY.http.maxPages || pageUrl.pathname !== rootUrl.pathname) { complete = false; reasons.push("pagination_loop_or_scope_changed"); break; }
      visited.add(next);
      await beforeFetch?.();
      const response = await http.get(next, SOURCE_HOSTS.WIKICASA);
      const page = parseWikicasaInventory(response.body, next);
      fingerprints.add(page.fingerprint);
      if (!page.valid || (reported != null && reported !== page.reportedTotal)) { complete = false; reasons.push("unverified_inventory_structure_or_total"); break; }
      reported = page.reportedTotal;
      let fresh = 0;
      for (const item of page.items) { if (!local.has(item.externalId)) fresh++; local.add(item.externalId); all.set(item.externalId, item); }
      if (!fresh) { complete = false; reasons.push("pagination_duplicate_page"); break; }
      next = page.next;
    }
    if (reported == null || local.size !== reported) { complete = false; reasons.push("inventory_count_mismatch"); }
  }
  if (!roots.length || fingerprints.size !== 1) { complete = false; reasons.push("scope_or_structure_unverified"); }
  return { items: [...all.values()], complete, pagesVisited: visited.size, reasons,
    fingerprint: hashValue([...fingerprints].sort()), state: complete ? "HEALTHY" as const : "DEGRADED" as const };
}

export async function verifyExternalPublication(http: ExternalPublicHttp, source: Portal, url: string, observedAt: string) {
  publicationIdentity(source, url);
  const response = await http.get(url, SOURCE_HOSTS[source]);
  return parseExternalHtml(source, response.body, url, observedAt);
}

export function historicalEvidence(input: { sourceUrl: string; captureUrl: string; observedAt: string;
  claimedDate: string; rawClaim: string; kind?: "PUBLICATION_DATE" | "ASKING_PRICE"; amount?: number }): EvidenceClaim {
  for (const value of [input.sourceUrl, input.captureUrl]) if (new URL(value).protocol !== "https:") throw new Error("Historical evidence must retain public HTTPS provenance");
  const date = explicitDate(input.claimedDate, input.observedAt);
  if (!date) throw new Error("Historical evidence requires an explicit valid claim date");
  if (input.kind === "ASKING_PRICE" && (!Number.isInteger(input.amount) || input.amount! <= 0)) throw new Error("Invalid historical asking");
  return externalClaim({ source: "SEARCH_INDEX", url: input.sourceUrl, observedAt: input.observedAt, method: "INDEX_CAPTURE",
    kind: input.kind === "ASKING_PRICE" ? "HISTORICAL_PRICE" : "HISTORICAL_PUBLICATION_DATE",
    key: input.kind === "ASKING_PRICE" ? "publication.askingPrice" : "publication.historicalMarketEvidence",
    raw: input.rawClaim, value: input.kind === "ASKING_PRICE" ? { amount: input.amount, currency: "EUR", claimedDate: date } : date,
    confidence: EXTERNAL_POLICY.confidence.indexCapture, date, metadata: { captureUrl: input.captureUrl, currentPresence: false } });
}
