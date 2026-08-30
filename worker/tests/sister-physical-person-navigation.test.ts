import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { PlaywrightSisterAdapter } from "../src/adapters/sister/index.js";
import { sisterSelectors } from "../src/adapters/sister/selectors.js";

/**
 * SISTER portato da solo sulla ricerca Persona fisica.
 *
 * L'adapter si limitava a tornare indietro qualche volta: se la scheda era su
 * un'altra pagina — l'elenco indirizzi, per dire — l'esplorazione della rete
 * si fermava e chiedeva all'operatore di aprire il modulo a mano. Il menu di
 * SISTER quella voce ce l'ha gia'.
 */

const MENU = `
  <a href="/Visure/SceltaLink.do?lista=PF&codUfficio=BA">Persona fisica</a>
  <a href="/Visure/SceltaLink.do?lista=PNF&codUfficio=BA">Persona giuridica</a>
  <a href="/Visure/SceltaLink.do?lista=IND&codUfficio=BA">Indirizzo</a>`;

function sisterFinto() {
  const visitati: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const url = request.url ?? "/";
    visitati.push(url);
    if (url.includes("lista=PF")) {
      response.end(`<!doctype html><body>${MENU}
        <form name="RicercaPFForm" action="/risultati" method="get">
          <select name="tipoCatasto"><option value="F">Fabbricati</option><option value="T">Terreni</option></select>
          <select name="comuneCat"><option value="">Scegli</option><option value="A893">BITONTO</option></select>
          <label><input name="selDatiAna" type="radio" value="CF_PF">Codice fiscale</label>
          <input name="cod_fisc_pf">
          <input name="ricerca" type="submit" value="Ricerca">
        </form></body>`);
      return;
    }
    if (url.startsWith("/risultati")) {
      response.end(`<!doctype html><body>${MENU}<p>Nessuna corrispondenza trovata</p></body>`);
      return;
    }
    /* La pagina di partenza: il menu c'e', il modulo Persona fisica no. */
    response.end(`<!doctype html><body>${MENU}
      <form name="ricercaIndForm"><input name="indirizzo"></form></body>`);
  });
  return { server, visitati };
}

describe("ricerca Persona fisica raggiunta dal menu", () => {
  it("ci arriva da una pagina qualsiasi e conserva l'ufficio scelto", async () => {
    const { server, visitati } = sisterFinto();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/Visure/SceltaLink.do?lista=IND&codUfficio=BA`);
      const adapter = new PlaywrightSisterAdapter(page, sisterSelectors);

      const immobili = await adapter.searchPhysicalPersonByTaxCode("RSSMRA70A01A893X");

      /* Nessuna corrispondenza non e' un errore: e' una risposta. */
      expect(immobili).toEqual([]);
      /* Dopo l'invio si e' sulla pagina dei risultati, non piu' sul modulo:
       * la prova che il modulo e' stato raggiunto e' che sia stato visitato. */
      expect(visitati.some((url) => url.includes("lista=PF"))).toBe(true);

      /* La voce viene presa com'e' scritta: l'ufficio resta quello scelto. */
      const arrivo = visitati.find((url) => url.includes("lista=PF"));
      expect(arrivo).toContain("codUfficio=BA");
      /* La persona giuridica non deve mai essere confusa con la fisica. */
      expect(visitati.some((url) => url.includes("lista=PNF"))).toBe(false);

      const inviata = visitati.find((url) => url.startsWith("/risultati"));
      expect(inviata).toContain("cod_fisc_pf=RSSMRA70A01A893X");
      expect(inviata).toContain("tipoCatasto=F");
      expect(inviata).toContain("selDatiAna=CF_PF");
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it("rifiuta un codice fiscale che non ne ha la lunghezza, senza toccare il portale", async () => {
    const { server, visitati } = sisterFinto();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/Visure/SceltaLink.do?lista=IND&codUfficio=BA`);
      const partenza = visitati.length;
      const adapter = new PlaywrightSisterAdapter(page, sisterSelectors);

      await expect(adapter.searchPhysicalPersonByTaxCode("TROPPO-CORTO")).rejects.toMatchObject({
        status: "data_incomplete",
      });
      expect(visitati.length).toBe(partenza);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);
});
