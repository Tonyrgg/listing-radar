import { createRequire } from "node:module";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { HttpClient, type HttpClientOptions, type HttpRequestOptions, type HttpResponse } from "./client";

const HOSTS = new Set([
  "casa.it", "studisantiimmobiliare.it", "trovacasa.it", "idealista.it",
  "immobiliare.it", "subito.it", "impresapiu.subito.it", "casadaprivato.it",
  "admaioraimmobiliare.it", "futurabitonto.it", "garofaloimmobiliare.com",
  "iconacasa.com", "puntocasagroup.it", "vistocasa.com",
]);
function supported(url: URL): boolean {
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    HOSTS.has(url.hostname.replace(/^www\./, ""));
}
const requireRuntime = createRequire(`${process.cwd()}/package.json`);
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let tail: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const deniedUntil = new Map<string, number>();
const lastByHost = new Map<string, number>();

export async function closeSourceBrowser(): Promise<void> {
  clearTimeout(idleTimer);
  const current = browser;
  context = undefined;
  browser = undefined;
  await current?.close();
}

export async function readSourceInBrowser(url: string, extract?: (page: Page) => Promise<unknown>): Promise<HttpResponse & { extracted?: unknown }> {
  const requested = new URL(url);
  if (!supported(requested)) throw new Error("Source browser URL outside allowed sources");
  const run = tail.then(async () => {
    clearTimeout(idleTimer);
    try {
      const host=requested.hostname.replace(/^www\./,"");
      if ((deniedUntil.get(host) ?? 0) > Date.now()) throw new Error("Source browser temporarily suspended after access denial");
      if (!browser?.isConnected()) {
        // Runtime-only dependency: never bundle Chromium into the web app.
        const { chromium } = requireRuntime("@playwright/test") as typeof import("@playwright/test");
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ locale: "it-IT" });
        await context.route("**/*", async route => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) {
            const target = new URL(request.url());
            if (!supported(target)) return route.abort();
          }
          if (["image", "media", "font"].includes(request.resourceType())) return route.abort();
          return route.continue();
        });
      }
      const page = await context!.newPage();
      try {
        const wait=1000-(Date.now()-(lastByHost.get(host)??0));
        if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
        lastByHost.set(host,Date.now());
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!response) throw new Error("Source browser returned no response");
        const status = response.status();
        if ([401, 403, 429].includes(status)) deniedUntil.set(host, Date.now() + 5 * 60_000);
        const headers = new Headers(await response.allHeaders());
        // Wait for the source's actual content, rather than a fixed sleep or
        // networkidle (advertising requests may never become idle).
        if (response.ok() && /html/i.test(headers.get("content-type") ?? "")) {
          await page.locator(".agenziaAnnunci__card .card, h1, script[type='application/ld+json']").first().waitFor({ timeout: 8_000 }).catch(() => undefined);
        }
        const body = /xml|json/i.test(headers.get("content-type") ?? "") ? await response.text() : await page.content();
        if (body.length > 8_000_000) throw new Error("Source browser document exceeds size limit");
        headers.set("x-listing-radar-transport", "playwright");
        return { body, headers, status, ok: response.ok(), url: page.url(),
          ...(response.ok() && extract ? { extracted: await extract(page) } : {}) };
      } finally {
        await page.close();
      }
    } finally {
      idleTimer = setTimeout(() => { void closeSourceBrowser(); }, 15_000);
      idleTimer.unref();
    }
  });
  tail = run.catch(() => undefined);
  return run;
}

export class BrowserFallbackHttpClient extends HttpClient {
  constructor(options: HttpClientOptions = {}, private readonly reader = readSourceInBrowser) { super(options); }

  async render(url: string): Promise<HttpResponse | null> {
    if (process.env.LIFECYCLE_BROWSER_SOURCES !== "true") return null;
    try { return await this.reader(url); } catch { return null; }
  }

  override async get(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse> {
    const primary = await super.get(url, options);
    if (primary.status !== 403) return primary;
    const rendered = await this.render(url);
    // Preserve the original denial if the browser is unavailable or denied.
    if (rendered?.ok) return rendered;
    const headers = new Headers(primary.headers);
    headers.set("x-listing-radar-browser", rendered ? `http-${rendered.status}` : "unavailable-or-suspended");
    return { ...primary, headers };
  }
}

/** Explicit scans load public document GETs in the browser. Adapters still
 * own the inventory boundaries and interpret denials as incomplete readings. */
export class SourceBrowserHttpClient extends BrowserFallbackHttpClient {
  override async get(url: string): Promise<HttpResponse> {
    return readSourceInBrowser(url);
  }
}
