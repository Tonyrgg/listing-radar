import { load } from "cheerio";
import { HttpClient, type HttpResponse } from "@/lib/http/client";
import { CONTRACT_VERSION, finalizeNormalizedListing } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import { cleanAgencyReference, createEvidence, structureFingerprint } from "./shared";
import type { InventoryItem, InventoryResult, SourceDocument } from "./types";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const string = (v: unknown) => typeof v === "string" ? v : null;
export const SANTI_SUBITO_SHOP = "https://impresapiu.subito.it/shops/60083-studi-santi-servizi-immobiliari";
export function subitoId(url: string): string | null {
 try { const u = new URL(url); return u.protocol === "https:" && u.hostname === "www.subito.it" ? u.pathname.match(/-(\d+)\.htm$/)?.[1] ?? null : null; } catch { return null; }
}

/** Parse only public JSON, including Next RSC data frames. Never eval scripts. */
export function subitoRecords(html: string): ObjectValue[] {
 const $ = load(html), roots: unknown[] = [], frames: string[] = [], records = new Map<string, ObjectValue>();
 $("script").each((_, e) => {
  const raw = $(e).text().trim();
  if ($(e).attr("id") === "__NEXT_DATA__") { try { roots.push(JSON.parse(raw)); } catch { /* invalid source JSON */ } }
  // React can put multiple push calls in one script and split a JSON record
  // across frames. Scan JSON arrays with string/escape awareness, then join text.
  const marker = "self.__next_f.push(";
  let offset = 0;
  while ((offset = raw.indexOf(marker, offset)) >= 0) {
   const start = offset + marker.length;
   offset = start;
   if(raw[start] !== "[") continue;
   let depth = 0, quoted = false, escaped = false;
   for(let i=start;i<raw.length;i++){
    const char=raw[i];
    if(quoted){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='['||char==='{')depth++;
    if(char===']'||char==='}')depth--;
    if(depth===0){
     try{const args=JSON.parse(raw.slice(start,i+1));if(args[0]===1&&typeof args[1]==="string")frames.push(args[1]);}catch{/* malformed source frame */}
     offset=i+1;break;
    }
    if(i===raw.length-1)offset=raw.length;
   }
  }
 });
 const indexed = new Map<string,unknown>(), stream = Buffer.from(frames.join(""),"utf8");
 let cursor=0;
 while(cursor<stream.length){
  if(stream[cursor]===10){cursor++;continue;}
  const colon=stream.indexOf(58,cursor); if(colon<0)break;
  const id=stream.subarray(cursor,colon).toString();
  if(!/^[a-z0-9]+$/.test(id)){const end=stream.indexOf(10,cursor);cursor=end<0?stream.length:end+1;continue;}
  cursor=colon+1;
  if(stream[cursor]===84){
   const comma=stream.indexOf(44,cursor),length=parseInt(stream.subarray(cursor+1,comma).toString(),16);
   if(comma<0||!Number.isFinite(length)||length<0||length>8_000_000)break;
   const end=comma+1+length;if(end>stream.length)break;
   indexed.set(id,stream.subarray(comma+1,end).toString());cursor=end;continue;
  }
  const newline=stream.indexOf(10,cursor),end=newline<0?stream.length:newline;
  try{const value=JSON.parse(stream.subarray(cursor,end).toString());indexed.set(id,value);roots.push(value);}catch{/* import/module/control record */}
  cursor=end+1;
 }
 function resolve(value:unknown,depth=0):unknown{
  if(depth>16)return value;
  if(typeof value==="string"){
   const match=value.match(/^\$([a-z0-9]+)(?::(.+))?$/);
   if(!match||!indexed.has(match[1]))return value;
   let target=indexed.get(match[1]);
   for(const key of match[2]?.split(":")??[]){
    target=key==="props"&&Array.isArray(target)?target[3]:object(target)[key];
   }
   return target===value?value:resolve(target,depth+1);
  }
  if(Array.isArray(value))return value.map(v=>resolve(v,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,resolve(v,depth+1)]));
  return value;
 }
 function walk(value: unknown, depth = 0) {
  if (!value || typeof value !== "object" || depth > 24) return;
  const raw = object(value);
  if(raw.subject && raw.advertiser && raw.urls){
   const row=object(resolve(raw)),url=string(object(row.urls).default),id=url?subitoId(url):null;
   if(id){records.set(id,row);return;}
  }
  for (const child of Object.values(value)) walk(child, depth + 1);
 }
 for (const root of roots) walk(root);
 return [...records.values()];
}

export function subitoCapture(row: ObjectValue): Record<string, unknown> {
 const geo = object(row.geo), town = string(object(geo.town).value), map = object(geo.map), features = object(row.features), advertiser = object(row.advertiser);
 const values = (key: string) => { const all = object(features[key]).values; return Array.isArray(all) ? all.map(object) : []; };
 const numeric = (key: string) => { const raw = values(key)[0]?.key; const n = raw == null ? NaN : Number(raw); return Number.isFinite(n) && n >= 0 ? n : null; };
 const images = Array.isArray(row.images) ? row.images.map(object).map(i => string(i.cdnBaseUrl)).filter((v): v is string => !!v && v.startsWith("https://images.sbito.it/")) : [];
 return { canonicalUrl: object(row.urls).default, title: string(row.subject), description: string(row.body),
  price: numeric("/price"), sqm: numeric("/size"), rooms: numeric("/room"), bathrooms: numeric("/bathrooms"), floor: string(values("/floor")[0]?.value),
  zone: town, addressRaw: town, latitude: map.latitude == null ? null : Number(map.latitude), longitude: map.longitude == null ? null : Number(map.longitude),
  sellerType: advertiser.company === true ? "agency" : advertiser.company === false ? "private" : "unknown", sellerName: string(advertiser.name), imageUrls: images,
  propertyType: string(object(row.category).value) ?? string(object(row.category).name) ?? string(object(row.category).label), transaction: string(object(row.type).key),
  // The source date can be bumped/republication time, not contractual start.
  portalSortDate: string(row.date),
 };
}

export class StudiSantiSubitoPublisher {
 constructor(private readonly http: HttpClient) {}
 async fetchInventory(primary: HttpResponse): Promise<InventoryResult> {
  const items = new Map<string, InventoryItem>(), visited = new Set<string>();
  let next: string | null = SANTI_SUBITO_SHOP, identity = true, errors = 0, response: HttpResponse | null = null;
  while (next && visited.size < 20 && !visited.has(next)) {
   const url: string = next; visited.add(url); response = await this.http.get(url);
   if (!response.ok) { errors++; break; }
   const $ = load(response.body);
   const matches = /Studi Santi/i.test($("title").text()) && response.body.includes("studisantiimmobiliare.it");
   identity &&= matches; if (!matches) { errors++; break; }
   $("a[href]").each((_, e) => { const href = $(e).attr("href")!, id = subitoId(href); if (id) items.set(id, { sourceKey: "subito.it:" + id, externalId: id, url: href, summary: { accessFallback: true, fallbackPublisher: "subito", primaryUrl: primary.url, primaryStatus: primary.status } }); });
   const href = $("a[href]").toArray().find(e => /^Avanti$/i.test($(e).text().trim()));
   next = href ? new URL($(href).attr("href")!, SANTI_SUBITO_SHOP).href : null;
   if (next && !next.startsWith(SANTI_SUBITO_SHOP + "?")) { errors++; break; }
  }
  const markers = { publisherIdentity: identity, positiveListings: items.size > 0, paginationFinished: !next };
  return { items: identity ? [...items.values()] : [], response, healthState: identity && items.size ? "DEGRADED" : "FAILED", complete: false, absenceAuthoritative: false,
   structureFingerprint: structureFingerprint(markers), diagnostics: { expectedCount: null, observedCount: items.size, duplicateCount: 0, parseErrorCount: errors, pagesVisited: visited.size, expectedPages: visited.size, requiredMarkers: markers,
    reasons: [`http_status:${primary.status}`, `primary_http_status:${primary.status}`, "secondary_publisher_catalog:subito", "publisher_total_unavailable", "primary_absence_evaluation_disabled"] } };
 }
 async fetchDetail(item: InventoryItem): Promise<SourceDocument> {
  const response = await this.http.get(item.url); if (!response.ok) throw new Error(`Subito detail HTTP ${response.status}`);
  return { item, response, observedAt: new Date().toISOString() };
 }
 normalize(document: SourceDocument) {
  const row = subitoRecords(document.response.body).find(r => subitoId(String(object(r.urls).default)) === document.item.externalId);
  const seller = object(row?.advertiser);
  if (!row || seller.company !== true || String(seller.shopId) !== "60083") throw new Error("Subito Studi Santi publisher identity not verified");
  const capture = subitoCapture(row);
  if (!["s","u"].includes(String(capture.transaction))) throw new Error("Subito publication transaction not verified");
  const agencyReference=cleanAgencyReference(string(capture.description)?.match(/\bRIFERIMENTO\s*:\s*([AVM]\d{3,})\b/i)?.[1] ?? null);
  const description = string(capture.description)?.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact removed]").replace(/https?:\/\/\S+/gi, "[link removed]").replace(/\b(?:\+39\s*)?(?:0\d{1,3}|3\d{2})(?:[\s.-]*\d){6,9}\b/g, "[contact removed]") ?? null;
  const evidence = createEvidence({ kind: "MARKET_START_BOUND", claimKey: "publication.firstObservedInInventoryAt", sourceUrl: document.item.url, extractionMethod: "CRAWLER_FIRST_SEEN", rawValue: document.observedAt, normalizedValue: { lowerBound: null, upperBound: document.observedAt }, confidence: 0.25, observedAt: document.observedAt, sourceRecordedAt: null, metadata: { limitation: "Subito date can be bumped and is not mandate start" } });
  return finalizeNormalizedListing({ contractVersion: CONTRACT_VERSION, adapterKey: "studisanti",
   source: { agencySlug: "studi-santi-bitonto", sourceKey: document.item.sourceKey, externalId: document.item.externalId, canonicalUrl: document.item.url, agencyReference, transactionType: capture.transaction === "s" ? "SALE" : "RENT" },
   commercial: { title: String(capture.title), description, propertyType: string(capture.propertyType), priceAmount: capture.price as number | null, priceCurrency: "EUR", surfaceSqm: capture.sqm as number | null, rooms: capture.rooms as number | null, bedrooms: null, bathrooms: capture.bathrooms as number | null, floor: string(capture.floor), features: {} },
   location: resolveMonitoredGeography({ rawText: string(capture.zone), municipality: string(capture.zone), latitude: capture.latitude as number | null, longitude: capture.longitude as number | null, coordinatesExact: false }),
   status: { value: "UNKNOWN", sourceLabel: null, confidence: 0.25, evidence: [] },
   assets: (capture.imageUrls as string[]).map(url => ({ kind: "IMAGE" as const, url, canonicalUrl: url, sourceRecordedAt: null, dateEvidenceMethod: null, metadata: { portalResizedAsset: true } })),
   marketStart: { lowerBound: null, upperBound: document.observedAt, method: "CRAWLER_FIRST_SEEN", confidence: 0.25, evidence: [evidence] }, observedAt: document.observedAt,
   response: { url: document.response.url, status: document.response.status, etag: null, lastModified: null },
   extractionWarnings: ["secondary_publisher_catalog", "source_publication_date_unavailable", "subito_sort_date_not_mandate_start"],
   provenance: { accessFallback: true, absenceAuthoritative: false, primarySourceUrl: document.item.summary.primaryUrl, reportedSource: "subito_public_publisher", verifiedPublisherShopId: "60083", agencyReferenceExtraction: agencyReference ? "SUBITO_DESCRIPTION_REFERENCE_LABEL" : null, portalSortDate: capture.portalSortDate, publisherContactDataExcluded: true },
  });
 }
}
