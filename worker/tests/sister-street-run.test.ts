import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";
import { chromium, type Page } from "playwright";

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

  it("riprende una variante dal primo immobile non ancora acquisito", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url?.startsWith("/owners")) {
        response.end(`<!doctype html><body>
          <form name="SceltaIntestatiForm"><table class="listaIsp4">
            <tr><th></th><th>Nominativo o denominazione</th><th>Codice fiscale</th><th>Titolarita</th><th>Quota</th></tr>
            <tr><td><input name="intestatoSelezionato"></td><td>ROSSI MARIO nato a BITONTO (BA) il 01/01/1970</td><td>RSSMRA70A01A893X</td><td>Proprieta'</td><td>1/1</td></tr>
          </table></form>
          <form name="SceltaVisuraImmSoggForm" action="/results"><input name="indietro" type="submit" value="Indietro"></form>
        </body>`);
        return;
      }
      if (request.url?.startsWith("/results")) {
        response.end(`<!doctype html><body>
          <fieldset><legend>Dati della ricerca</legend>Comune: BITONTO Codice: A893 Indirizzo: VIA TEST Numeri civici</fieldset>
          <form name="SceltaVisuraImmSoggForm" action="/owners">
            <table class="listaIsp4">
              <tr><th></th><th>Foglio</th><th>Particella</th><th>Sub</th><th>Indirizzo</th><th>Zona cens</th><th>Categoria</th><th>Classe</th><th>Consistenza</th><th>Rendita</th></tr>
              <tr><td><input name="visImmSel" type="radio" value="1"></td><td>50</td><td>100</td><td>1</td><td>VIA TEST n. 1</td><td>U</td><td>A03</td><td>2</td><td>5 vani</td><td>400,00</td></tr>
              <tr><td><input name="visImmSel" type="radio" value="2"></td><td>50</td><td>200</td><td>2</td><td>VIA TEST n. 2</td><td>U</td><td>A03</td><td>2</td><td>5 vani</td><td>500,00</td></tr>
            </table>
            <input name="intestati" type="submit" value="Intestati">
          </form>
          <form name="SceltaIndirizzoForm" action="/addresses"><input type="submit" value="Indietro"></form>
        </body>`);
        return;
      }
      response.end(`<!doctype html><body>
        <form name="SceltaIndirizzoForm" action="/results">
          <select name="indirizzoSel"><option value="test##VIA TEST">VIA TEST</option></select>
          <input name="numCivicoDal"><input name="numCivicoAl"><input name="ricerca" type="submit" value="Ricerca">
        </form>
      </body>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/addresses`);
      let stop = false;
      const firstAcquired: string[] = [];
      const first = await new SisterStreetRun(page, {
        onPropertyAcquired: (_variant, property) => { firstAcquired.push(property.parcel); },
        onProgress: (progress) => {
          if (progress.phase === "reading-owners" && progress.current >= 1) stop = true;
        },
        isCancelled: () => stop,
      }).run("VIA TEST");

      stop = false;
      const resumedAcquired: string[] = [];
      const resumed = await new SisterStreetRun(page, {
        onPropertyAcquired: (_variant, property) => { resumedAcquired.push(property.parcel); },
        onProgress: (progress) => {
          if (progress.phase === "reading-owners" && progress.current >= 2) stop = true;
        },
        isCancelled: () => stop,
      }).run("VIA TEST", first);

      expect(first).toMatchObject({ status: "paused", totalAcceptedProperties: 1, totalOwnersRead: 1 });
      expect(firstAcquired).toEqual(["100"]);
      expect(resumed).toMatchObject({ status: "completed", totalAcceptedProperties: 2, totalOwnersRead: 2 });
      expect(resumedAcquired).toEqual(["200"]);
      expect(await page.locator('select[name="indirizzoSel"]').count()).toBe(1);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20_000);
});
