import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import { buildPlan, choosePropertyCandidate } from "../src/import-v2/identity.js";
import { simulationSource } from "../src/territory/providers.js";
import { assess } from "../src/territory/reconcile.js";

const source = simulationSource({ id: "194", name: "Via Francesco Perrese", sisterName: "VIA FRANCESCO PERRESE", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false }, 1, "test");
source.cadastral = { urbanSection: null, sheet: "40", parcel: "194", parcelDenomination: null, subaltern: "6", income: null };
source.fullAddress = "VIA FRANCESCO PERRESE N. 4 Piano 1";
describe("Righe Cloud visibili e duplicati catastali reali", () => {
  it.each(["first", "second", "stale"])("legge i link senza checkbox visibili e protegge i risultati %s con telemetria aperta", async mode => {
    const registrySecond = mode === "second";
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    let release!: () => void;
    const background = new Promise<void>(resolve => { release = resolve; });
    try {
      const page = await browser.newPage(); let telemetry = false;
      await page.route("https://tecnocasa-group.my.site.com/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/background") { telemetry = true; await background; await route.fulfill({ body: "ok" }).catch(() => {}); return; }
        if (/\/s\/immobile\/(?:first|second)$/.test(pathname)) {
          const second = pathname.endsWith("second"), checked = second === registrySecond;
          await route.fulfill({ contentType: "text/html", body: `<h1>IM - ${source.fullAddress}</h1><li class="slds-page-header__detail-block"><span class="slds-text-title">Indirizzo Completo Immobile</span><c-output-field>${source.fullAddress}</c-output-field></li>${[["Catasto Foglio","40"],["Catasto Particella",mode === "stale" ? "195" : "194"],["Catasto Subalterno","6"]].map(([label,value]) => `<div><div><label>${label}</label></div><span class="slds-form-element__static">${value}</span></div>`).join('')}<div><div><label>Importato da visura</label></div><input type="checkbox" ${checked ? "checked" : ""}></div>` }); return;
        }
        await route.fulfill({ contentType: "text/html", body: `<input placeholder="--- Seleziona ---" value="Immobili residenziali"><button title="Filters" aria-expanded="false">Filtri</button><div id="drawer" hidden>${[9,26,27,31].map(index => `<lightning-input c-queryviewerfilters_queryviewerfilters data-index="${index}"><input></lightning-input>`).join('')}<button id="apply">Applica</button></div><div id="results"></div><script>document.querySelector('[title=Filters]').onclick=e=>{e.target.setAttribute('aria-expanded','true');document.querySelector('#drawer').hidden=false};document.querySelector('#apply').onclick=()=>{document.querySelector('#results').innerHTML='<table><tbody><tr><td><lightning-input c-queryviewer_queryviewer data-id="first" hidden></lightning-input><a href="/CRMImmobiliareLightning/s/immobile/first">IM - via francesco perrese 4 - Prova</a></td></tr><tr><td><lightning-input c-queryviewer_queryviewer data-id="second" hidden></lightning-input><a href="/CRMImmobiliareLightning/s/immobile/second">IM - Via Francesco Perrese 4 [1] - Prova</a></td></tr></tbody></table>';fetch('/background')}</script>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const lookup = new TecnocloudUiV2Port(page, false, { cadastralLookupOnly: true }).findPropertiesByCadastralIdentity(buildPlan(source));
      if (mode === "stale") { await expect(lookup).rejects.toThrow("nessuna creazione automatica"); return; }
      const rows = await lookup;
      expect(telemetry).toBe(true); expect(rows.map(r => r.id)).toEqual(["first", "second"]);
      expect(rows.map(r => r.importedFromRegistry)).toEqual(registrySecond ? [false, true] : [true, false]);
      const chosen = registrySecond ? "second" : "first";
      expect(assess(source, rows, true)).toMatchObject({ kind: "update", candidateId: chosen });
      expect(choosePropertyCandidate(source, rows, true).candidate?.id).toBe(chosen);
    } finally { release(); await browser.close(); }
  }, 15000);
});
