import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

import { connectToChrome, connectToCrmChrome, createParallelCrmPage, CRM_WORKER_HOME_URL } from "../src/services/chrome.js";

vi.mock("playwright", () => ({ chromium: { connectOverCDP: vi.fn() } }));

const SISTER_URL = "https://sister3.agenziaentrate.gov.it/Visure/vind/RicercaInd.do";
const CRM_URL = "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/";

type FakeTarget = { targetId: string; frameId: string; title: string; url: string };

/**
 * Chrome keeps answering about a tab whose main frame id drifted away from its
 * target id, while every Playwright call on that same tab waits forever: the
 * fake reproduces exactly that split.
 */
function browserWith(tabs: Array<{ playwrightUrl: string; target: FakeTarget }>) {
  const context: Record<string, unknown> = {
    newCDPSession: async (page: { target: FakeTarget }) => ({
      send: async (method: string) => {
        if (method === "Target.getTargetInfo") {
          return { targetInfo: { targetId: page.target.targetId, title: page.target.title, url: page.target.url } };
        }
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: page.target.frameId, url: page.target.url } } };
        }
        throw new Error(`Metodo CDP non previsto: ${method}`);
      },
      detach: async () => undefined,
    }),
  };
  const pages = tabs.map(({ playwrightUrl, target }) => ({
    target,
    url: () => playwrightUrl,
    title: () => (playwrightUrl ? Promise.resolve(target.title) : new Promise<string>(() => undefined)),
    context: () => context,
    close: vi.fn().mockResolvedValue(undefined),
  }));
  context.pages = () => pages;
  return { contexts: () => [context], close: vi.fn().mockResolvedValue(undefined) };
}

const healthyCrm = {
  playwrightUrl: CRM_URL,
  target: { targetId: "crm-target", frameId: "crm-target", title: "Immobile Elenco", url: CRM_URL },
};

function crmRecoveryFixture() {
  const browser = browserWith([
    { playwrightUrl: SISTER_URL, target: { targetId: "sister", frameId: "sister", title: "SISTER", url: SISTER_URL } },
    { playwrightUrl: "", target: { targetId: "crm", frameId: "prerender-frame", title: "Immobile", url: CRM_URL + "immobile/non-salvato" } },
  ]);
  const context = browser.contexts()[0]!;
  const pages = (context.pages as () => Array<unknown>)();
  const recovered = {
    url: () => CRM_URL, title: async () => "Gestionale",
    context: () => context,
    goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const newPage = vi.fn().mockImplementation(async () => { pages.push(recovered); return recovered; });
  context.newPage = newPage;
  vi.mocked(chromium.connectOverCDP).mockResolvedValue(browser as never);
  return { browser, original: pages[1] as { close: ReturnType<typeof vi.fn> }, recovered, newPage, context };
}

describe("schede Chrome pilotabili", () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("riaggancia il gestionale nella stessa sessione senza toccare la scheda originale e lo riusa", async () => {
    const { original, recovered, newPage, browser } = crmRecoveryFixture();
    const tabs = await connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm");
    expect(tabs.crmPage).toBe(recovered);
    expect(tabs.pages.map(tab => tab.page)).toContain(recovered);
    expect(recovered.goto).toHaveBeenCalledWith(CRM_WORKER_HOME_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
    expect(recovered.evaluate).toHaveBeenCalledOnce();
    expect(original.close).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
    expect((await connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).crmPage).toBe(recovered);
    expect(newPage).toHaveBeenCalledOnce();
  });

  it("riaggancia anche durante una ripresa che richiede soltanto il gestionale", async () => {
    const { recovered, original } = crmRecoveryFixture();
    const tabs = await connectToCrmChrome("ws://127.0.0.1:9222/devtools/browser/fake", "crm");
    expect(tabs.crmPage).toBe(recovered);
    expect(original.close).not.toHaveBeenCalled();
  });

  it("non ricrea una scheda già sana", async () => {
    const { context, newPage } = crmRecoveryFixture();
    const pages = (context.pages as () => Array<unknown>)();
    pages.splice(1, 1, { url: () => CRM_URL, title: async () => "Gestionale" });
    await connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm");
    expect(newPage).not.toHaveBeenCalled();
  });

  it("riusa l'accesso Tecnocloud nella stessa sessione senza moltiplicare schede dopo una scadenza", async () => {
    const { context, newPage } = crmRecoveryFixture();
    const login = { url: () => "https://ui.tecnocasa.com/login", title: async () => "Accedi", context: () => context };
    (context.pages as () => Array<unknown>)().push(login);
    expect((await connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).crmPage).toBe(login);
    expect((await connectToCrmChrome("ws://127.0.0.1:9222/devtools/browser/fake", "crm")).crmPage).toBe(login);
    expect(newPage).not.toHaveBeenCalled();
  });

  it("la creazione fallita di una nuova pagina non chiude quella originale", async () => {
    const { newPage, original, browser } = crmRecoveryFixture();
    newPage.mockRejectedValue(new Error("Chrome occupato"));
    await expect(connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).rejects.toMatchObject({ details: { notDriveable: ["gestionale"] } });
    expect(original.close).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("se il recupero fallisce chiude solo la propria nuova scheda e libera il collegamento", async () => {
    const { recovered, original, browser } = crmRecoveryFixture();
    recovered.goto.mockRejectedValue(new Error("Navigazione fallita"));
    await expect(connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).rejects.toMatchObject({ details: { notDriveable: ["gestionale"] } });
    expect(recovered.close).toHaveBeenCalledOnce();
    expect(original.close).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("non considera recuperata una navigazione senza un contesto di esecuzione", async () => {
    vi.useFakeTimers();
    const { recovered, original, browser } = crmRecoveryFixture();
    recovered.evaluate.mockImplementation(() => new Promise(() => undefined));
    const result = expect(connectToCrmChrome("ws://127.0.0.1:9222/devtools/browser/fake", "crm")).rejects.toMatchObject({ details: { notDriveable: ["gestionale"] } });
    await vi.runAllTimersAsync(); await result;
    expect(original.close).not.toHaveBeenCalled();
    expect(recovered.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("non lascia l'avvio sospeso se il protocollo non risponde", async () => {
    vi.useFakeTimers();
    const { context, browser } = crmRecoveryFixture();
    context.newCDPSession = async () => ({ send: () => new Promise(() => undefined), detach: vi.fn().mockResolvedValue(undefined) });
    const result = expect(connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).rejects.toMatchObject({ details: { missing: ["CRM"] } });
    await vi.runAllTimersAsync(); await result;
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("non apre una destinazione arbitraria ricavata dal titolo di una scheda", async () => {
    const { browser, newPage, context } = crmRecoveryFixture();
    const pages = (context.pages as () => Array<{ target: FakeTarget }>)();
    pages[1]!.target.url = "https://example.invalid/CRMImmobiliareLightning/s/";
    await expect(connectToCrmChrome("ws://127.0.0.1:9222/devtools/browser/fake", "crm")).rejects.toMatchObject({ details: { notDriveable: ["gestionale"] } });
    expect(newPage).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("riconosce la scheda anche quando Playwright non ne espone l'indirizzo", async () => {
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(browserWith([
      { playwrightUrl: "", target: { targetId: "sister-target", frameId: "sister-target", title: "Elenco indirizzi", url: SISTER_URL } },
      healthyCrm,
    ]) as never);
    const tabs = await connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm");
    expect(tabs.pages.map(({ title, url }) => ({ title, url }))).toEqual([
      { title: "Elenco indirizzi", url: SISTER_URL },
      { title: "Immobile Elenco", url: CRM_URL },
    ]);
  });

  it("non scambia una scheda aperta ma non pilotabile per una scheda mancante", async () => {
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(browserWith([
      { playwrightUrl: "", target: { targetId: "sister-target", frameId: "frame-disallineato", title: "Elenco indirizzi", url: SISTER_URL } },
      healthyCrm,
    ]) as never);
    await expect(connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).rejects.toMatchObject({
      message: expect.stringContaining("non pilotabile"),
      status: "needs_review",
      details: { notDriveable: ["SISTER"] },
    });
  });

  it("segnala ancora come mancante una scheda che il browser non conosce", async () => {
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(browserWith([healthyCrm]) as never);
    await expect(connectToChrome("ws://127.0.0.1:9222/devtools/browser/fake", "sister", "crm")).rejects.toMatchObject({
      message: "Schede richieste non trovate in Chrome",
      details: { missing: ["SISTER"] },
    });
  });

  it("apre la seconda pagina nella stessa sessione del Chrome di lavoro", async () => {
    const body = { waitFor: vi.fn().mockResolvedValue(undefined) };
    const secondary = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue(body),
      evaluate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = { pages: () => [], newPage: vi.fn().mockResolvedValue(secondary) };
    const primary = { context: () => context };

    await expect(createParallelCrmPage(primary as never)).resolves.toBe(secondary);
    expect(context.newPage).toHaveBeenCalledOnce();
    expect(secondary.goto).toHaveBeenCalledWith(CRM_WORKER_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    expect(secondary.evaluate).toHaveBeenCalledOnce();
  });

  it("riusa una pagina parallela rimasta da una chiusura precedente", async () => {
    const primary = {};
    const reusable = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({ waitFor: vi.fn().mockResolvedValue(undefined) }),
      evaluate: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = { pages: () => [primary, reusable], newPage: vi.fn() };
    Object.assign(primary, { context: () => context });

    await expect(createParallelCrmPage(primary as never)).resolves.toBe(reusable);
    expect(context.newPage).not.toHaveBeenCalled();
    expect(reusable.goto).toHaveBeenCalledWith(CRM_WORKER_HOME_URL, expect.any(Object));
  });
});
