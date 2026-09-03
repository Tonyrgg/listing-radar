import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

import { connectToChrome } from "../src/services/chrome.js";

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
  }));
  context.pages = () => pages;
  return { contexts: () => [context] };
}

const healthyCrm = {
  playwrightUrl: CRM_URL,
  target: { targetId: "crm-target", frameId: "crm-target", title: "Immobile Elenco", url: CRM_URL },
};

describe("schede Chrome pilotabili", () => {
  beforeEach(() => {
    vi.mocked(chromium.connectOverCDP).mockReset();
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
});
