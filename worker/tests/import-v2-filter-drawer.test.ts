import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { ImportV2Plan } from "../src/import-v2/model.js";

const plan: ImportV2Plan = { version: 2, fingerprint: "filters", source: {
  sourcePropertyId: "p", jobId: "j", municipality: "BITONTO", fullAddress: "VIA GUIDONE 10",
  cadastral: { urbanSection: null, sheet: "38", parcel: "215", parcelDenomination: null, subaltern: "17", income: null },
  category: "A/2", propertyClass: "3", consistency: "6 vani", owners: [],
  activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" },
} };

describe("Controllo effettivo dei filtri immobili", () => {
  it.each(["empty-host", "offscreen", "delayed-view", "delayed-fields", "slow-open"])("apre il pannello e applica la terna con %s", async (mode) => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
        <input id="view" placeholder="--- Seleziona ---" value="${mode === "delayed-view" ? "Altra vista" : "Immobili residenziali"}">
        <div id="options"></div><button title="Filters" aria-expanded="false">Filtri</button>
        <style>lightning-input {display:block;min-height:20px} #drawer{position:fixed;right:0;top:70px;width:300px;background:white}</style>
        <lightning-input c-queryviewerfilters_queryviewerfilters data-index="1"></lightning-input>
        <div id="drawer" ${mode === "offscreen" ? 'style="transform:translateX(120%)"' : "hidden"}>
          ${(mode === "delayed-fields" ? [9] : [9,26,27,31]).map(index => '<lightning-input c-queryviewerfilters_queryviewerfilters data-index="' + index + '"><input></lightning-input>').join('')}
          <button id="apply">Applica</button>
        </div>
        <div id="results">Nessun risultato</div>
        <script>
          window.applied = [];
          document.querySelector('#view').onclick = () => {
            document.querySelector('#options').innerHTML = '<div role="option">Altra vista</div>';
            setTimeout(() => document.querySelector('#options').insertAdjacentHTML('beforeend', '<div role="option">Immobili residenziali</div>'), 650);
          };
          document.querySelector('#options').onclick = event => {
            document.querySelector('#view').value = event.target.textContent;
            document.querySelector('#options').innerHTML = '';
          };
          document.querySelector('[title=Filters]').onclick = event => {
            document.body.dataset.opened = 'yes';
            document.body.dataset.openClicks = String(Number(document.body.dataset.openClicks || 0) + 1);
            event.target.setAttribute('aria-expanded', 'true');
            setTimeout(() => {
              document.querySelector('#drawer').hidden = false;
              document.querySelector('#drawer').style.transform = '';
            }, ${mode === "slow-open" ? 1_800 : 0});
            ${mode === "delayed-fields" ? `setTimeout(() => {
              for (const index of [26,27,31]) document.querySelector('#drawer').insertAdjacentHTML('beforeend', '<lightning-input c-queryviewerfilters_queryviewerfilters data-index="' + index + '"><input></lightning-input>');
            }, 650);` : ""}
          };
          document.querySelector('#apply').onclick = () => {
            window.applied.push([9,26,27,31].map(index => document.querySelector('[data-index="' + index + '"] input').value));
          };
        </script></body>` }));
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      await new TecnocloudUiV2Port(page).findPropertiesByCadastralIdentity(plan);
      expect(await page.locator('body').getAttribute('data-opened')).toBe("yes");
      expect(await page.locator('body').getAttribute('data-open-clicks')).toBe("1");
      const applied = await page.evaluate(() => (window as unknown as { applied: string[][] }).applied);
      expect(applied[0]).toEqual(["", "38", "215", "17"]);
    } finally { await browser.close(); }
  }, 20_000);
});
