import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { describe, it, expect, vi } from "vitest";
import { LiveProvider } from "../src/territory/live-provider.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { TerritoryStore } from "../src/territory/store.js";
import { type Street, unitKey } from "../src/territory/model.js";
import { reusableSisterSource } from "../src/territory/sister-memory.js";
import { sourceProblem } from "../src/territory/quarantine.js";
import type { ChromeTabs } from "../src/services/chrome.js";

const sourceStreet: Street = { id: "street-a", name: "Via Test", sisterName: "VIA TEST", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const otherStreet: Street = { ...sourceStreet, id: "street-b", name: "Via Altra", sisterName: "VIA ALTRA" };
const ownerRows = `<tr><td><input type="radio" name="intestatoSelezionato" value="ROSSI"></td><td>ROSSI MARIO nato a BITONTO (BA) il 01/01/1980</td><td>RSSMRA80A01A893P</td><td>Proprieta'</td><td>1/2</td></tr>
  <tr><td><input type="radio" name="intestatoSelezionato" value="VERDI"></td><td>VERDI LUCA nato a BITONTO (BA) il 02/02/1982</td><td>VRDLCU82B02A893X</td><td>Proprieta'</td><td>1/2</td></tr>`;
function ownerPage(back: string) {
  return `<form name="SceltaIntestatiForm" action="/portfolio"><table class="listaIsp4"><tr><th></th><th>Nominativo o denominazione</th><th>Codice fiscale</th><th>Titolarita</th><th>Quota</th></tr>${ownerRows}</table><input type="submit" name="immobili" value="Immobili"></form>
    <form name="SceltaVisuraImmSoggForm" action="${back}"><input type="submit" name="indietro" value="Indietro"></form>`;
}
function inventory(street: string, parcel: string, portfolio = false) {
  return `<fieldset><legend>${portfolio ? "Soggetto selezionato" : "Dati della ricerca"}</legend>${portfolio ? "Immobili nel comune di: BITONTO Codice: A893" : `Comune: BITONTO Codice: A893 Indirizzo: ${street} Numeri civici`}</fieldset>
    <form name="SceltaVisuraImmSoggForm" action="${portfolio ? '/portfolio-owners' : '/owners'}"><table class="listaIsp4">
    <tr><th></th>${portfolio ? '<th>Catasto</th><th>Titolarita</th><th>Ubicazione</th>' : ''}<th>Foglio</th><th>Particella</th><th>Sub</th>${portfolio ? '<th>Classamento</th>' : '<th>Indirizzo</th><th>Zona cens</th><th>Categoria</th>'}<th>Classe</th><th>Consistenza</th><th>Rendita</th></tr>
    <tr><td><input name="visImmSel" type="radio" value="1"></td>${portfolio ? `<td>F</td><td>Proprieta' per 1/2</td><td>BITONTO(BA) ${street} n. 2 Piano 1</td>` : ''}<td>50</td><td>${parcel}</td><td>1</td>${portfolio ? '<td>Cat.A/2</td>' : `<td>${street} n. 2 Piano 1</td><td>U</td><td>A/2</td>`}<td>2</td><td>5 vani</td><td>400,00</td></tr>
    </table><input name="intestati" type="submit" value="Intestati">${portfolio ? '<input type="submit" name="indietro" value="Indietro" formaction="/owners">' : ''}</form>
    ${portfolio ? '' : '<form name="SceltaIndirizzoForm" action="/addresses"><input type="submit" value="Indietro"></form>'}`;
}
describe("V2 portafogli SISTER e riuso della memoria", () => {
  it("conserva tutti gli intestatari su un'altra via, poi salta la rilettura senza inventare una nuova acquisizione", async () => {
    const visits: string[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1"); visits.push(url.pathname);
      res.setHeader("content-type", "text/html; charset=utf-8");
      const selected = url.searchParams.get("indirizzoSel")?.includes("VIA ALTRA");
      if (url.pathname === "/owners") res.end(ownerPage('/results'));
      else if (url.pathname === "/portfolio-owners") res.end(ownerPage('/portfolio'));
      else if (url.pathname === "/portfolio") res.end(inventory('VIA ALTRA', '200', true));
      else if (url.pathname === "/results") res.end(inventory(selected ? 'VIA ALTRA' : 'VIA TEST', selected ? '200' : '100'));
      else res.end(`<form name="SceltaIndirizzoForm" action="/results"><select name="indirizzoSel"><option value="a##VIA TEST">VIA TEST</option><option value="b##VIA ALTRA">VIA ALTRA</option></select><input name="numCivicoDal"><input name="numCivicoAl"><input type="submit" name="ricerca" value="Ricerca"></form>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sister-portfolios-'));
    try {
      const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/addresses`);
      const store = await TerritoryStore.open(dir, [sourceStreet, otherStreet]);
      const config = { cdpUrl: 'http://127.0.0.1:9223', sisterTabMatch: 'sister', crmTabMatch: 'cloud', allowedCadastralKeys: [], allowedTaxCodes: [], allowCreate: false };
      const provider = new LiveProvider(config, () => false, undefined, 'test', store);
      vi.spyOn(provider as unknown as { tabs(): Promise<ChromeTabs> }, 'tabs').mockResolvedValue({ sisterPage: page } as ChromeTabs);
      const app = new TerritoryApplication(store, provider);
      await app.start(sourceStreet.id, 'scan', [], undefined, { expandOwnerProperties: true }); await app.waitForIdle();
      expect(store.read().runs.at(-1)).toMatchObject({ state: 'completed', handled: 2 });
      expect(Object.keys(store.read().units)).toHaveLength(2);
      const unit = Object.values(store.read().units).find(u => u.observations[0]!.source.cadastral.parcel === '200')!;
      expect(unit.streetIds).toEqual([otherStreet.id]);
      expect(unit.observations[0]).toMatchObject({ portfolio: true, ownersComplete: true, activityEligible: true });
      expect(unit.observations[0]!.source.owners.map(o => o.sharePercentage)).toEqual([50, 50]);
      expect(store.read().runs.at(-1)!.portfolioKeys).toEqual([unit.key]);
      expect(sourceProblem(unit.observations[0]!.source)).toBeNull();
      expect(app.detail(sourceStreet.id).street.progress.total).toBe(1);
      expect(app.detail(sourceStreet.id).units).toHaveLength(1);
      expect(app.detail(otherStreet.id).units).toHaveLength(1);
      expect(visits.filter(v => v === '/portfolio-owners')).toHaveLength(1);
      const originalAt = unit.observations[0]!.at;
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/addresses`);
      await app.start(otherStreet.id, 'scan'); await app.waitForIdle();
      expect(store.read().runs.at(-1)?.state).toBe('completed');
      expect(store.read().units[unit.key]!.observations).toHaveLength(1);
      expect(store.read().runs.at(-1)!.reusedKeys).toEqual([unit.key]);
      expect(store.read().units[unit.key]!.observations[0]!.at).toBe(originalAt);
      expect(visits.filter(v => v === '/owners')).toHaveLength(3); // one source read and two returns from owner portfolios
      expect(app.detail(otherStreet.id).street.progress.total).toBe(1);
      expect(Object.keys(store.read().virtualCrm)).toHaveLength(0);
      const remembered = structuredClone(unit.observations[0]!.source);
      expect(reusableSisterSource(store.read(), remembered)).not.toBeNull();
      expect(reusableSisterSource(store.read(), { ...remembered, fullAddress: 'VIA ALTRA n. 4 Piano 1' })).toBeNull();
      expect(reusableSisterSource(store.read(), { ...remembered, cadastral: { ...remembered.cadastral, subaltern: '2' } })).toBeNull();
      await store.change(s => { s.units[unitKey(remembered)]!.observations[0]!.ownersComplete = false; });
      expect(reusableSisterSource(store.read(), remembered)).toBeNull();
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/addresses`);
      await app.start(otherStreet.id, 'scan', [], undefined, { reuseAcquiredProperties: false }); await app.waitForIdle();
      expect(store.read().units[unit.key]!.observations).toHaveLength(2);
      expect((await TerritoryStore.open(dir, [sourceStreet, otherStreet])).read().units[unit.key]!.observations).toHaveLength(2);
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/addresses`);
      await app.start(otherStreet.id, 'scan', [], undefined, { expandOwnerProperties: true }); await app.waitForIdle();
      expect(store.read().runs.at(-1)?.state).toBe('completed');
      expect(store.read().units[unit.key]!.observations).toHaveLength(3);
      expect(store.read().units[unit.key]!.observations.at(-1)!.portfoliosExpanded).toBe(true);
    } finally {
      vi.restoreAllMocks(); await browser.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true });
    }
  }, 35_000);
});
