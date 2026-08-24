import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import { SisterStreetRun } from "../src/services/sister-street-run.js";

function preparedAddressListPage(options: Array<{ text: string; value: string }>) {
  const optionLocator = {
    evaluateAll: vi.fn().mockResolvedValue(options),
  };
  const selectLocator = {
    count: vi.fn().mockResolvedValue(1),
    locator: vi.fn().mockReturnValue(optionLocator),
  };
  const emptyLocator = {
    count: vi.fn().mockResolvedValue(0),
  };
  const locator = vi.fn((selector: string) => selector.includes("SceltaIndirizzoForm")
    ? selectLocator
    : emptyLocator);
  return {
    page: {
      url: () => "https://sister3.agenziaentrate.gov.it/Visure/vind/IndietroSceltaIndirizzo.do",
      title: vi.fn().mockResolvedValue("Elenco indirizzi"),
      locator,
    } as unknown as Page,
    locator,
  };
}

describe("run lunga SISTER dalla pagina preparata manualmente", () => {
  it("legge soltanto le omonimie esatte gia' visibili senza aprire il form di ricerca", async () => {
    const { page, locator } = preparedAddressListPage([
      { text: "VIA BORGO SAN FRANCESCO", value: "542250#236#VIA BORGO SAN FRANCESCO" },
      { text: "VIA BORGO SAN FRANCESCO", value: "557509#236#VIA BORGO SAN FRANCESCO" },
      { text: "VIA PRIVATA BORGO SAN FRANCESCO", value: "38719#812#VIA PRIVATA BORGO SAN FRANCESCO" },
    ]);
    const run = new SisterStreetRun(page, { isCancelled: () => true });

    const checkpoint = await run.run("via borgo san francesco");

    expect(checkpoint.status).toBe("paused");
    expect(checkpoint.variants.map((variant) => variant.sourceId)).toEqual(["542250", "557509"]);
    expect(locator.mock.calls.map(([selector]) => selector)).not.toContain('form[name="ricercaIndForm"]');
  });

  it("non tenta di indovinare la navigazione quando Elenco indirizzi non e' aperto", async () => {
    const page = {
      url: () => "https://sister3.agenziaentrate.gov.it/Visure/",
      title: vi.fn().mockResolvedValue("SISTER"),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
    } as unknown as Page;
    const run = new SisterStreetRun(page);

    await expect(run.run("via borgo san francesco")).rejects.toMatchObject({
      status: "needs_review",
      details: { action: "street-run-manual-address-list" },
    });
  });
});
