import type { Page } from "playwright";

import { normalizeTaxCode } from "../../core/normalize.js";
import { crmSelectors, type CrmSelectors } from "./selectors.js";

/**
 * I punti di partenza della rete proprietaria, presi dal gestionale.
 *
 * L'esplorazione partiva soltanto da chi il worker aveva già portato nel
 * gestionale con un'acquisizione sua: ad archivio vuoto non c'era nessun seme
 * e la rete non si poteva avviare per niente. Qui i codici fiscali si leggono
 * dall'elenco Clienti, che di persone ne ha già.
 *
 * La scelta è casuale di proposito: due esplorazioni lanciate di seguito non
 * devono ripartire dalle stesse persone, altrimenti battono la stessa porzione
 * di rete e non scoprono niente di nuovo.
 */

export type CrmPersonSeed = {
  recordId: string;
  label: string;
  taxCode: string;
};

type ElencoRiga = {
  recordId: string;
  label: string;
  url: string;
  celle: string[];
};

/**
 * La forma del codice fiscale di una persona, omocodia compresa.
 *
 * Serve a riconoscerlo dentro una cella qualsiasi: il solo `[A-Z0-9]{16}` che
 * basta a validarne uno già trovato qui prenderebbe anche identificativi
 * interni del gestionale, che sono altrettanto lunghi e altrettanto
 * alfanumerici. Nelle posizioni numeriche l'omocodia sostituisce le cifre con
 * `LMNPQRSTUV`, e vanno accettate.
 */
const CODICE_FISCALE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

/**
 * L'elenco Clienti non è la pagina dei risultati di ricerca.
 *
 * Nei risultati ogni collegamento porta `data-refid="recordId"` e
 * `data-recordid`, ed è su quelli che lavora la ricerca nominativi. Nella
 * lista quegli attributi non esistono: restano `title`, `target` e `href`, e
 * l'indirizzo ha la forma `/s/account/<id>/<nome-nell-indirizzo>`. Chiedere
 * qui gli attributi dei risultati voleva dire aspettare righe che non
 * sarebbero mai comparse, e la run moriva sul tempo scaduto.
 *
 * L'elenco non mostra il codice fiscale in nessuna colonna: le sue sono nome,
 * recapiti e residenza. Per averlo si deve aprire la scheda, e non è un
 * ripiego ma la strada normale.
 */
const RIGHE_ELENCO = 'table tbody tr:has(a[href*="/s/account/"])';
const ANCORA_CLIENTE = 'a[href*="/s/account/"]';

const PAGINE_MASSIME = 30;
const SCHEDE_APRIBILI_PER_SEME = 5;
const ATTESA_CODICE_FISCALE_MS = 12_000;

function pulisci(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Il codice fiscale nascosto in un testo qualunque, se c'è. */
export function codiceFiscaleDaTesto(testo: string): string | null {
  for (const pezzo of String(testo ?? "").split(/[^A-Za-z0-9]+/)) {
    const candidato = normalizeTaxCode(pezzo);
    if (candidato.length === 16 && CODICE_FISCALE.test(candidato)) return candidato;
  }
  return null;
}

/** Mescola una copia, senza toccare l'originale. */
export function mescola<T>(valori: readonly T[], random: () => number = Math.random): T[] {
  const copia = [...valori];
  for (let indice = copia.length - 1; indice > 0; indice -= 1) {
    const scambio = Math.floor(random() * (indice + 1));
    [copia[indice], copia[scambio]] = [copia[scambio]!, copia[indice]!];
  }
  return copia;
}

/** L'identificativo del cliente sta nell'indirizzo, non in un attributo. */
function recordIdDaHref(href: string | null): string {
  const trovato = href?.match(/\/s\/account\/([^/?#]+)/i)?.[1] ?? "";
  /* `/s/account/Account` è l'elenco stesso, non una persona. */
  return trovato.toLowerCase() === "account" ? "" : trovato;
}

async function firmaElenco(page: Page) {
  return (await page
    .locator(`${RIGHE_ELENCO} ${ANCORA_CLIENTE}`)
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")))
    .join("\n");
}

async function attendiPaginaSuccessiva(page: Page, firmaPrecedente: string) {
  const scadenza = Date.now() + 20_000;
  let ultima = "";
  let stabili = 0;
  while (Date.now() < scadenza) {
    const corrente = await firmaElenco(page).catch(() => "");
    if (corrente && corrente !== firmaPrecedente) {
      stabili = corrente === ultima ? stabili + 1 : 0;
      if (stabili >= 2) return;
      ultima = corrente;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("La pagina successiva dell'elenco Clienti non ha terminato il caricamento");
}

/**
 * Porta la scheda del gestionale sull'elenco Clienti.
 *
 * Se ci si trova già non tocca niente: la scheda dell'operatore non va spostata
 * senza motivo.
 */
async function apriElencoClienti(page: Page, selectors: CrmSelectors) {
  if (await page.locator(RIGHE_ELENCO).first().count()) return;
  const voce = page.locator(selectors.personSearchPage).filter({ visible: true }).first();
  if (!(await voce.count())) {
    throw new Error(
      "Nel gestionale non trovo l'elenco Clienti da cui prendere i punti di partenza. Aprilo e riprova.",
    );
  }
  /* Il clic sulla voce di menu a volte non naviga: e' un'applicazione a pagina
   * singola, e la stessa risalita la fa gia' la ricerca nominativi. */
  const href = await voce.getAttribute("href");
  await voce.click();
  const arrivato = await page
    .waitForURL(/\/s\/account\/Account(?:[/?#]|$)/i, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!arrivato && href) {
    await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  await page.locator(RIGHE_ELENCO).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function leggiPagina(page: Page): Promise<ElencoRiga[]> {
  /* Una pagina sola, un viaggio solo.
   *
   * Interrogare le righe una per una — conta, leggi l'indirizzo, leggi le
   * celle — voleva dire un centinaio e mezzo di andate e ritorni col browser
   * per cinquanta clienti, e quasi un minuto buttato prima ancora di aprire
   * una scheda. Qui la pagina viene letta tutta insieme dentro il browser.
   *
   * `evaluateAll` riceve le righe risolte da Playwright, che attraversa le
   * shadow root: dentro non si potrebbe ritrovarle da `document`, perche' la
   * tabella di questo gestionale non e' nel documento principale.
   */
  const lette = await page.locator(RIGHE_ELENCO).evaluateAll((righe) => righe.map((riga) => {
    /* Il collegamento al cliente non e' nella riga: sta in una shadow root
     * annidata dentro di essa. I locator di Playwright le attraversano, ma
     * `querySelector` dentro la riga no, e cercando li' non si trovava niente.
     * Qui si scende di shadow root in shadow root fino a incontrarlo.
     *
     * Niente funzioni con nome in questo corpo: viene serializzato ed eseguito
     * nel browser, e chi compila ne avvolge i nomi con un aiutante che nella
     * pagina non esiste. */
    let href = "";
    let label = "";
    const pila: Array<Element | ShadowRoot | Document> = [riga];
    while (pila.length && !href) {
      const nodo = pila.pop()!;
      const discendenti = nodo.querySelectorAll("*");
      for (let indice = 0; indice < discendenti.length; indice += 1) {
        const elemento = discendenti[indice] as HTMLElement;
        const collegamento = elemento.getAttribute("href") ?? "";
        if (elemento.tagName === "A" && collegamento.includes("/s/account/")) {
          href = collegamento;
          label = elemento.getAttribute("title") ?? elemento.textContent ?? "";
          break;
        }
        if (elemento.shadowRoot) pila.push(elemento.shadowRoot);
      }
    }
    const celle: string[] = [];
    const caselle = riga.querySelectorAll("td, th");
    for (let indice = 0; indice < caselle.length; indice += 1) {
      celle.push(((caselle[indice] as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim());
    }
    return { href, label: label.replace(/\s+/g, " ").trim(), celle };
  }));

  const risultato: ElencoRiga[] = [];
  for (const riga of lette) {
    const recordId = recordIdDaHref(riga.href);
    if (!recordId) continue;
    risultato.push({
      recordId,
      label: riga.label,
      url: riga.href ? new URL(riga.href, page.url()).toString() : "",
      celle: riga.celle,
    });
  }
  return risultato;
}

/**
 * Il codice fiscale scritto nella scheda della persona.
 *
 * Si apre solo quando l'elenco non lo mostra in colonna, e solo per le persone
 * già sorteggiate: aprire una scheda costa un caricamento, e non ne servono
 * decine per far partire un'esplorazione.
 */
async function leggiCodiceFiscaleDallaScheda(page: Page, url: string): Promise<string | null> {
  if (!url) return null;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  /* Niente attesa di un titolo: su questa scheda `h1`/`h2` non diventa mai
   * visibile, e aspettarlo costava venticinque secondi a persona per poi
   * proseguire lo stesso. Il codice fiscale invece c'e' subito. Si aspetta
   * quello, che e' la cosa che serve davvero, e di norma basta la prima
   * lettura. `innerText` riporta anche il testo reso dentro le shadow root,
   * che qui sono dappertutto. */
  const scadenza = Date.now() + ATTESA_CODICE_FISCALE_MS;
  for (;;) {
    const testo = await page.evaluate(() => document.body.innerText).catch(() => "");
    const trovato = codiceFiscaleDaTesto(testo);
    if (trovato) return trovato;
    if (Date.now() >= scadenza) return null;
    await page.waitForTimeout(400);
  }
}

/**
 * Sorteggia dal gestionale i codici fiscali da cui far partire la rete.
 *
 * Legge l'elenco Clienti pagina per pagina — con un tetto, perché un archivio
 * grande non deve trasformare l'avvio in una scansione infinita — poi mescola
 * e prende i primi che hanno un codice fiscale leggibile.
 */
export async function collectCrmPersonSeeds(
  page: Page,
  options: {
    wanted: number;
    selectors?: CrmSelectors;
    maximumPages?: number;
    isCancelled?: () => boolean;
    onProgress?: (progress: { pagina: number; persone: number }) => void;
    random?: () => number;
    /** Codici fiscali gia' usati, da non riproporre. */
    escludi?: readonly string[];
  },
): Promise<CrmPersonSeed[]> {
  const selectors = options.selectors ?? crmSelectors;
  const quanti = Math.max(1, Math.floor(options.wanted));
  const pagineMassime = Math.max(1, options.maximumPages ?? PAGINE_MASSIME);
  const random = options.random ?? Math.random;

  await apriElencoClienti(page, selectors);

  const perRecordId = new Map<string, ElencoRiga>();
  for (let pagina = 1; pagina <= pagineMassime; pagina += 1) {
    if (options.isCancelled?.()) break;
    for (const riga of await leggiPagina(page)) {
      if (!perRecordId.has(riga.recordId)) perRecordId.set(riga.recordId, riga);
    }
    options.onProgress?.({ pagina, persone: perRecordId.size });

    const avanti = page.locator('button:has(svg[data-key="right"])').filter({ visible: true }).first();
    if (!(await avanti.count()) || !(await avanti.isEnabled())) break;
    const firma = await firmaElenco(page);
    await avanti.click();
    await attendiPaginaSuccessiva(page, firma);
  }

  const mescolate = mescola([...perRecordId.values()], random);
  const semi: CrmPersonSeed[] = [];
  /* Chi e' gia' stato usato parte come «gia' visto»: cosi' un ripescaggio non
   * ripropone le stesse persone della manche precedente. */
  const visti = new Set<string>((options.escludi ?? []).map((taxCode) => normalizeTaxCode(taxCode)));

  /* Prima quelli che l'elenco mostra già: non costano niente. */
  for (const riga of mescolate) {
    if (semi.length >= quanti) break;
    const taxCode = codiceFiscaleDaTesto(riga.celle.join(" "));
    if (!taxCode || visti.has(taxCode)) continue;
    visti.add(taxCode);
    semi.push({ recordId: riga.recordId, label: riga.label, taxCode });
  }
  if (semi.length >= quanti) return semi;

  /* Poi, se l'elenco non ha una colonna col codice fiscale, si aprono le
   * schede — poche, e solo fra quelle già sorteggiate. */
  let aperture = 0;
  const tornaAllElenco = page.url();
  const tettoAperture = quanti * SCHEDE_APRIBILI_PER_SEME;
  for (const riga of mescolate) {
    if (semi.length >= quanti || aperture >= tettoAperture) break;
    if (options.isCancelled?.()) break;
    if (semi.some((seme) => seme.recordId === riga.recordId)) continue;
    aperture += 1;
    const taxCode = await leggiCodiceFiscaleDallaScheda(page, riga.url).catch(() => null);
    if (!taxCode || visti.has(taxCode)) continue;
    visti.add(taxCode);
    semi.push({ recordId: riga.recordId, label: riga.label, taxCode });
  }

  /* La scheda del gestionale torna sull'elenco: l'esplorazione la usa subito
   * dopo per cercare le persone, e non deve trovarsela ferma sull'ultima
   * anagrafica aperta qui. */
  if (aperture) {
    await page.goto(tornaAllElenco, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }

  return semi;
}
