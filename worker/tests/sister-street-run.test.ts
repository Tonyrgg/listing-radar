import { readFileSync } from "node:fs";
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

  it("ignora una riga con nessuna corrispondenza trovata e torna ai risultati", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url?.startsWith("/owners-no-match")) {
        response.end(`<!doctype html><body>
          <form name="SceltaIntestatiForm"><table class="listaIsp4">
            <tr><td>**NESSUNA CORRISPONDENZA TROVATA**</td></tr>
          </table></form>
          <form name="SceltaVisuraImmSoggForm" action="/results"><input name="indietro" type="submit" value="Indietro"></form>
        </body>`);
        return;
      }
      if (request.url?.startsWith("/results")) {
        response.end(`<!doctype html><body>
          <fieldset><legend>Dati della ricerca</legend>Comune: BITONTO Codice: A893 Indirizzo: VIA TEST Numeri civici</fieldset>
          <form name="SceltaVisuraImmSoggForm" action="/owners-no-match">
            <table class="listaIsp4">
              <tr><th></th><th>Foglio</th><th>Particella</th><th>Sub</th><th>Indirizzo</th><th>Zona cens</th><th>Categoria</th><th>Classe</th><th>Consistenza</th><th>Rendita</th></tr>
              <tr><td><input name="visImmSel" type="radio" value="1"></td><td>50</td><td>100</td><td>1</td><td>VIA TEST n. 1</td><td>U</td><td>A03</td><td>2</td><td>5 vani</td><td>400,00</td></tr>
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
      const acquired: string[] = [];
      const checkpoint = await new SisterStreetRun(page, {
        onPropertyAcquired: (_variant, property) => { acquired.push(property.parcel); },
      }).run("VIA TEST");

      expect(checkpoint).toMatchObject({
        status: "completed",
        totalAcceptedProperties: 0,
        totalSkippedPropertyRows: 1,
      });
      expect(acquired).toEqual([]);
      expect(checkpoint.results[0]?.warnings[0]).toContain("nessun proprietario interpretabile");
      expect(await page.locator('select[name="indirizzoSel"]').count()).toBe(1);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20_000);

  it("applica i filtri prima di aprire gli intestatari", async () => {
    let ownerRequests = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url?.startsWith("/owners")) {
        ownerRequests += 1;
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
              <tr><td><input name="visImmSel" type="radio" value="1"></td><td>50</td><td>100</td><td>1</td><td>VIA TEST n. 4 PIANO T</td><td>U</td><td>C06</td><td>2</td><td>20 mq</td><td>100,00</td></tr>
              <tr><td><input name="visImmSel" type="radio" value="2"></td><td>50</td><td>200</td><td>2</td><td>VIA TEST n. 12 PIANO 2</td><td>U</td><td>A03</td><td>2</td><td>5 vani</td><td>500,00</td></tr>
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
      const acquired: string[] = [];
      const checkpoint = await new SisterStreetRun(page, {
        filters: { residentialOnly: true, floorMode: "minimum", floorValue: 1, minCivicNumber: 10, maxCivicNumber: 20 },
        onPropertyAcquired: (_variant, property) => { acquired.push(property.parcel); },
      }).run("VIA TEST");

      expect(ownerRequests).toBe(1);
      expect(acquired).toEqual(["200"]);
      expect(checkpoint).toMatchObject({
        status: "completed",
        totalAcceptedProperties: 1,
        totalSkippedPropertyRows: 1,
        filters: { residentialOnly: true, floorMode: "minimum", floorValue: 1, minCivicNumber: 10, maxCivicNumber: 20 },
      });
      expect(checkpoint.results[0]?.filterSkips).toEqual({ non_strategic_category: 1 });
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20_000);

  it("riprova tre volte lo stesso record e poi continua senza bloccare la via", async () => {
    let ownerRequests = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url?.startsWith("/owners")) {
        ownerRequests += 1;
        const valid = ownerRequests === 3;
        response.end(`<!doctype html><body>
          <form name="SceltaIntestatiForm"><table class="listaIsp4">
            <tr><th>${valid ? "Nominativo o denominazione" : "Colonna non disponibile"}</th><th>${valid ? "Codice fiscale" : ""}</th><th>${valid ? "Titolarita" : ""}</th><th>${valid ? "Quota" : ""}</th></tr>
            <tr><td><input name="intestatoSelezionato"></td><td>${valid ? "ROSSI MARIO nato a BITONTO (BA) il 01/01/1970" : "dato temporaneamente non leggibile"}</td><td>${valid ? "RSSMRA70A01A893X" : ""}</td><td>${valid ? "Proprieta'" : ""}</td><td>${valid ? "1/1" : ""}</td></tr>
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
      const checkpoint = await new SisterStreetRun(page).run("VIA TEST");

      expect(ownerRequests).toBe(3);
      expect(checkpoint).toMatchObject({ status: "completed", totalAcceptedProperties: 1, totalOwnersRead: 1 });
      expect(checkpoint.totalSkippedPropertyRows).toBe(0);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20_000);
});

describe("preparazione automatica della via", () => {
  /**
   * SISTER servito in finto: form di ricerca, elenco indirizzi, risultati.
   *
   * Il form registra cosa gli e' stato chiesto, cosi' il test verifica che la
   * preparazione scelga BITONTO, il toponimo giusto e la dizione esatta invece
   * di limitarsi a constatare che la pagina e' cambiata.
   */
  function sisterFinto() {
    const richieste: Array<Record<string, string>> = [];
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      const [percorso, query] = (request.url ?? "/").split("?");
      if (percorso === "/cerca") {
        richieste.push(Object.fromEntries(new URLSearchParams(query ?? "")));
        response.end(`<!doctype html><body>
          <form name="SceltaIndirizzoForm" action="/results">
            <select name="indirizzoSel">
              <option value="542250#236#VIA BORGO SAN FRANCESCO">VIA BORGO SAN FRANCESCO</option>
              <option value="557509#236#VIA BORGO SAN FRANCESCO">VIA BORGO SAN FRANCESCO</option>
              <option value="38719#812#VIA PRIVATA BORGO SAN FRANCESCO">VIA PRIVATA BORGO SAN FRANCESCO</option>
            </select>
            <input name="numCivicoDal"><input name="numCivicoAl"><input name="ricerca" type="submit" value="Ricerca">
          </form>
        </body>`);
        return;
      }
      response.end(`<!doctype html><body>
        <form name="ricercaIndForm" action="/cerca" method="get">
          <select name="comuneCat"><option value="">Scegli</option><option value="A893">BITONTO</option><option value="A662">BARI</option></select>
          <select name="toponimo"><option value="0">TUTTI</option><option value="236">VIA</option><option value="812">VIALE</option></select>
          <input name="indirizzo">
          <label><input name="parIntera" type="radio" value="0">Contiene</label>
          <label><input name="parIntera" type="radio" value="1">Dizione esatta</label>
          <input name="ricerca" type="submit" value="Ricerca">
        </form>
      </body>`);
    });
    return { server, richieste };
  }

  it("compila comune, toponimo e dizione esatta, e tiene solo le omonimie esatte", async () => {
    const { server, richieste } = sisterFinto();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const run = new SisterStreetRun(page, {
        prepareSearchAutomatically: true,
        isCancelled: () => true,
      });

      const checkpoint = await run.run("via borgo san francesco");

      expect(richieste).toHaveLength(1);
      expect(richieste[0]).toMatchObject({
        comuneCat: "A893",
        toponimo: "236",
        indirizzo: "BORGO SAN FRANCESCO",
        parIntera: "1",
      });
      /* La via privata ha lo stesso nome dentro, ma non e' la stessa via. */
      expect(checkpoint.variants.map((variant) => variant.sourceId)).toEqual(["542250", "557509"]);
      expect(checkpoint.requestedStreet).toBe("VIA BORGO SAN FRANCESCO");
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it("senza preparazione automatica il comportamento resta quello di prima", async () => {
    const { server, richieste } = sisterFinto();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);

      await expect(new SisterStreetRun(page).run("via borgo san francesco")).rejects.toMatchObject({
        status: "needs_review",
        details: { action: "street-run-manual-address-list" },
      });
      expect(richieste).toHaveLength(0);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it("riusa l'Elenco indirizzi gia' aperto sulla via giusta senza rifare la ricerca", async () => {
    const { page, locator } = preparedAddressListPage([
      { text: "VIA BORGO SAN FRANCESCO", value: "542250#236#VIA BORGO SAN FRANCESCO" },
      { text: "VIA PRIVATA BORGO SAN FRANCESCO", value: "38719#812#VIA PRIVATA BORGO SAN FRANCESCO" },
    ]);
    const run = new SisterStreetRun(page, {
      prepareSearchAutomatically: true,
      isCancelled: () => true,
    });

    const checkpoint = await run.run("via borgo san francesco");

    expect(checkpoint.variants.map((variant) => variant.sourceId)).toEqual(["542250"]);
    /* Il form di ricerca non viene nemmeno cercato: la pagina buona era gia' li'. */
    expect(locator.mock.calls.map(([selector]) => selector)).not.toContain('form[name="ricercaIndForm"]');
  });

  it("il desktop chiede la preparazione automatica", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    expect(main).toContain("prepareSearchAutomatically: true,");
  });
});
