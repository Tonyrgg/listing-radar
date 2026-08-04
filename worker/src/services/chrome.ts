import { chromium, type Browser, type Page } from "playwright";

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

async function describePage(page: Page) {
  return { title: await page.title().catch(() => ""), url: page.url(), page };
}

function findMatchingPage(
  pages: Array<{ title: string; url: string; page: Page }>,
  match: string,
): Page | undefined {
  const needle = match.toLocaleLowerCase("it");
  return pages.find(({ title, url }) => `${title} ${url}`.toLocaleLowerCase("it").includes(needle))?.page;
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
  const sisterPage = findMatchingPage(described, sisterMatch);
  const crmPage = findMatchingPage(described, crmMatch);
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
): Promise<RequestArchiveChrome> {
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
  const pages = await Promise.all(browser.contexts().flatMap((context) => context.pages()).map(describePage));
  let archivePage: Page | undefined;
  for (const candidate of pages.filter(({ url }) => /\/CRMImmobiliareLightning\/s\/query(?:\?|$)/i.test(url))) {
    if (await candidate.page.locator(recordSelector).count().catch(() => 0)) {
      archivePage = candidate.page;
      break;
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
  return connectToCrmArchiveChrome(cdpUrl, 'a[href*="/richiestaimmobiliare/"]', "richieste");
}

export async function connectToMandateArchiveChrome(cdpUrl: string): Promise<MandateArchiveChrome> {
  return connectToCrmArchiveChrome(cdpUrl, 'a[href*="/incarico/"]', "incarichi");
}

export function isPresumablyAuthenticated(page: Page): boolean {
  const value = page.url().toLowerCase();
  return !/(login|signin|accesso|autenticazione|logout-success|sessione[_-]?scaduta)/.test(value);
}
