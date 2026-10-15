import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Locator } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { ImportV2Plan } from "../src/import-v2/model.js";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
afterAll(async () => { await browser?.close(); });
const url = "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/immobile/property-1";
const plan = { source: { fullAddress: "VIA TEST n. 1" } } as ImportV2Plan;
type Internals = {
  activityCard(id: string): Promise<Locator>;
  propertyLinksForPerson(id: string, plan: ImportV2Plan): Promise<Array<{ id: string }>>;
  resolveVisibleMerge(): Promise<string>;
  saveReadyMerge(dialog: Locator): Promise<string>;
  pauseAwareWait(ms: number): Promise<void>;
};
describe("Recupero Lightning, schede annidate e merge", () => {
  it("sceglie la card attività interna, senza confonderla con l'articolo che avvolge la scheda", async () => {
    const page = await browser.newPage();
    try {
      await page.route("https://tecnocasa-group.my.site.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<article><h1>Immobile</h1><p>Indirizzo Completo Immobile</p><article id="activities"><h2>Attività e appuntamenti (0)</h2><button>Nuovo</button></article></article>' }));
      await page.goto(url);
      const port = new TecnocloudUiV2Port(page) as unknown as Internals;
      expect(await (await port.activityCard("property-1")).getAttribute("id")).toBe("activities");
    } finally { await page.close(); }
  });
  it("accetta la lista caricata con sole notizie/incarichi e non li apre come immobili", async () => {
    const page = await browser.newPage();
    try {
      await page.route("https://tecnocasa-group.my.site.com/**", route => route.fulfill({ contentType: "text/html", body: '<article><h1>Cliente</h1><article><h2>Immobili/Notizie/Incarichi (2)</h2><a href="/s/notizia/news-1">NT - Via Test 1</a><a href="/s/incarico/mandate-1">IN - Via Test 1</a></article></article>' }));
      await page.goto(url);
      const port = new TecnocloudUiV2Port(page) as unknown as Internals;
      expect(await port.propertyLinksForPerson("person-1", plan)).toEqual([]);
    } finally { await page.close(); }
  });
  it("chiude il solo elenco in lettura bloccato e lo recupera fino al terzo refresh", async () => {
    const page = await browser.newPage(); let loads = 0;
    try {
      await page.route("https://tecnocasa-group.my.site.com/**", route => {
        loads++;
        return route.fulfill({ contentType: "text/html", body: `<article><h2>Immobili/Notizie/Incarichi (3)</h2><button onclick="document.querySelector('[role=dialog]').hidden=false">Visualizza tutto</button></article><section role="dialog" hidden><h2>Immobili/Notizie/Incarichi (3)</h2>${loads >= 5 ? '<a href="/s/notizia/a">NT - Uno</a><a href="/s/notizia/b">NT - Due</a><a href="/s/incarico/c">IN - Tre</a>' : ''}<button aria-label="Chiudi" onclick="this.parentElement.hidden=true">Chiudi</button></section>` });
      });
      await page.goto(url);
      const port = new TecnocloudUiV2Port(page, false, { recoverReadLoading: true });
      vi.spyOn(port as unknown as Internals, "pauseAwareWait").mockImplementation(() => page.waitForTimeout(1));
      expect(await port.listAllPropertiesForPeople(["person-1"], plan)).toEqual([]);
      // Initial property URL + person URL + three retries, each on the person URL.
      expect(loads).toBe(5);
      expect(await page.locator('[role="dialog"]:visible').count()).toBe(0);
    } finally { await page.close(); }
  }, 15_000);
  it("ripristina i radio azzerati da un rerender, attende stabilità e conferma una sola volta", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<section role="dialog"><h2>Nominativo</h2></section><div id="fields"><input type="radio" name="FirstName" value="master"><input type="radio" name="FirstName" value="slave" checked><input type="radio" name="LastName" value="master"><input type="radio" name="LastName" value="slave" checked></div><script>
        let reset = false;
        document.querySelector('input[name="LastName"][value="master"]').onclick = () => {
          if (reset) return; reset = true;
          setTimeout(() => { const fields=document.querySelector('#fields'); fields.innerHTML=fields.innerHTML; fields.querySelector('input[name="FirstName"][value="slave"]').checked=true; }, 50);
        };
      </script>`);
      const port = new TecnocloudUiV2Port(page) as unknown as Internals;
      const save = vi.spyOn(port, "saveReadyMerge").mockImplementation(async () => {
        expect(await page.locator('input[value="master"]:checked').count()).toBe(2);
        return "person-verified";
      });
      expect(await port.resolveVisibleMerge()).toBe("person-verified");
      expect(save).toHaveBeenCalledOnce();
    } finally { await page.close(); }
  }, 15_000);
});
