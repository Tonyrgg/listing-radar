import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { matchesWorkerPortal, type WorkerPortal } from "../core/browser-page-matching.js";
import { WorkerError } from "../core/errors.js";

export interface DescribedPage {
  title: string;
  url: string;
  page: Page;
  /** False when Playwright cannot act on the tab, however healthy it looks in Chrome. */
  driveable: boolean;
}

export interface ChromeTabs {
  browser: Browser;
  pages: DescribedPage[];
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

/**
 * Chrome keeps a tab's identity at browser level, so it stays readable even
 * when Playwright's own view of that tab is unusable. `driveable` says
 * whether Playwright can act on the page at all: a tab whose main frame id
 * no longer matches its target id answers no execution context, so every
 * Playwright call on it waits forever.
 */
async function targetIdentity(page: Page): Promise<{ title: string; url: string; driveable: boolean } | null> {
  let session: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
  try {
    session = await page.context().newCDPSession(page);
    const [target, tree] = await Promise.all([
      session.send("Target.getTargetInfo"),
      session.send("Page.getFrameTree"),
    ]);
    return {
      title: target.targetInfo.title ?? "",
      url: tree.frameTree.frame.url || target.targetInfo.url || "",
      driveable: target.targetInfo.targetId === tree.frameTree.frame.id,
    };
  } catch {
    return null;
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

async function describePage(page: Page): Promise<DescribedPage> {
  /* Una scheda occupata puo' non rispondere a `document.title` per quasi un
   * minuto. L'URL e' gia' disponibile senza round-trip ed e' sufficiente per
   * riconoscere SISTER e gestionale; il titolo resta un aiuto, mai un freno
   * all'avvio della run. */
  const url = page.url();
  if (url) return { title: await pageTitleWithin(page), url, page, driveable: true };
  /* URL vuoto significa che il modello interno di Playwright per questa
   * scheda e' vuoto, non che la scheda non esista: il browser la conosce
   * ancora. Chiederlo a lui evita di scambiare una scheda aperta ma non
   * pilotabile per una scheda mai aperta, e non paga l'attesa del titolo. */
  const identity = await targetIdentity(page);
  return { title: identity?.title ?? "", url: identity?.url ?? "", page, driveable: identity?.driveable ?? false };
}

function findMatchingPage(
  pages: DescribedPage[],
  match: string,
  portal: WorkerPortal,
): DescribedPage | undefined {
  return pages.find((page) => matchesWorkerPortal(page, match, portal));
}

export interface CrmChromeTab {
  browser: Browser;
  pages: Array<{ title: string; url: string; page: Page }>;
  crmPage: Page;
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
  const sisterTab = findMatchingPage(described, sisterMatch, "sister");
  const crmTab = findMatchingPage(described, crmMatch, "crm");
  const openTabs = described.map(({ title, url }) => ({ title, url }));
  if (!sisterTab || !crmTab) {
    throw new WorkerError("Schede richieste non trovate in Chrome", "needs_review", {
      missing: [!sisterTab ? "SISTER" : null, !crmTab ? "CRM" : null].filter(Boolean),
      openTabs,
    });
  }
  /* Una scheda riconosciuta ma non pilotabile non torna utilizzabile ne'
   * aspettando ne' ricaricandola: solo riaprirla le restituisce un target
   * sano. Fermarsi qui con il motivo esatto evita una run che parte e resta
   * appesa alla prima azione sul portale. */
  const notDriveable = [
    !sisterTab.driveable ? "SISTER" : null,
    !crmTab.driveable ? "gestionale" : null,
  ].filter((label): label is string => label !== null);
  if (notDriveable.length) {
    const [subject, verb] = notDriveable.length > 1
      ? [`le schede ${notDriveable.join(" e ")}`, "sono aperte ma non pilotabili. Chiudile, riaprile"]
      : [`la scheda ${notDriveable[0]}`, "è aperta ma non pilotabile. Chiudila, riaprila"];
    throw new WorkerError(
      `Chrome non espone all'automazione ${subject}: ${verb} e riavvia.`,
      "needs_review",
      { notDriveable, openTabs },
    );
  }
  return { browser, pages: described, sisterPage: sisterTab.page, crmPage: crmTab.page };
}

/** Connects to the worker-owned Chrome when a CRM-only maintenance task does not need SISTER. */
export async function connectToCrmChrome(cdpUrl: string, crmMatch: string): Promise<CrmChromeTab> {
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
  let crmPage = findMatchingPage(pages, crmMatch, "crm")?.page;
  crmPage ??= pages.find(({ title, url }) =>
    /Universal Identity|Accedi/i.test(title) || /ui\.tecnocasa\.com\/login/i.test(url))?.page;
  if (!crmPage) {
    const context = browser.contexts()[0];
    if (!context) throw new WorkerError("Nessun profilo Chrome disponibile", "session_expired");
    crmPage = await context.newPage();
    await crmPage.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  }
  return { browser, pages, crmPage };
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
