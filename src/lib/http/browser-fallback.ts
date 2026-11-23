import { createRequire } from "node:module";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { HttpClient, type HttpClientOptions, type HttpRequestOptions, type HttpResponse } from "./client";

// Only the two agency adapters opt in. No stealth plugins, proxy rotation or
// challenge solving: a browser denial remains a failed source observation.
const HOSTS = new Set(["casa.it", "www.casa.it", "studisantiimmobiliare.it", "www.studisantiimmobiliare.it", "www.trovacasa.it", "www.idealista.it", "www.immobiliare.it", "www.subito.it", "www.casadaprivato.it"]);
const requireRuntime = createRequire(`${process.cwd()}/package.json`);
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let tail: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const deniedUntil = new Map<string, number>();

export async function closeSourceBrowser(): Promise<void> {
  clearTimeout(idleTimer);
  const current = browser;
  context = undefined;
  browser = undefined;
  await current?.close();
}

export async function readSourceInBrowser(url: string, extract?: (page: Page) => Promise<unknown>): Promise<HttpResponse & { extracted?: unknown }> {
  const requested = new URL(url);
  if (requested.protocol !== "https:" || !HOSTS.has(requested.hostname)) throw new Error("Source browser URL outside allowed agencies");
  const run = tail.then(async () => {
    clearTimeout(idleTimer);
    try {
      if ((deniedUntil.get(requested.hostname) ?? 0) > Date.now()) throw new Error("Source browser temporarily suspended after access denial");
      if (!browser?.isConnected()) {
        // Runtime-only dependency: never bundle Chromium into the web app.
        const { chromium } = requireRuntime("@playwright/test") as typeof import("@playwright/test");
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ locale: "it-IT" });
        await context.route("**/*", async route => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) {
            const target = new URL(request.url());
            if (target.protocol !== "https:" || !HOSTS.has(target.hostname)) return route.abort();
          }
          if (["image", "media", "font"].includes(request.resourceType())) return route.abort();
          return route.continue();
        });
      }
      const page = await context!.newPage();
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!response) throw new Error("Source browser returned no response");
        const status = response.status();
        if ([403, 429].includes(status)) deniedUntil.set(requested.hostname, Date.now() + 5 * 60_000);
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
