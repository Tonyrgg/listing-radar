import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { chooseLookupRecordCandidate, lookupCommitConfirmed, ownershipSyncConfirmed } from "../src/import-v2/tecnocloud-ui-port.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { ImportV2Plan } from "../src/import-v2/model.js";

describe("Tecnocloud UI V2", () => {
  it("non scambia il testo digitato per una selezione del lookup", () => {
    expect(lookupCommitConfirmed({
      value: "BITONTO",
      expected: "BITONTO",
      visibleOptionCount: 2,
      optionMarkedSelected: false,
      readonly: false,
      hasSelectionClass: false,
      dependentFieldsVisible: true,
    })).toBe(false);
  });

  it("non accetta il solo testo quando la lista si è chiusa da sola", () => {
    expect(lookupCommitConfirmed({
      value: "BITONTO",
      expected: "BITONTO",
      visibleOptionCount: 0,
      optionMarkedSelected: false,
      readonly: false,
      hasSelectionClass: false,
      dependentFieldsVisible: true,
    })).toBe(false);
  });

  it("accetta soltanto il record realmente agganciato dal lookup", () => {
    expect(lookupCommitConfirmed({
      value: "BITONTO",
      expected: "BITONTO",
      visibleOptionCount: 0,
      optionMarkedSelected: false,
      readonly: true,
      hasSelectionClass: true,
      dependentFieldsVisible: true,
    })).toBe(true);
  });

  it("ignora la riga sintetica di ricerca e sceglie il record CRM di città e provincia", () => {
    expect(chooseLookupRecordCandidate([
      { index: 0, recordId: "", text: "BITONTO" },
      { index: 1, recordId: "a0Q3Y00000ecOpjUAE", text: "BITONTOBITONTO - BA" },
      { index: 2, recordId: "a0Q3Y00000ecOpkUAE", text: "BITONTOBITONTO - XX" },
    ], "BITONTO", "BA")).toEqual({
      index: 1,
      recordId: "a0Q3Y00000ecOpjUAE",
      text: "BITONTOBITONTO - BA",
    });
    expect(chooseLookupRecordCandidate([
      { index: 0, recordId: "", text: "BITONTO" },
    ], "BITONTO", "BA")).toBeNull();
  });

  it("aspetta il vero record del luogo di nascita prima di cliccare", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <c-lookup>
            <label>Luogo Di Nascita</label>
            <div class="slds-combobox_container">
              <input placeholder="Cerca">
              <ul id="results"></ul>
            </div>
          </c-lookup>
          <script>
            const input = document.querySelector('input');
            const results = document.querySelector('#results');
            let timer;
            input.addEventListener('input', () => {
              clearTimeout(timer);
              results.innerHTML = '<li role="option">' + input.value + '</li>';
              timer = setTimeout(() => {
                results.insertAdjacentHTML('beforeend', '<li role="option" data-item-id="a0Q3Y00000ecOpjUAE">BITONTO<span>BITONTO - BA</span></li>');
              }, 650);
            });
            results.addEventListener('click', (event) => {
              const option = event.target.closest('[data-item-id]');
              if (!option) return;
              input.value = 'BITONTO';
              input.readOnly = true;
              document.querySelector('.slds-combobox_container').classList.add('slds-has-selection');
              document.body.dataset.selectedId = option.dataset.itemId;
              results.innerHTML = '';
            });
          </script>
        </body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/account/new");
      const port = new TecnocloudUiV2Port(page);
      await (port as unknown as { fillBirthPlace(value: string, province: string | null): Promise<void> })
        .fillBirthPlace("BITONTO", "BA");
      expect(await page.locator("body").getAttribute("data-selected-id")).toBe("a0Q3Y00000ecOpjUAE");
      expect(await page.locator("input").getAttribute("readonly")).not.toBeNull();
    } finally {
      await browser.close();
    }
  });

  it("non salva un comproprietario finché ruolo e quota non sono comparsi", () => {
    expect(lookupCommitConfirmed({
      value: "Mario Rossi",
      expected: "Mario Rossi",
      visibleOptionCount: 0,
      optionMarkedSelected: false,
      readonly: true,
      hasSelectionClass: true,
      dependentFieldsVisible: false,
    })).toBe(false);
  });

  it("non considera sincronizzato un comproprietario soltanto inviato", () => {
    const desired = [
      { personId: "owner-1", taxCode: "TESTCF0000000001", fullName: "PRIMO TEST", sharePercentage: 50, role: "Proprietario Principale" as const },
      { personId: "owner-2", taxCode: "TESTCF0000000002", fullName: "SECONDO TEST", sharePercentage: 50, role: "Comproprietario" as const },
    ];
    expect(ownershipSyncConfirmed([
      { linkId: "link-1", personId: "owner-1", taxCode: desired[0]!.taxCode, sharePercentage: 50, rightType: "Proprietà", role: "Proprietario Principale" },
    ], desired)).toBe(false);
    expect(ownershipSyncConfirmed([
      { linkId: "link-1", personId: "owner-1", taxCode: desired[0]!.taxCode, sharePercentage: 50, rightType: "Proprietà", role: "Proprietario Principale" },
      { linkId: "link-2", personId: "owner-2", taxCode: desired[1]!.taxCode, sharePercentage: 25, rightType: "Proprietà", role: "Comproprietario" },
    ], desired)).toBe(false);
    expect(ownershipSyncConfirmed([
      { linkId: "link-1", personId: "owner-1", taxCode: desired[0]!.taxCode, sharePercentage: 50, rightType: "Proprietà", role: "Proprietario Principale" },
      { linkId: "link-2", personId: "owner-2", taxCode: desired[1]!.taxCode, sharePercentage: 50, rightType: "Proprietà", role: "Comproprietario" },
    ], desired)).toBe(true);
  });

  it("rilegge proprietario principale e comproprietario dai due blocchi distinti di Tecnocloud", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const field = (label: string, value: string) => `<div><div><label>${label}</label></div><div class="slds-form-element__static"><span class="slds-grow">${value}</span></div></div>`;
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes("/s/account/owner-primary")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>${field("Codice Fiscale", "TESTCF0000000001")}${field("Nome", "PRIMO")}${field("Cognome", "TEST")}</body>` });
          return;
        }
        if (path.includes("/s/account/owner-linked")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>${field("Codice Fiscale", "TESTCF0000000002")}${field("Nome", "SECONDO")}${field("Cognome", "TEST")}</body>` });
          return;
        }
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <h1>IM - Via Francia 10</h1>
          <li class="slds-page-header__detail-block"><div class="slds-text-title">Indirizzo Completo Immobile</div><c-output-field>Via Francia 10, 70032 BITONTO (BA)</c-output-field></li>
          ${field("Catasto Foglio", "38")}${field("Catasto Particella", "215")}${field("Catasto Subalterno", "17")}
          <div class="flex"><div><label><span>Proprietario Predefinito</span></label></div><a href="/CRMImmobiliareLightning/s/account/owner-primary">Primo Test</a></div>
          ${field("Quota Proprietario", "50")}
          <article><h2>Soggetti collegati (1)</h2><ul><li data-id="ownership-linked"><a href="/CRMImmobiliareLightning/s/account/owner-linked">Secondo Test</a><span>Ruolo: Comproprietario Quota: 50 Diritto: Proprieta'</span></li></ul></article>
        </body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/immobile/property-1");
      const property = await new TecnocloudUiV2Port(page).readProperty("property-1");
      expect(property.owners).toEqual([
        expect.objectContaining({ personId: "owner-primary", taxCode: "TESTCF0000000001", sharePercentage: 50, role: "Proprietario Principale" }),
        expect.objectContaining({ personId: "owner-linked", taxCode: "TESTCF0000000002", sharePercentage: 50, role: "Comproprietario" }),
      ]);
    } finally {
      await browser.close();
    }
  });

  it("riusa nella stessa esecuzione una ricerca CF appena verificata", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      let listVisits = 0;
      let personVisits = 0;
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/s/account/Account")) {
          listVisits += 1;
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
            <input title="Search..." onkeydown="if(event.key==='Enter') location.href='/CRMImmobiliareLightning/s/global-search/results'">
          </body>` });
          return;
        }
        if (path.includes("/s/global-search/")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
            <h1>Risultati di ricerca</h1>
            <a data-refid="recordId" data-recordid="person-cache" href="/CRMImmobiliareLightning/s/account/person-cache">Nominativo</a>
          </body>` });
          return;
        }
        if (path.includes("/s/account/person-cache")) {
          personVisits += 1;
          const fields = [
            ["Codice Fiscale", "TESTCF0000000000"], ["Nome", "NOME"], ["Cognome", "COLLAUDO"],
          ];
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
            ${fields.map(([label, value]) => `<div><div><label>${label}</label></div><div class="slds-form-element__static"><span class="slds-grow">${value}</span></div></div>`).join("")}
          </body>` });
          return;
        }
        await route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const port = new TecnocloudUiV2Port(page);
      const first = await port.searchPeopleByExactTaxCode("TESTCF0000000000");
      const second = await port.searchPeopleByExactTaxCode("TESTCF0000000000");
      expect(first).toEqual(second);
      expect(listVisits).toBe(1);
      expect(personVisits).toBe(1);
    } finally {
      await browser.close();
    }
  });

  it("recupera chiudendo le finestre residue senza ricaricare la home", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      let visits = 0;
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        visits += 1;
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <div role="dialog"><button onclick="this.parentElement.hidden=true">Annulla</button></div>
        </body>` });
      });
      const url = "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/account/person-1";
      await page.goto(url);
      await new TecnocloudUiV2Port(page).recover("people_resolved", new Error("temporaneo"));
      expect(page.url()).toBe(url);
      expect(await page.locator('[role="dialog"]:visible').count()).toBe(0);
      expect(visits).toBe(1);
    } finally {
      await browser.close();
    }
  });

  it("apre Visualizza tutto, abbina il nome IM e non visita Notizie o immobili estranei", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const visited: string[] = [];
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        visited.push(path);
        if (path.includes("/s/account/person-1")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
            <article><h2>Immobili/Notizie/Incarichi (3)</h2><button onclick="document.querySelector('[role=dialog]').hidden=false">Visualizza tutto</button></article>
            <div role="dialog" hidden><h2>Immobili/Notizie/Incarichi (3)</h2><table><tbody>
              <tr><td><a href="/CRMImmobiliareLightning/s/immobile/property-match">IM - Via Francia 10 [2] - Centro</a></td></tr>
              <tr><td><a href="/CRMImmobiliareLightning/s/notizia/news-1">NT - Via Francia 10 - Centro</a></td></tr>
              <tr><td><a href="/CRMImmobiliareLightning/s/immobile/property-other">IM - Via Altra 4 - Centro</a></td></tr>
            </tbody></table><button aria-label="Chiudi" onclick="this.parentElement.hidden=true">Chiudi</button></div>
          </body>` });
          return;
        }
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <h1>IM - Via Francia 10 [2] - Centro</h1>
          <li class="slds-page-header__detail-block"><div class="slds-text-title">Indirizzo Completo Immobile</div><c-output-field>Via Francia 10 [2], 70032 BITONTO (BA)</c-output-field></li>
          ${[["Catasto Sezione Urbana", ""], ["Catasto Foglio", "38"], ["Catasto Particella", "215"], ["Catasto Denom Particella", ""], ["Catasto Subalterno", "17"], ["Catasto Rendita", "356,36"]].map(([label, value]) => `<div class="flex"><div><label>${label}</label></div><div class="slds-form-element__static"><span class="slds-grow">${value}</span></div></div>`).join("")}
          <article><h2>Soggetti collegati (0)</h2></article>
        </body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const plan: ImportV2Plan = {
        version: 2,
        fingerprint: "fixture",
        source: {
          sourcePropertyId: "source-1", jobId: "job-1", municipality: "BITONTO",
          fullAddress: "VIA FRANCIA n. 10 INTERNO 2 Piano T, 70032 BITONTO (BA)",
          cadastral: { urbanSection: null, sheet: "38", parcel: "215", parcelDenomination: null, subaltern: "17", income: 356.36 },
          category: "A/2", propertyClass: "3", consistency: "6 vani",
          activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }, owners: [],
        },
      };
      const found = await new TecnocloudUiV2Port(page).listAllPropertiesForPeople(["person-1"], plan);
      expect(found.map((property) => property.id)).toEqual(["property-match"]);
      expect(visited.some((path) => path.includes("property-other"))).toBe(false);
      expect(visited.some((path) => path.includes("news-1"))).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
