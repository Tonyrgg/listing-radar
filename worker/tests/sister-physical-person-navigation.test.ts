import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { PlaywrightSisterAdapter } from "../src/adapters/sister/index.js";
import { sisterSelectors } from "../src/adapters/sister/selectors.js";

/**
 * La ricerca «Persona fisica» su SISTER, dal menu fino agli immobili.
 *
 * Cercando un codice fiscale non si arriva dritti all'elenco degli immobili:
 * SISTER mette in mezzo l'Elenco Omonimi, e la tabella che ne segue non ha le
 * stesse colonne di quella della ricerca per indirizzo. Il codice conosceva
 * soltanto quest'ultima, e l'esplorazione della rete si fermava.
 *
 * Le pagine finte qui sotto riproducono quelle vere: nomi dei moduli, nomi dei
 * campi e intestazioni sono stati letti dal portale.
 */

const MENU = `
  <a href="/Visure/SceltaLink.do?lista=PF&codUfficio=BA">Persona fisica</a>
  <a href="/Visure/SceltaLink.do?lista=PNF&codUfficio=BA">Persona giuridica</a>
  <a href="/Visure/SceltaLink.do?lista=IND&codUfficio=BA">Indirizzo</a>`;

/** L'elenco omonimi: una riga per anagrafica, e i tre comandi in fondo. */
function paginaOmonimi(codiceFiscale: string) {
  return `<!doctype html><body>${MENU}
    <form name="SceltaOmonimiForm" action="/immobili" method="get">
      <fieldset><legend>Elenco Omonimi</legend>
        <table class="listaIsp4">
          <tr><th></th><th>Cognome</th><th>Nome</th><th>Data di nascita</th><th>Luogo di nascita</th><th>Sesso</th><th>Codice Fiscale</th></tr>
          <tr><td><input type="radio" name="omonimoSelezionato" value="111#0#RUTIGLIANO#SAVERIO#${codiceFiscale}#B"></td>
            <td>RUTIGLIANO</td><td>SAVERIO</td><td>02/07/1975</td><td>BITONTO (BA)</td><td>M</td><td>${codiceFiscale}</td></tr>
          <tr><td><input type="radio" name="omonimoSelezionato" value="222#0#RUTIGLIANO#SAVERIA#${codiceFiscale}#B"></td>
            <td>RUTIGLIANO</td><td>SAVERIA</td><td>02/07/1975</td><td>BITONTO (BA)</td><td>F</td><td>${codiceFiscale}</td></tr>
        </table>
      </fieldset>
      <input type="submit" name="immobili" value="Immobili">
      <input type="submit" name="visura" value="Visura per Soggetto">
      <input type="submit" name="indietro" value="Indietro">
    </form></body>`;
}

/**
 * L'elenco immobili di una persona.
 *
 * Colonne diverse da quelle della ricerca per indirizzo — «Ubicazione» invece
 * di «Indirizzo», «Classamento» invece di «Categoria» — nessuna zona
 * censuaria, categoria scritta «Cat.A/2» e rendita scritta «Euro: 836,66».
 */
function paginaImmobiliDelSoggetto(quantiSingolare = false) {
  return `<!doctype html><body>${MENU}
    <fieldset><legend>Soggetto selezionato</legend>
      Cognome: RUTIGLIANO Nome: SAVERIO Codice Fiscale: RTGSVR75L02A893X
      ${quantiSingolare ? "Immobile" : "Immobili"} nel comune di: BITONTO Codice: A893
    </fieldset>
    <form name="SceltaVisuraImmSoggForm" action="/intestati">
      <table class="listaIsp4">
        <tr><th></th><th>Catasto</th><th>Titolarit&agrave;</th><th>Ubicazione</th><th>Foglio</th><th>Particella</th>
            <th>Sub</th><th>Classamento</th><th>Classe</th><th>Consistenza</th><th>Rendita</th><th>Partita</th><th>Altri Dati</th></tr>
        <tr><td><input type="radio" name="visImmSel" value="1"></td><td>F</td><td>Proprieta' per 1/2 <table hidden><tr><td>cella annidata</td></tr></table></td>
            <td>BITONTO(BA) VIA MARSALA n. 34 Piano 3</td><td>49</td><td>350</td><td>64</td>
            <td>Cat.A/2</td><td>04</td><td>6 vani</td><td>Euro: 836,66</td><td></td><td></td></tr>
        <tr><td><input type="radio" name="visImmSel" value="2"></td><td>F</td><td>Proprieta' per 1/1</td>
            <td>BITONTO(BA) VIA ROMA n. 7 Piano T</td><td>12</td><td>99</td><td>3</td>
            <td>Cat.C/6</td><td>02</td><td>18 mq</td><td>Euro: 120,00</td><td></td><td></td></tr>
      </table>
      <input type="submit" name="intestati" value="Intestati">
    </form></body>`;
}

function sisterFinto(opzioni: { codiceFiscaleOmonimi?: string; nessunaCorrispondenza?: boolean; unSoloImmobile?: boolean } = {}) {
  const visitati: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const url = request.url ?? "/";
    visitati.push(url);
    if (url.includes("lista=PF")) {
      const destinazione = opzioni.nessunaCorrispondenza ? "/nessuno" : "/omonimi";
      response.end(`<!doctype html><body>${MENU}
        <form name="RicercaPFForm" action="${destinazione}" method="get">
          <select name="tipoCatasto"><option value="F">Fabbricati</option><option value="T">Terreni</option></select>
          <select name="comuneCat"><option value="">Scegli</option><option value="A893">BITONTO</option></select>
          <label><input name="selDatiAna" type="radio" value="CF_PF">Codice fiscale</label>
          <input name="cod_fisc_pf">
          <input name="ricerca" type="submit" value="Ricerca">
        </form></body>`);
      return;
    }
    if (url.startsWith("/nessuno")) {
      response.end(`<!doctype html><body>${MENU}<p>Nessuna corrispondenza trovata</p></body>`);
      return;
    }
    if (url.startsWith("/omonimi")) {
      response.end(paginaOmonimi(opzioni.codiceFiscaleOmonimi ?? "RTGSVR75L02A893X"));
      return;
    }
    if (url.startsWith("/immobili")) {
      response.end(paginaImmobiliDelSoggetto(opzioni.unSoloImmobile));
      return;
    }
    if (url.startsWith("/intestati")) {
      response.end(`<!doctype html><body>${MENU}
        <form name="SceltaIntestatiForm"><table class="listaIsp4">
          <tr><th></th><th>Nominativo o denominazione</th><th>Codice fiscale</th><th>Titolarita</th><th>Quota</th></tr>
          <tr><td><input name="intestatoSelezionato"></td><td>RUTIGLIANO SAVERIO nato a BITONTO (BA) il 02/07/1975</td>
            <td>RTGSVR75L02A893X</td><td>Proprieta'</td><td>1/2</td></tr>
          <tr><td><input name="intestatoSelezionato"></td><td>BIANCHI ANNA nata a BITONTO (BA) il 01/02/1985</td>
            <td>BNCNNA85B41A893K</td><td>Proprieta'</td><td>1/2</td></tr>
        </table></form>
        <form name="SceltaVisuraImmSoggForm" action="/immobili"><input name="indietro" type="submit" value="Indietro"></form>
      </body>`);
      return;
    }
    /* La pagina di partenza. Il `RicercaPFForm` ridotto al solo «Indietro»
     * c'e' come nel portale vero: serve a provare che non venga scambiato per
     * il modulo di ricerca. */
    response.end(`<!doctype html><body>${MENU}
      <form name="RicercaPFForm" action="/indietro"><input type="submit" name="indietro" value="Indietro"></form>
      <form name="ricercaIndForm"><input name="indirizzo"></form></body>`);
  });
  return { server, visitati };
}

async function conSister<T>(
  finto: { server: Server },
  lavoro: (adapter: PlaywrightSisterAdapter, page: import("playwright").Page) => Promise<T>,
): Promise<T> {
  await new Promise<void>((resolve) => finto.server.listen(0, "127.0.0.1", resolve));
  const port = (finto.server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/Visure/SceltaLink.do?lista=IND&codUfficio=BA`);
    return await lavoro(new PlaywrightSisterAdapter(page, sisterSelectors), page);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => finto.server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("ricerca Persona fisica, dal menu agli immobili", () => {
  it("ci arriva da una pagina qualsiasi, passa dagli omonimi e legge gli immobili", async () => {
    const finto = sisterFinto();
    const immobili = await conSister(finto, (adapter) =>
      adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X"));

    /* La voce di menu viene presa com'e' scritta: l'ufficio resta quello. */
    expect(finto.visitati.find((url) => url.includes("lista=PF"))).toContain("codUfficio=BA");
    /* La persona giuridica non va mai confusa con la fisica. */
    expect(finto.visitati.some((url) => url.includes("lista=PNF"))).toBe(false);

    const ricerca = finto.visitati.find((url) => url.startsWith("/omonimi"));
    expect(ricerca).toContain("cod_fisc_pf=RTGSVR75L02A893X");
    expect(ricerca).toContain("tipoCatasto=F");
    expect(ricerca).toContain("selDatiAna=CF_PF");

    /* Dall'elenco omonimi si preme «Immobili». Mai «Visura per Soggetto»:
     * quello e' il documento a pagamento. */
    const scelta = finto.visitati.find((url) => url.startsWith("/immobili"));
    expect(scelta).toBeDefined();
    expect(scelta).toContain("immobili=Immobili");
    expect(scelta).not.toContain("visura=");
    /* Sempre la prima riga: il primo omonimo ha il valore che comincia per 111. */
    expect(scelta).toContain("omonimoSelezionato=111");

    expect(immobili).toHaveLength(2);
    expect(immobili.map((immobile) => immobile.category)).toEqual(["A/2", "C/6"]);
    expect(immobili[0]).toMatchObject({
      municipality: "BITONTO",
      sheet: "49",
      parcel: "350",
      subaltern: "64",
      address: "BITONTO(BA) VIA MARSALA n. 34 Piano 3",
      class: "04",
      consistency: "6 vani",
      cadastralIncome: 836.66,
    });
    /* L'elenco di una persona non ha la zona censuaria. */
    expect(immobili[0]!.censusZone).toBeNull();
  }, 30_000);

  it("apre i comproprietari usando le colonne catastali dell'elenco per persona", async () => {
    const finto = sisterFinto();
    await conSister(finto, async (adapter) => {
      const immobili = await adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X");
      const proprietari = await adapter.extractOwners(immobili[0]!);

      expect(proprietari.map((proprietario) => proprietario.taxCode)).toEqual([
        "RTGSVR75L02A893X",
        "BNCNNA85B41A893K",
      ]);
      expect(finto.visitati.some((url) => url.startsWith("/intestati") && url.includes("visImmSel=1"))).toBe(true);
    });
  }, 30_000);

  /**
   * Una lettera sola faceva fallire chiunque avesse piu' di un immobile.
   *
   * SISTER scrive «Immobile nel comune di» quando l'immobile e' uno solo e
   * «Immobili nel comune di» quando sono di piu'. Leggendo solo il singolare,
   * ogni persona con due o piu' immobili finiva scartata come «Comune non
   * riconosciuto» — cioe' quasi tutte.
   */
  it("legge il comune sia al singolare sia al plurale", async () => {
    const plurale = sisterFinto();
    const conPiuImmobili = await conSister(plurale, (adapter) =>
      adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X"));
    expect(conPiuImmobili.map((immobile) => immobile.municipality)).toEqual(["BITONTO", "BITONTO"]);

    const singolare = sisterFinto({ unSoloImmobile: true });
    const conUnoSolo = await conSister(singolare, (adapter) =>
      adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X"));
    expect(conUnoSolo[0]!.municipality).toBe("BITONTO");
  }, 30_000);

  it("non scambia il modulo ridotto al solo «Indietro» per quello di ricerca", async () => {
    const finto = sisterFinto();
    await conSister(finto, (adapter) => adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X"));

    /* Se il modulo finto fosse bastato, la ricerca non sarebbe mai stata
     * inviata e la pagina Persona fisica mai visitata. */
    expect(finto.visitati.some((url) => url.includes("lista=PF"))).toBe(true);
    expect(finto.visitati.some((url) => url.startsWith("/indietro"))).toBe(false);
  }, 30_000);

  it("si ferma se l'elenco omonimi non porta il codice fiscale cercato", async () => {
    const finto = sisterFinto({ codiceFiscaleOmonimi: "BNCNNA80B41A893K" });

    await expect(conSister(finto, (adapter) =>
      adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X"),
    )).rejects.toMatchObject({
      status: "portal_error",
      details: { action: "person-homonyms-mismatch" },
    });
    /* Meglio fermarsi che esplorare gli immobili di un'altra persona. */
    expect(finto.visitati.some((url) => url.startsWith("/immobili"))).toBe(false);
  }, 30_000);

  it("nessuna corrispondenza non e' un errore: e' una risposta vuota", async () => {
    const finto = sisterFinto({ nessunaCorrispondenza: true });
    const immobili = await conSister(finto, (adapter) =>
      adapter.searchPhysicalPersonByTaxCode("RTGSVR75L02A893X"));

    expect(immobili).toEqual([]);
  }, 30_000);

  it("rifiuta un codice fiscale che non ne ha la lunghezza, senza toccare il portale", async () => {
    const finto = sisterFinto();
    await conSister(finto, async (adapter, page) => {
      const partenza = finto.visitati.length;
      await expect(adapter.searchPhysicalPersonByTaxCode("TROPPO-CORTO")).rejects.toMatchObject({
        status: "data_incomplete",
      });
      expect(finto.visitati.length).toBe(partenza);
      expect(page.url()).toContain("lista=IND");
    });
  }, 30_000);
});
