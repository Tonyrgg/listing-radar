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

const PAGINE_MASSIME = 30;
const SCHEDE_APRIBILI_PER_SEME = 5;

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

function selettoreRighe(selectors: CrmSelectors) {
  return selectors.personResultRows;
}

async function firmaElenco(page: Page, selectors: CrmSelectors) {
  return (await page
    .locator(selectors.personResultId)
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "")))
    .join("\n");
}

async function attendiPaginaSuccessiva(page: Page, firmaPrecedente: string, selectors: CrmSelectors) {
  const scadenza = Date.now() + 20_000;
  let ultima = "";
  let stabili = 0;
  while (Date.now() < scadenza) {
    const corrente = await firmaElenco(page, selectors).catch(() => "");
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
  if (await page.locator(selettoreRighe(selectors)).first().count()) return;
  const voce = page.locator(selectors.personSearchPage).filter({ visible: true }).first();
  if (!(await voce.count())) {
    throw new Error(
      "Nel gestionale non trovo l'elenco Clienti da cui prendere i punti di partenza. Aprilo e riprova.",
    );
  }
  await voce.click();
  await page.locator(selettoreRighe(selectors)).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function leggiPagina(page: Page, selectors: CrmSelectors): Promise<ElencoRiga[]> {
  const righe = page.locator(selettoreRighe(selectors));
  const lette: ElencoRiga[] = [];
  for (let indice = 0; indice < await righe.count(); indice += 1) {
    const riga = righe.nth(indice);
    const collegamento = riga.locator(selectors.personResultId).first();
    if (!(await collegamento.count())) continue;
    const href = await collegamento.getAttribute("href");
    const recordId = (await collegamento.getAttribute("data-recordid"))
      || href?.match(/\/s\/account\/([^/?#]+)/i)?.[1]
      || "";
    if (!recordId) continue;
    lette.push({
      recordId,
      label: pulisci((await collegamento.getAttribute("title")) ?? (await collegamento.textContent())),
      url: href ? new URL(href, page.url()).toString() : "",
      celle: (await riga.locator("td").allInnerTexts()).map(pulisci),
    });
  }
  return lette;
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
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  const testo = await page.evaluate(() => document.body.innerText).catch(() => "");
  return codiceFiscaleDaTesto(testo);
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
    for (const riga of await leggiPagina(page, selectors)) {
      if (!perRecordId.has(riga.recordId)) perRecordId.set(riga.recordId, riga);
    }
    options.onProgress?.({ pagina, persone: perRecordId.size });

    const avanti = page.locator('button:has(svg[data-key="right"])').filter({ visible: true }).first();
    if (!(await avanti.count()) || !(await avanti.isEnabled())) break;
    const firma = await firmaElenco(page, selectors);
    await avanti.click();
    await attendiPaginaSuccessiva(page, firma, selectors);
  }

  const mescolate = mescola([...perRecordId.values()], random);
  const semi: CrmPersonSeed[] = [];
  const visti = new Set<string>();

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
