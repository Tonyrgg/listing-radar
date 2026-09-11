import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { PlaywrightSisterAdapter } from "../src/adapters/sister/index.js";
import { sisterSelectors } from "../src/adapters/sister/selectors.js";

const resultPage = (portfolio = false, owner = "") => `<!doctype html><body>
  <fieldset><legend>${portfolio ? "Soggetto selezionato" : "Dati della ricerca"}</legend>
    ${portfolio ? `Cognome: ${owner} Immobili nel comune di: BITONTO Codice: A893` : "Comune: BITONTO Codice: A893 Indirizzo: VIA TEST Numeri civici"}
  </fieldset>
  <form name="SceltaVisuraImmSoggForm" action="${portfolio ? "/owners" : "/owners"}">
    <table class="listaIsp4">
      <tr><th></th>${portfolio ? "<th>Catasto</th><th>Titolarita</th><th>Ubicazione</th>" : ""}<th>Foglio</th><th>Particella</th><th>Sub</th>${portfolio ? "<th>Classamento</th>" : "<th>Indirizzo</th><th>Zona cens</th><th>Categoria</th>"}<th>Classe</th><th>Consistenza</th><th>Rendita</th></tr>
      ${portfolio
        ? `<tr><td><input name="visImmSel" type="radio" value="1"></td><td>F</td><td>Proprieta' per 1/3</td><td>BITONTO(BA) VIA ${owner} n. 7 Piano 1</td><td>51</td><td>${owner === "ROSSI" ? "701" : "702"}</td><td>1</td><td>Cat.A/2</td><td>2</td><td>5 vani</td><td>400,00</td></tr>`
        : `<tr><td><input name="visImmSel" type="radio" value="1"></td><td>50</td><td>100</td><td>1</td><td>VIA TEST n. 1 Piano 1</td><td>U</td><td>A/2</td><td>2</td><td>5 vani</td><td>400,00</td></tr>`}
    </table>
    <input name="intestati" type="submit" value="Intestati">
    ${portfolio ? '<input name="indietro" type="submit" value="Indietro">' : ""}
  </form>
</body>`;

const ownersPage = `<!doctype html><body>
  <form name="SceltaIntestatiForm" action="/portfolio">
    <table class="listaIsp4">
      <tr><th></th><th>Nominativo o denominazione</th><th>Codice fiscale</th><th>Titolarita</th><th>Quota</th></tr>
      <tr><td><input name="intestatoSelezionato" type="radio" value="ROSSI"></td><td>ROSSI MARIO nato a BITONTO (BA) il 01/01/1970</td><td>RSSMRA70A01A893X</td><td>Proprieta'</td><td>1/2</td></tr>
      <tr><td><input name="intestatoSelezionato" type="radio" value="BIANCHI"></td><td>BIANCHI ANNA nata a BITONTO (BA) il 02/02/1980</td><td>BNCNNA80B42A893X</td><td>Proprieta'</td><td>1/2</td></tr>
    </table>
    <input name="immobili" type="submit" value="Immobili">
  </form>
  <form name="SceltaVisuraImmSoggForm" action="/results"><input name="indietro" type="submit" value="Indietro"></form>
</body>`;

describe("sviluppo diretto dei proprietari SISTER", () => {
  it("apre Immobili per ogni intestatario, raccoglie il portafoglio e torna alla riga originaria", async () => {
    const visits: string[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      visits.push(`${url.pathname}${url.search}`);
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (url.pathname === "/owners") response.end(ownersPage);
      else if (url.pathname === "/portfolio") response.end(resultPage(true, url.searchParams.get("intestatoSelezionato") ?? ""));
      else response.end(resultPage());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/results`);
      const adapter = new PlaywrightSisterAdapter(page, sisterSelectors);
      const [source] = await adapter.extractProperties();
      const expanded: Array<{ taxCode: string | null; parcel: string; share: number | null }> = [];
      const owners = await adapter.extractOwners(source!, {
        shouldExpand: () => true,
        onProperties: (owner, properties) => {
          const selected = properties[0]!.rawPayload.expanded_owner_ownership as { sharePercentage: number | null };
          expanded.push({ taxCode: owner.taxCode, parcel: properties[0]!.parcel, share: selected.sharePercentage });
        },
      });

      expect(owners.map((owner) => owner.taxCode)).toEqual(["RSSMRA70A01A893X", "BNCNNA80B42A893X"]);
      expect(expanded).toEqual([
        { taxCode: "RSSMRA70A01A893X", parcel: "701", share: 33.333333 },
        { taxCode: "BNCNNA80B42A893X", parcel: "702", share: 33.333333 },
      ]);
      expect(visits.filter((visit) => visit.startsWith("/portfolio"))).toEqual([
        "/portfolio?intestatoSelezionato=ROSSI&immobili=Immobili",
        "/portfolio?intestatoSelezionato=BIANCHI&immobili=Immobili",
      ]);
      expect(new URL(page.url()).pathname).toBe("/results");
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);
});
