import { chromium, type Browser, type Page } from "playwright";

import { matchesWorkerPortal, type WorkerPortal } from "../core/browser-page-matching.js";
import { WorkerError } from "../core/errors.js";

export interface ChromeTabs {
  browser: Browser;
  pages: Array<{ title: string; url: string; page: Page }>;
  sisterPage: Page;
  crmPage: Page;
}

export interface RequestArchiveChrome {
  browser: Browser;
  pages: Array<{ title: string; url: string; page: Page }>;
  archivePage: Page;
}

export type MandateArchiveChrome = RequestArchiveChrome;

export const CRM_REQUEST_ARCHIVE_URL = "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/query?Id=a0Q3Y00000ecMlzUAE";
export const CRM_MANDATE_ARCHIVE_URL = "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/query?Id=a0Q3Y00000echeFUAQ";

async function resolveCdpEndpoint(cdpUrl: string): Promise<string> {
  if (/^wss?:\/\//i.test(cdpUrl)) return cdpUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { webSocketDebuggerUrl?: string };
    if (!payload.webSocketDebuggerUrl) throw new Error("webSocketDebuggerUrl assente");
    return payload.webSocketDebuggerUrl;
  } finally {
    clearTimeout(timeout);
  }
}

export async function pageTitleWithin(
  page: Pick<Page, "title">,
  timeoutMs = 3_000,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      page.title().catch(() => ""),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function describePage(page: Page) {
  /* Una scheda occupata puo' non rispondere a `document.title` per quasi un
   * minuto. L'URL e' gia' disponibile senza round-trip ed e' sufficiente per
   * riconoscere SISTER e gestionale; il titolo resta un aiuto, mai un freno
   * all'avvio della run. */
  return { title: await pageTitleWithin(page), url: page.url(), page };
}

function findMatchingPage(
  pages: Array<{ title: string; url: string; page: Page }>,
  match: string,
  portal: WorkerPortal,
): Page | undefined {
  return pages.find((page) => matchesWorkerPortal(page, match, portal))?.page;
}

export async function connectToChrome(
  cdpUrl: string,
  sisterMatch: string,
  crmMatch: string,
): Promise<ChromeTabs> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(await resolveCdpEndpoint(cdpUrl), { timeout: 10_000 });
  } catch (error) {
    throw new WorkerError(
      `Chrome non raggiungibile su ${cdpUrl}. Avvialo con --remote-debugging-port=9222.`,
      "session_expired",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const described = await Promise.all(browser.contexts().flatMap((context) => context.pages()).map(describePage));
  const sisterPage = findMatchingPage(described, sisterMatch, "sister");
  const crmPage = findMatchingPage(described, crmMatch, "crm");
  if (!sisterPage || !crmPage) {
    throw new WorkerError("Schede richieste non trovate in Chrome", "needs_review", {
      missing: [!sisterPage ? "SISTER" : null, !crmPage ? "CRM" : null].filter(Boolean),
      openTabs: described.map(({ title, url }) => ({ title, url })),
    });
  }
  return { browser, pages: described, sisterPage, crmPage };
}

async function connectToCrmArchiveChrome(
  cdpUrl: string,
  recordSelector: string,
  archiveLabel: "richieste" | "incarichi",
  archiveUrl: string,
): Promise<RequestArchiveChrome> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(await resolveCdpEndpoint(cdpUrl), { timeout: 30_000 });
  } catch (error) {
    throw new WorkerError(
      `Chrome non raggiungibile su ${cdpUrl}. Avvialo con --remote-debugging-port=9222.`,
      "session_expired",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const pages = await Promise.all(browser.contexts().flatMap((context) => context.pages()).map(describePage));
  let archivePage: Page | undefined;
  for (const candidate of pages.filter(({ url }) => {
    try {
      return new URL(url).toString() === archiveUrl;
    } catch {
      return false;
    }
  })) {
    if (await candidate.page.locator(recordSelector).count().catch(() => 0)) {
      archivePage = candidate.page;
      break;
    }
  }
  if (!archivePage) {
    const context = browser.contexts()[0];
    if (!context) throw new WorkerError("Nessun profilo Chrome disponibile per aprire l'archivio CRM.", "session_expired", { archiveLabel });
    archivePage = await context.newPage();
    try {
      await archivePage.goto(archiveUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await archivePage.locator(recordSelector).first().waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      await archivePage.close().catch(() => undefined);
      throw new WorkerError(
        `Impossibile aprire automaticamente l'archivio ${archiveLabel} o leggerne l'elenco.`,
        "needs_review",
        { archiveLabel, archiveUrl, cause: error instanceof Error ? error.message : String(error), openTabs: pages.map(({ title, url }) => ({ title, url })) },
        true,
      );
    }
  }
  if (!archivePage) {
    await browser.close().catch(() => undefined);
    throw new WorkerError(
      `La pagina dell'archivio ${archiveLabel} non è aperta in Chrome. Apri la ricerca con l'elenco corretto e riprova.`,
      "needs_review",
      { openTabs: pages.map(({ title, url }) => ({ title, url })) },
      true,
    );
  }
  return { browser, pages, archivePage };
}

export async function connectToRequestArchiveChrome(cdpUrl: string): Promise<RequestArchiveChrome> {
  return connectToCrmArchiveChrome(cdpUrl, 'a[href*="/richiestaimmobiliare/"]', "richieste", CRM_REQUEST_ARCHIVE_URL);
}

export async function connectToMandateArchiveChrome(cdpUrl: string): Promise<MandateArchiveChrome> {
  return connectToCrmArchiveChrome(cdpUrl, 'a[href*="/incarico/"]', "incarichi", CRM_MANDATE_ARCHIVE_URL);
}

export function isPresumablyAuthenticated(page: Page): boolean {
  const value = page.url().toLowerCase();
  return !/(login|signin|accesso|autenticazione|logout-success|sessione[_-]?scaduta)/.test(value);
}
