import { load } from "cheerio";
import { hashValue } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { PUBLIC_RECORD_POLICY as P } from "./public-record-policy";

export interface AlboItem { id: string; url: string; registration: string; act: string; category: string; subject: string; start: string | null; end: string | null; marker: string }
export function publicDate(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (!m) return null;
  const date = `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  const parsed = new Date(date);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === date ? date : null;
}
export function safeAlboUrl(value: string) {
  const url = new URL(value, P.alboUrl);
  if (url.protocol !== "https:" || url.hostname !== new URL(P.alboUrl).hostname || !url.pathname.startsWith("/web/trasparenza/")) throw Error("Unapproved Albo URL");
  return url.href;
}
export function safeAlboOffice(value:string):string|null {
  if(!/^\d+(?:\.\d+)*\s*[-–]/.test(value))return null;
  return value.split(/\b(?:dott\.?|dirigente|firmatario|sig\.)\b/i)[0].trim().slice(0,250);
}
export function parseAlboInventory(html: string) {
  const $ = load(html), pager = $(".pagination .active").first().text().match(/Pagina\s+(\d+)\s+di\s+(\d+)\s+\((\d+)\s+risultati\)/i);
  if (!pager || !$("table.master-detail-list-table th").text().includes("Oggetto")) throw Error("Albo inventory structure changed");
  const items: AlboItem[] = [];
  for (const tr of $("table.master-detail-list-table tbody tr").toArray()) {
    const td = $(tr).find("td"), href = td.find('a[href*="/papca/display/"]').first().attr("href"), id = href?.match(/\/display\/(\d+)/)?.[1];
    if (!td.length) continue;
    if (!id || td.length < 6) throw Error("Albo row has no stable identity");
    const periods = td.eq(4).text().match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
    const item = { id, url: safeAlboUrl(href!), registration: td.eq(0).text().trim(), act: td.eq(1).text().trim(), category: td.eq(2).text().replace(/\s+/g," ").trim(), subject: td.eq(3).text().replace(/\s+/g," ").trim(), start: publicDate(periods[0] ?? ""), end: publicDate(periods[1] ?? "") };
    items.push({...item, marker: hashValue(item)});
  }
  const next = $('a[href]').toArray().map(a => $(a).attr("href")!).find(u => u.includes("paginationAction=NEXT"));
  const page = +pager[1], pages = +pager[2], total = +pager[3];
  if (!items.length || page > pages || pages > P.maxPages || (page < pages && !next)) throw Error("Albo incomplete pagination");
  return { items, page, pages, total, next: next ? safeAlboUrl(next) : null, fingerprint: hashValue({ headers: $("table.master-detail-list-table th").map((_, a) => $(a).text().replace(/\s+/g," ").trim()).get(), policy: P.version }) };
}
export function parseAlboDetail(html: string, expectedId: string) {
  const $ = load(html), field = (name: string) => $(`tr.ap-${name}`).find("td").eq(1).text().replace(/\s+/g," ").trim();
  if (!field("oggetto") || !field("numeroRegistro")) throw Error("Albo detail structure changed");
  const canonical = $('link[rel="canonical"]').attr("href");
  if (canonical?.includes("/papca/display/") && !canonical.endsWith("/" + expectedId)) throw Error("Albo detail identity changed");
  const documents = new Set<string>();
  for (const a of $(".allegati-table a").toArray()) {
    const href = $(a).attr("href"), encoded = $(a).attr("onclick")?.match(/atob\(['"]([A-Za-z0-9+/=]+)['"]\)/)?.[1];
    const raw = encoded ? Buffer.from(encoded,"base64").toString("utf8") : href;
    if (raw && !raw.startsWith("javascript:")) documents.add(safeAlboUrl(raw));
  }
  const period = field("dataInizioPubblicazione").match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
  return { subject: field("oggetto"), documentDate: publicDate(field("dataDocumento")), actDate: publicDate(field("dataAtto")),
    start: publicDate(period[0] ?? ""), end: publicDate(period[1] ?? ""), office: safeAlboOffice(field("proponente")), status: field("stato"), documents: [...documents] };
}
/** Ephemeral anonymous session only; no login, no challenge bypass, no shared credentials. */
export class AlboHttp {
  private cookies = new Map<string,string>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly delayMs: number = P.delayMs) {}
  async get(url: string): Promise<string> {
    safeAlboUrl(url);
    for (let attempt = 0; ; attempt++) {
      if (this.delayMs) await new Promise(r => setTimeout(r,this.delayMs * 2 ** attempt));
      const r = await this.fetcher(url, { signal: AbortSignal.timeout(P.requestTimeoutMs), redirect: "error", headers: { cookie: [...this.cookies.values()].join("; "), "user-agent": "ListingRadarLifecycle/2.0 (+public territorial records)" } });
      if ((r.status === 429 || r.status >= 500) && attempt < P.retries) continue;
      if (!r.ok) throw Error(`Albo HTTP ${r.status}`);
      for (const value of r.headers.getSetCookie()) { const pair = value.split(";")[0]; this.cookies.set(pair.split("=")[0],pair); }
      if (Number(r.headers.get("content-length")) > P.maxHtmlBytes) throw Error("Albo page too large");
      const body = await r.text();
      if (Buffer.byteLength(body) > P.maxHtmlBytes || /cf-chl-|<title>\s*(?:Attention Required|Just a moment)/i.test(body)) throw Error("Albo response unavailable or too large");
      return body;
    }
  }
}
export async function collectAlboInventory(http: Pick<AlboHttp,"get">) {
  let url: string | null = P.alboUrl, expected = 1, total: number | null = null, pages = 0, fingerprint = "";
  const items = new Map<string,AlboItem>();
  while (url) {
    const p = parseAlboInventory(await http.get(url));
    if (p.page !== expected || (total != null && total !== p.total) || (fingerprint && fingerprint !== p.fingerprint)) throw Error("Albo inventory drift or repeated page");
    total = p.total; fingerprint = p.fingerprint; pages++;
    for (const item of p.items) { if (items.has(item.id)) throw Error("Duplicate Albo publication across pages"); items.set(item.id,item); }
    url = p.page < p.pages ? p.next : null; expected++;
  }
  if (items.size !== total) throw Error("Albo inventory count incomplete");
  return {items: [...items.values()], total, pages, fingerprint};
}
