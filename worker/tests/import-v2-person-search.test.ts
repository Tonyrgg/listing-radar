import { chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";

const origin = "https://tecnocasa-group.my.site.com";
const root = "/CRMImmobiliareLightning/s";
const cf = "TESTCF0000000000";

async function searchFixture(page: Page, result: string, accountSuffix = "") {
  await page.route(`${origin}/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith("/account/Account")
      ? `<input title="Search..." onkeydown="if(event.key==='Enter') location.href='${root}/global-search/${cf}'">${accountSuffix}`
      : pathname.includes("/global-search/") ? result
      : `<div><div><label>Codice Fiscale</label></div><div class="slds-form-element__static">${cf}</div></div>`;
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><body>${body}</body>` });
  });
  await page.goto(`${origin}${root}/`);
}

describe("Ricerca CF: assenza certa e portale non disponibile", () => {
  it.each([
    '<h1>Risultati di ricerca</h1><section><h2>Clienti</h2><span>0 risultati</span></section>',
    '<h1>Risultati di ricerca</h1><section>Clienti (0 risultati)</section>',
    '<h1>Risultati di ricerca</h1><c-results></c-results><script>document.querySelector("c-results").attachShadow({mode:"open"}).innerHTML="<div>Clienti<span>0 risultati</span></div>"</script>',
    `<p>Non sono stati trovati risultati per "${cf}"</p>`,
  ])("restituisce assenza verificata senza timeout: %s", async body => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await searchFixture(page, body);
      await expect(new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).resolves.toEqual([]);
    } finally { await browser.close(); }
  }, 25_000);

  it("ignora lo zero provvisorio finché la richiesta dei risultati è in corso", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await searchFixture(page, `<h1>Risultati di ricerca</h1><section>Clienti 0 risultati</section>
        <script>fetch('/slow-results').then(() => document.querySelector('section').innerHTML = '<a data-refid="recordId" data-recordid="found" href="${root}/account/found">Nominativo</a>');</script>`);
      await page.route(`${origin}/slow-results`, async route => {
        await new Promise(resolve => setTimeout(resolve, 1600));
        await route.fulfill({ body: "ok" });
      });
      const found = await new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf);
      expect(found.map(person => person.id)).toEqual(["found"]);
    } finally { await browser.close(); }
  }, 15_000);

  it("mette in pausa la coda quando la ricerca fallisce anche se mostra zero", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await searchFixture(page, '<h1>Risultati di ricerca</h1><section>Clienti 0 risultati</section><div role="alert">Errore durante la ricerca</div>');
      await expect(new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).rejects.toMatchObject({
        kind: "global_portal", options: { global: true },
      });
    } finally { await browser.close(); }
  }, 15_000);

  it.each([
    '<h1>Risultati di ricerca</h1><section>Immobili 0 risultati</section>',
    '<h1>Risultati di ricerca</h1><section>Clienti</section><p>Nessun risultato</p>',
  ])("non deduce l'assenza di un cliente da una schermata ambigua", async body => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await searchFixture(page, body);
      await expect(new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).rejects.toMatchObject({
        kind: "global_portal", options: { global: true },
      });
    } finally { await browser.close(); }
  }, 20_000);

  it("non considera un errore HTTP come ricerca vuota", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await searchFixture(page, '<h1>Risultati di ricerca</h1><section>Clienti 0 risultati</section><script>fetch("/failed-search")</script>');
      await page.route(`${origin}/failed-search`, route => route.fulfill({ status: 503, body: "unavailable" }));
      await expect(new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).rejects.toMatchObject({ kind: "global_portal" });
    } finally { await browser.close(); }
  });

  it("non attribuisce alla ricerca le richieste della lista Clienti annullate dalla navigazione", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await searchFixture(page, '<h1>Risultati di ricerca</h1><section>Clienti 0 risultati</section>', '<script>fetch("/account-preload")</script>');
      await page.route(`${origin}/account-preload`, async route => {
        await new Promise(resolve => setTimeout(resolve, 1800));
        await route.fulfill({ body: "ok" });
      });
      await expect(new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode(cf)).resolves.toEqual([]);
    } finally { await browser.close(); }
  }, 10_000);
});
