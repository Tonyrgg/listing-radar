import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { codiceFiscaleDaTesto, collectCrmPersonSeeds, mescola } from "../src/adapters/crm/people.js";

/**
 * I punti di partenza della rete presi dall'elenco Clienti del gestionale.
 *
 * Ad archivio vuoto la rete non poteva partire affatto: nessuna persona
 * acquisita, nessun seme. Qui si verifica che i codici fiscali vengano letti
 * davvero, che non ne venga scambiato uno con un identificativo interno, e che
 * la scelta sia casuale.
 */

const ANAGRAFICHE = [
  { id: "001A00000000001AAA", nome: "ROSSI MARIO", cf: "RSSMRA70A01A893X" },
  { id: "001A00000000002AAA", nome: "BIANCHI ANNA", cf: "BNCNNA80B41A893K" },
  { id: "001A00000000003AAA", nome: "VERDI LUIGI", cf: "VRDLGU65C10A893T" },
  { id: "001A00000000004AAA", nome: "NERI CARLA", cf: "NRECRL75D50A893M" },
  { id: "001A00000000005AAA", nome: "GIALLI PIETRO", cf: "GLLPTR60E15A893B" },
  { id: "001A00000000006AAA", nome: "BLU SOFIA", cf: "BLUSFO90H55A893N" },
];

function paginaElenco(anagrafiche: typeof ANAGRAFICHE, pagina: number, ultima: number, conColonnaCf: boolean, vista: "Clienti" | "Clienti recenti") {
  const righe = anagrafiche.map((persona) => `
    <tr>
      <td><a title="${persona.nome}" target="_blank" href="/CRMImmobiliareLightning/s/account/${persona.id}/${persona.nome.toLowerCase().replace(/ /g, "-")}">${persona.nome}</a></td>
      <td>A1B2C3D4E5F6G7H8</td>
      ${conColonnaCf ? `<td>${persona.cf}</td>` : ""}
    </tr>`).join("");
  const vistaQuery = vista === "Clienti" ? "view=clients&" : "";
  const avanti = pagina < ultima
    ? `<button onclick="location.href='/CRMImmobiliareLightning/s/account/Account?${vistaQuery}p=${pagina + 1}'"><svg data-key="right"></svg></button>`
    : `<button disabled><svg data-key="right"></svg></button>`;
  return `<!doctype html><body>
    <button id="vista-attiva" onclick="document.querySelector('#menu-viste').hidden=false">${vista}</button>
    <div id="menu-viste" hidden><button onclick="location.href='/CRMImmobiliareLightning/s/account/Account?view=clients'">Clienti</button></div>
    <table>
      <thead><tr><th>Nome</th><th>Riferimento</th>${conColonnaCf ? "<th>Codice fiscale</th>" : ""}</tr></thead>
      <tbody>${righe}</tbody>
    </table>
    ${avanti}
  </body>`;
}

function crmFinto(options: { conColonnaCf: boolean; perPagina?: number; parteDaRecenti?: boolean }) {
  const perPagina = options.perPagina ?? ANAGRAFICHE.length;
  const schedeAperte: string[] = [];
  const visteRichieste: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    const [percorso = "/", query] = (request.url ?? "/").split("?");
    const scheda = percorso.match(/\/s\/account\/([^/]+)\/[^/]+$/);
    if (scheda) {
      const persona = ANAGRAFICHE.find((voce) => voce.id === scheda[1]);
      schedeAperte.push(scheda[1]!);
      response.end(`<!doctype html><body><h1>${persona?.nome ?? "?"}</h1>
        <div>Codice fiscale</div><div>${persona?.cf ?? ""}</div></body>`);
      return;
    }
    if (percorso.includes("/s/account/Account")) {
      const params = new URLSearchParams(query ?? "");
      const vista: "Clienti" | "Clienti recenti" = options.parteDaRecenti && params.get("view") !== "clients"
        ? "Clienti recenti"
        : "Clienti";
      visteRichieste.push(vista);
      const origine = vista === "Clienti recenti" ? ANAGRAFICHE.slice(0, 2) : ANAGRAFICHE;
      const pagina = Number(params.get("p") ?? "1");
      const ultima = Math.ceil(origine.length / perPagina);
      const fetta = origine.slice((pagina - 1) * perPagina, pagina * perPagina);
      response.end(paginaElenco(fetta, pagina, ultima, options.conColonnaCf, vista));
      return;
    }
    response.end(`<!doctype html><body>
      <a href="/CRMImmobiliareLightning/s/account/Account">Clienti</a>
    </body>`);
  });
  return { server, schedeAperte, visteRichieste };
}

async function conCrm<T>(
  finto: { server: Server },
  lavoro: (indirizzo: string, apri: (url: string) => Promise<import("playwright").Page>) => Promise<T>,
): Promise<T> {
  await new Promise<void>((resolve) => finto.server.listen(0, "127.0.0.1", resolve));
  const port = (finto.server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    return await lavoro(`http://127.0.0.1:${port}`, async (url) => {
      const page = await browser.newPage();
      await page.goto(url);
      return page;
    });
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => finto.server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("codice fiscale riconosciuto dentro un testo", () => {
  it("lo trova in mezzo ad altro", () => {
    expect(codiceFiscaleDaTesto("Codice fiscale: RSSMRA70A01A893X · Bitonto")).toBe("RSSMRA70A01A893X");
  });

  it("accetta l'omocodia", () => {
    expect(codiceFiscaleDaTesto("RSSMRAULA0MA893X")).toBe("RSSMRAULA0MA893X");
  });

  it("non scambia un identificativo interno per un codice fiscale", () => {
    /* Sedici caratteri alfanumerici come un codice fiscale, ma non lo e'. */
    expect(codiceFiscaleDaTesto("A1B2C3D4E5F6G7H8")).toBeNull();
    expect(codiceFiscaleDaTesto("001A00000000001AAA")).toBeNull();
  });

  it("non inventa niente da un testo che non ne contiene", () => {
    expect(codiceFiscaleDaTesto("Nessun dato disponibile")).toBeNull();
  });
});

describe("sorteggio", () => {
  it("non tocca la lista originale e usa tutta la sequenza casuale", () => {
    const originale = [1, 2, 3, 4, 5];
    const estrazioni = [0.99, 0.01, 0.5, 0.7];
    let indice = 0;
    const mescolata = mescola(originale, () => estrazioni[indice++] ?? 0);

    expect(originale).toEqual([1, 2, 3, 4, 5]);
    expect([...mescolata].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(indice).toBe(4);
  });

  it("con estrazioni diverse produce ordini diversi", () => {
    const valori = [1, 2, 3, 4, 5, 6, 7, 8];
    const primo = mescola(valori, () => 0);
    const secondo = mescola(valori, () => 0.99);
    expect(primo).not.toEqual(secondo);
  });
});

describe("punti di partenza presi dall'elenco Clienti", () => {
  it("riconosce le righe dell'elenco, che non hanno gli attributi dei risultati di ricerca", async () => {
    const finto = crmFinto({ conColonnaCf: false });
    const semi = await conCrm(finto, async (indirizzo, apri) => {
      const page = await apri(indirizzo);
      return collectCrmPersonSeeds(page, { wanted: 1 });
    });

    /* Le ancore dell'elenco portano solo title/target/href: cercare
     * `data-refid="recordId"` faceva scadere l'attesa a vuoto. */
    expect(semi).toHaveLength(1);
    expect(semi[0]!.recordId).toMatch(/^001A/);
    expect(semi[0]!.label).not.toBe("");
  }, 30_000);

  it("legge i codici fiscali dalla colonna e ne prende quanti gliene servono", async () => {
    const finto = crmFinto({ conColonnaCf: true });
    const semi = await conCrm(finto, async (indirizzo, apri) => {
      const page = await apri(indirizzo);
      return collectCrmPersonSeeds(page, { wanted: 3 });
    });

    expect(semi).toHaveLength(3);
    expect(semi.every((seme) => ANAGRAFICHE.some((voce) => voce.cf === seme.taxCode))).toBe(true);
    expect(new Set(semi.map((seme) => seme.taxCode)).size).toBe(3);
    /* La colonna col riferimento interno non deve mai finire fra i semi. */
    expect(semi.map((seme) => seme.taxCode)).not.toContain("A1B2C3D4E5F6G7H8");
    /* Nessuna scheda aperta: la colonna bastava. */
    expect(finto.schedeAperte).toEqual([]);
  }, 30_000);

  it("attraversa le pagine dell'elenco", async () => {
    const finto = crmFinto({ conColonnaCf: true, perPagina: 2 });
    const pagineViste: number[] = [];
    const semi = await conCrm(finto, async (indirizzo, apri) => {
      const page = await apri(indirizzo);
      return collectCrmPersonSeeds(page, {
        wanted: 6,
        onProgress: ({ pagina }) => pagineViste.push(pagina),
      });
    });

    expect(pagineViste).toEqual([1, 2, 3]);
    expect(semi).toHaveLength(6);
  }, 30_000);

  it("passa da Clienti recenti alla vista Clienti completa prima del sorteggio", async () => {
    const finto = crmFinto({ conColonnaCf: true, parteDaRecenti: true, perPagina: 3 });
    const semi = await conCrm(finto, async (indirizzo, apri) => {
      const page = await apri(`${indirizzo}/CRMImmobiliareLightning/s/account/Account`);
      return collectCrmPersonSeeds(page, { wanted: 6 });
    });

    expect(finto.visteRichieste[0]).toBe("Clienti recenti");
    expect(finto.visteRichieste).toContain("Clienti");
    expect(semi).toHaveLength(6);
  }, 30_000);

  it("apre le schede solo quando l'elenco non mostra il codice fiscale", async () => {
    const finto = crmFinto({ conColonnaCf: false });
    const semi = await conCrm(finto, async (indirizzo, apri) => {
      const page = await apri(indirizzo);
      return collectCrmPersonSeeds(page, { wanted: 2 });
    });

    expect(semi).toHaveLength(2);
    expect(semi.every((seme) => ANAGRAFICHE.some((voce) => voce.cf === seme.taxCode))).toBe(true);
    /* Solo le schede sorteggiate, non tutte le anagrafiche. */
    expect(finto.schedeAperte.length).toBeGreaterThanOrEqual(2);
    expect(finto.schedeAperte.length).toBeLessThan(ANAGRAFICHE.length);
  }, 30_000);

  it("sorteggia: due letture di seguito non danno lo stesso ordine", async () => {
    const finto = crmFinto({ conColonnaCf: true });
    const [primo, secondo] = await conCrm(finto, async (indirizzo, apri) => {
      const page = await apri(indirizzo);
      let passo = 0;
      const uno = await collectCrmPersonSeeds(page, { wanted: 6, random: () => (passo++ % 3) / 3 });
      passo = 1;
      const due = await collectCrmPersonSeeds(page, { wanted: 6, random: () => (passo++ % 5) / 5 });
      return [uno, due];
    });

    expect(primo.map((seme) => seme.taxCode).sort()).toEqual(secondo.map((seme) => seme.taxCode).sort());
    expect(primo.map((seme) => seme.taxCode)).not.toEqual(secondo.map((seme) => seme.taxCode));
  }, 30_000);
});
