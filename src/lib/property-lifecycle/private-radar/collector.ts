import {isRentalOnlyOffer} from "./transaction";
import {privateGalleryImages} from "../read-models/private-images";
import { PropertyLifecycleRepository } from "../persistence/repository";
import { BrowserFallbackHttpClient } from "@/lib/http/browser-fallback";
import { subitoRecords, subitoCapture, subitoId } from "../adapters/subito-publisher";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSourceInBrowser } from "@/lib/http/browser-fallback";
import { classifySeller } from "@/lib/listings/seller-classification";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import { PrivateRadarBridge, type PrivateRadarObservation } from "./bridge";

export const PRIVATE_PORTALS = {
  idealista: { url: "https://www.idealista.it/vendita-case/bitonto-bari/", id: /\/immobile\/(\d+)\/?$/ },
  immobiliare: { url: "https://www.immobiliare.it/vendita-case/bitonto/", id: /\/annunci\/(\d+)\/?$/ },
  casa: { url: "https://www.casa.it/vendita/residenziale/bitonto/", id: /\/immobili\/(\d+)\/?$/ },
  subito: { url: "https://www.subito.it/annunci-puglia/vendita/immobili/bari/bitonto/", id: /-(\d+)\.htm$/ },
  casadaprivato: { url: "https://www.casadaprivato.it/annunci-vendita/immobili/bari-bitonto", id: /-(\d+)\/?$/ },
} as const;
export type PrivatePortal = keyof typeof PRIVATE_PORTALS;
export interface PortalDiscovery { urls: string[]; next: string | null; records: number; }
const privateHttp = new BrowserFallbackHttpClient({ timeoutMs: 15000, retries: 0, minIntervalMs: 1000 });
export const readPrivateInventory = (url:string) => privateHttp.get(url);

export function discoverPrivateUrls(html: string, pageUrl: string, source: PrivatePortal): PortalDiscovery {
  const profile = PRIVATE_PORTALS[source], origin = new URL(profile.url).origin, $ = load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const url = new URL($(el).attr("href")!, pageUrl);
      if (url.origin === origin && profile.id.test(url.pathname)) { url.search = ""; url.hash = ""; urls.add(url.href); }
    } catch { /* malformed source link */ }
  });
  const href = $("link[rel='next'], a[rel='next'], a[aria-label='Successiva'], a[aria-label='Pagina successiva'], a[title='Successiva']").first().attr("href");
  let next: string | null = null;
  if (href) {
    const url = new URL(href, pageUrl), root = new URL(profile.url);
    // Pagination must stay in the selected municipality and search category.
    if (url.origin === origin && (url.pathname.startsWith(root.pathname) || url.pathname === root.pathname.replace(/\/$/, ""))) next = url.href;
  }
  const records = urls.size;
  if (source === "subito") {
    for(const ad of subitoRecords(html)){
      if((ad.advertiser as Record<string,unknown>)?.company === true) urls.delete(String((ad.urls as Record<string,unknown>)?.default));
    }
    try {
      const state = JSON.parse($("#__NEXT_DATA__").text()).props.pageProps.initialState.items;
      const current = Math.max(1, Number(new URL(pageUrl).searchParams.get("o")) || 1);
      if (Number.isInteger(state.totalPages) && state.totalPages > current && state.totalPages <= 100) {
        const target = new URL(PRIVATE_PORTALS.subito.url); target.searchParams.set("o", String(current + 1)); next = target.href;
      }
    } catch { /* no verified paginator: keep positive links only */ }
  }
  return { urls: [...urls], next, records };
}

const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const scrub = (v: string | null) => v?.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contatto rimosso]").replace(/\b(?:\+39\s*)?(?:0\d{1,3}|3\d{2})(?:[\s.-]*\d){6,9}\b/g, "[contatto rimosso]") ?? null;

export function privateObservationFromCapture(source: PrivatePortal, url: string, id: string, capture: Record<string, unknown>, firstSeen: string, observedAt: string): PrivateRadarObservation | null {
  const requested = new URL(url);
  if(requested.origin !== new URL(PRIVATE_PORTALS[source].url).origin)throw new Error("Portale della scheda non verificato");
  const sourceId = PRIVATE_PORTALS[source].id.exec(requested.pathname)?.[1];
  if (!sourceId || !text(capture.title)) throw new Error("Scheda senza identificativo o titolo verificabile");
  const canonical = text(capture.canonicalUrl);
  if (canonical) {
    const target = new URL(canonical, url);
    if (target.origin !== new URL(url).origin || PRIVATE_PORTALS[source].id.exec(target.pathname)?.[1] !== sourceId) throw new Error("Identità della scheda diversa dall’annuncio richiesto");
  }
  const seller = classifySeller({ source, declaredType: capture.sellerType === "agency" ? "agency" : capture.sellerType === "private" ? "private" : "unknown", sellerName: text(capture.sellerName), title: text(capture.title), description: text(capture.description) });
  if (capture.transaction && capture.transaction !== "s") return null;
  if (seller.sellerType === "agency" || isRentalOnlyOffer(capture) || /\basta\b/i.test(String(capture.title))) return null;
  const geography = resolveMonitoredGeography({ rawText: [text(capture.addressRaw), text(capture.zone), text(capture.title)].filter(Boolean).join(", "), latitude: number(capture.latitude), longitude: number(capture.longitude), coordinatesExact: false });
  if (geography.scope !== "IN_SCOPE") return null;
  const published = text(capture.portalDeclaredDate) ?? text(capture.metadataDatePublished);
  const date = published && Number.isFinite(Date.parse(published)) && Date.parse(published) <= Date.parse(observedAt) ? new Date(published).toISOString() : null;
  return { direct: true, id, source, source_listing_id: sourceId, url, canonical_url: url,
    title: scrub(text(capture.title))!, description: scrub(text(capture.description))?.slice(0, 12000) ?? null,
    price: number(capture.price), sqm: number(capture.sqm), rooms: number(capture.rooms), floor: text(capture.floor), zone: text(capture.zone), address_raw: text(capture.addressRaw), latitude: number(capture.latitude), longitude: number(capture.longitude),
    portal_declared_date: date, metadata_date_published: null, first_seen_at: firstSeen, last_seen_at: observedAt, status: "active", seller_name: null, seller_type: seller.sellerType === "private" ? "private" : "unknown", seller_classification_confidence: seller.confidence,
    image_urls: privateGalleryImages(capture.imageUrls),
  };
}

export async function capturePrivateDetail(url: string, source: PrivatePortal): Promise<Record<string, unknown>> {
  if (source === "subito") {
    const response = await privateHttp.get(url);
    if (response.ok) {
      const row = subitoRecords(response.body).find(row => subitoId(String((row.urls as Record<string,unknown>)?.default)) === subitoId(url));
      if (row) return subitoCapture(row);
    }
  }
  const response = await readSourceInBrowser(url, async page => {
    // Reuse the same portal-specific extraction already maintained for the
    // browser extension. Extraction is read-only; contacts/raw payload discarded.
    for (const name of ["generic", "shared", source, "portals"]) {
      await page.addScriptTag({ content: await readFile(join(process.cwd(), "extension", "parsers", name + ".js"), "utf8") });
    }
    return page.evaluate((source) => {
      const capture = (globalThis as unknown as { ListingRadarPortalParser: { extract(): Record<string,unknown> } }).ListingRadarPortalParser.extract();
      if(source === "casadaprivato"){
        // Dedicated listing heading wins over generic footer/advertising text.
        const heading = [...document.querySelectorAll("h2")].find(h=>/in vendita da privato/i.test(h.textContent??""));
        if(heading){
          capture.sellerType="private"; capture.sellerName=null;
          const description = heading.parentElement?.querySelector(".text-justify");
          if(description?.textContent?.trim()) capture.description=description.textContent.trim();
          const gallery=[...document.querySelectorAll("#property-detail-large img")].map(img=>img.getAttribute("data-src")||img.getAttribute("src")).filter((v):v is string=>!!v).map(v=>new URL(v,location.href).href);
          capture.imageUrls=gallery;
        }
      }
      return capture;
    }, source);
  });
  if (!response.ok || !response.extracted || typeof response.extracted !== "object") throw new Error(`Lettura annuncio HTTP ${response.status}`);
  return response.extracted as Record<string, unknown>;
}

function check(error: { message: string } | null): void { if (error) throw new Error(error.message); }
async function excludePublication(db: SupabaseClient, source: PrivatePortal, url: string, at: string, reason:"agency"|"rental"): Promise<void> {
  const sourceId=PRIVATE_PORTALS[source].id.exec(new URL(url).pathname)?.[1];
  const current=await db.from("private_publications").select("id,property_id,metadata,state").eq("source",source).eq("source_listing_id",sourceId).is("legacy_listing_id",null).maybeSingle();
  check(current.error); if(!current.data)return;
  const repository=new PropertyLifecycleRepository(db);
  const state=await repository.authoritativePrivatePublicationState(current.data.id,"REMOVED");
  if(state!=="REMOVED")return;
  const saved=await db.from("private_publications").update({ state,removed_at:state==="REMOVED"?at:null,metadata:{...current.data.metadata,sellerType:reason==="agency"?"agency":current.data.metadata?.sellerType??"unknown",saleRadarExclusion:reason,sellerReclassifiedAt:at} }).eq("id",current.data.id);
  check(saved.error); await repository.refreshPropertyIntelligence(current.data.property_id);
}

async function collect(db: SupabaseClient, assertOwnership: () => void): Promise<void> {
  const bridge=new PrivateRadarBridge(db);
  for (const source of Object.keys(PRIVATE_PORTALS) as PrivatePortal[]) {
    assertOwnership();
    let pages = 0, discovered = 0, failures = 0, next: string | null = PRIVATE_PORTALS[source].url;
    const visited = new Set<string>();
    const diagnostics: string[] = [];
    try {
      while (next && pages < 20 && !visited.has(next)) {
        assertOwnership(); visited.add(next);
        const response = await readPrivateInventory(next);
        if (!response.ok) throw new Error(`Inventario HTTP ${response.status}`);
        assertOwnership();
        const page = discoverPrivateUrls(response.body, next, source);
        if (!page.records) throw new Error("Inventario senza annunci verificabili");
        if(page.urls.length){
          const saved = await db.from("private_radar_inbox").upsert(page.urls.map(url => ({ source, source_listing_id: PRIVATE_PORTALS[source].id.exec(new URL(url).pathname)![1], canonical_url: url })), { onConflict: "source,source_listing_id", ignoreDuplicates: true });
          check(saved.error);
        } discovered += page.urls.length; pages++; next = page.next;
      }
      if (next) { failures++; diagnostics.push("Scansione limitata o paginazione ciclica; nessuna valutazione delle assenze"); }
    } catch (error) { assertOwnership(); failures++; diagnostics.push(error instanceof Error ? error.message : "Lettura non riuscita"); }
    // The inbox is the checkpoint: even if discovery fails, known due URLs can
    // still be inspected. A restart does not discard the already acquired queue.
    const due = await db.from("private_radar_inbox").select("id,canonical_url,first_seen_at").eq("source", source).lte("next_check_at", new Date().toISOString()).order("last_checked_at", {ascending:true,nullsFirst:true}).order("next_check_at").order("id").limit(50);
    check(due.error);
    for (const row of due.data ?? []) {
      assertOwnership();
      const now = new Date().toISOString();
      try {
        const captured = await capturePrivateDetail(row.canonical_url, source);
        assertOwnership();
        const observation = privateObservationFromCapture(source, row.canonical_url, row.id, captured, row.first_seen_at, now);
        if (observation) {
          const result=await bridge.sync([observation]);
          if(result.inScopeListings!==1)throw new Error("Osservazione fuori dal perimetro verificato");
        } else if(captured.sellerType === "agency") await excludePublication(db,source,row.canonical_url,now,"agency");
        else if(isRentalOnlyOffer(captured))await excludePublication(db,source,row.canonical_url,now,"rental");
        const saved = await db.from("private_radar_inbox").update({ last_checked_at: now, next_check_at: new Date(Date.now() + (observation ? 6 : 24) * 3600_000).toISOString(), status: observation ? "ACCEPTED" : "EXCLUDED", last_error: null }).eq("id", row.id);
        check(saved.error);
      } catch { // No scraped response, name, phone or credentials in diagnostics.
        assertOwnership();
        failures++;
        const saved = await db.from("private_radar_inbox").update({ last_checked_at: now, next_check_at: new Date(Date.now() + 12 * 3600_000).toISOString(), status: "FAILED", last_error: "Scheda non verificata: dati precedenti conservati" }).eq("id", row.id);
        check(saved.error);
      }
    }
    assertOwnership();
    const health = await db.from("private_radar_source_health").upsert({ source, checked_at: new Date().toISOString(), state: failures ? "DEGRADED" : "OBSERVED", pages_visited: pages, discovered_count: discovered, failed_count: failures, diagnostics, absence_authoritative: false }, { onConflict: "source" });
    check(health.error);
  }
  assertOwnership();
  const refreshed = await db.rpc("refresh_radar_read_model");
  check(refreshed.error);
  if (refreshed.data !== true) throw new Error("Letture conservate, aggiornamento del registro Radar da riprovare");
}

export async function collectPrivateRadar(db: SupabaseClient, assertJobOwnership = () => {}): Promise<void> {
  const owner = randomUUID();
  const claim = await db.rpc("claim_private_radar", { p_owner: owner });
  check(claim.error);
  if (claim.data !== true) throw new Error("Un altro raccoglitore Radar è già in esecuzione");
  let lost = false, renewing: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = Promise.resolve(db.rpc("claim_private_radar", { p_owner: owner })).then(result => {
      if (result.error || result.data !== true) lost = true;
    }).catch(() => { lost = true; }).finally(() => { renewing = null; });
  }, 60_000);
  try {
    await collect(db, () => { assertJobOwnership(); if (lost) throw new Error("Sessione Radar non più confermata"); });
  } finally {
    clearInterval(heartbeat); await renewing;
    const released = await db.rpc("release_private_radar", { p_owner: owner });
    check(released.error);
  }
}
