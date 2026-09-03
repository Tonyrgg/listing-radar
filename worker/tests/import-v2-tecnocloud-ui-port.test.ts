import { describe, expect, it } from "vitest";
import { chromium, type Locator } from "playwright";

import { chooseLookupRecordCandidate, lookupCommitConfirmed, ownershipSyncConfirmed, propertyAddressFilterTerms } from "../src/import-v2/tecnocloud-ui-port.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { ImportV2Plan } from "../src/import-v2/model.js";

describe("Tecnocloud UI V2", () => {
  it.each([1, 2])("rilegge tutti i %s riscontri catastali e attende i dettagli senza cercare tutta la via", async (count) => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const searches: string[] = [];
      await page.route("https://tecnocasa-group.my.site.com/**", (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (/\/immobile\/record-/.test(pathname)) return route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <li class="slds-page-header__detail-block"><span class="slds-text-title">Indirizzo Completo Immobile</span><c-output-field>Via Guidone 10, 70032 BITONTO (BA)</c-output-field></li>
          <script>setTimeout(() => {
            const fields = [['Catasto Foglio', '38'], ['Catasto Particella', '215'], ['Catasto Subalterno', '17']];
            for (const [label, value] of fields) document.body.insertAdjacentHTML('beforeend', '<div><div><label>' + label + '</label></div><div class="slds-form-element__static">' + value + '</div></div>');
          }, 650);</script></body>` });
        if (pathname === '/applied') {
          searches.push(new URL(route.request().url()).searchParams.get('values') ?? '');
          return route.fulfill({ body: 'ok' });
        }
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <input placeholder="--- Seleziona ---" value="Immobili residenziali">
          ${[1, 9, 26, 27, 31].map(index => '<lightning-input c-queryviewerfilters_queryviewerfilters data-index="' + index + '"><input></lightning-input>').join('')}
          <button id="apply">Applica</button><div id="results"></div>
          <script>document.querySelector('#apply').onclick = () => {
            const values = [9,26,27,31].map(index => document.querySelector('[data-index="' + index + '"] input').value).join('|');
            fetch('/applied?values=' + encodeURIComponent(values));
            document.querySelector('#results').innerHTML = Array.from({length: ${count}}, (_, i) => '<lightning-input c-queryviewer_queryviewer data-id="record-' + i + '"><input type="checkbox"></lightning-input>').join('');
          };</script></body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const plan: ImportV2Plan = { version: 2, fingerprint: "exact", source: {
        sourcePropertyId: "p", jobId: "j", municipality: "BITONTO", fullAddress: "VIA GUIDONE n. 10 Piano T, 70032 BITONTO (BA)",
        cadastral: { urbanSection: null, sheet: "38", parcel: "215", parcelDenomination: null, subaltern: "17", income: null },
        category: "A/2", propertyClass: "3", consistency: "6 vani", owners: [],
        activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" },
      } };
      const found = await new TecnocloudUiV2Port(page).findPropertiesByCadastralIdentity(plan);
      expect(found.map(item => item.id)).toEqual(Array.from({ length: count }, (_, i) => `record-${i}`));
      expect(found.every(item => item.cadastral?.sheet === "38" && item.cadastral.parcel === "215" && item.cadastral.subaltern === "17")).toBe(true);
      expect(searches).toEqual(["|38|215|17"]);
    } finally { await browser.close(); }
  }, 20_000);

  it.each([650, 2_200])("attende la riconciliazione dopo %s ms anche se il modulo scompare sulla scheda già aperta", async (delay) => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        if (new URL(route.request().url()).pathname === "/merge-check") {
          await new Promise(resolve => setTimeout(resolve, delay));
          return route.fulfill({ body: "ok" });
        }
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
        <div><div><label>Codice Fiscale</label></div><div class="slds-form-element__static">RSSMRA80A01A893P</div></div>
        <section role="dialog" id="form"><label>Codice Fiscale<input value="RSSMRA80A01A893P"></label><button id="submit">Salva</button></section>
        <script>
          document.querySelector('#submit').onclick = () => {
            document.querySelector('#form').remove();
            fetch('/merge-check').then(() => {
              document.body.insertAdjacentHTML('beforeend', '<section role="dialog" id="merge"><h2>Nominativo</h2></section><div id="fields"><input type="radio" name="FirstName" value="master" checked><input type="radio" name="FirstName" value="slave"><input type="radio" name="LastName" value="master"><input type="radio" name="LastName" value="slave" checked><p id="blocked">Non si può procedere al salvataggio</p><p id="ready" hidden>Tutti i campi sono stati riconciliati</p><button id="confirm" disabled>Salva</button></div>');
              const clicked = new Set();
              document.querySelectorAll('input[value="master"]').forEach(input => input.onclick = () => {
                clicked.add(input.name);
                if (clicked.size === 2) setTimeout(() => {
                  document.querySelector('#blocked').remove();
                  document.querySelector('#ready').hidden = false;
                  setTimeout(() => document.querySelector('#confirm').disabled = false, 350);
                }, 350);
              });
              document.querySelector('#confirm').onclick = () => {
                document.body.dataset.merged = 'yes';
                document.querySelector('#merge').remove();
                document.querySelector('#fields').remove();
              };
            });
          };
        </script></body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/account/001RD00000ywHCnYAM");
      const port = new TecnocloudUiV2Port(page);
      expect(await (port as unknown as { savePersonForm(): Promise<{ personId: string; merged: boolean }> }).savePersonForm())
        .toEqual({ personId: "001RD00000ywHCnYAM", merged: true });
      expect(await page.locator('body').getAttribute('data-merged')).toBe('yes');
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
    } finally { await browser.close(); }
  }, 20_000);

  it("cerca prima la via completa e poi il nome distintivo", () => {
    expect(propertyAddressFilterTerms("Via Zuavo")).toEqual(["Via Zuavo", "Zuavo"]);
  });

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

  it("aspetta che un picklist completi le opzioni prima di dichiarare assente il valore", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body><c-input-field>
          <input role="textbox" value="Telefonata">
          <div id="options"></div>
          <script>
            const input = document.querySelector('input');
            input.addEventListener('click', () => {
              document.querySelector('#options').innerHTML = '<div role="option">Telefonata</div>';
              setTimeout(() => document.querySelector('#options').insertAdjacentHTML('beforeend', '<div role="option">Contatto diretto</div>'), 650);
            });
            document.querySelector('#options').addEventListener('click', event => {
              const option = event.target.closest('[role=option]');
              if (option) input.value = option.textContent.trim();
            });
          </script>
        </c-input-field></body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const port = new TecnocloudUiV2Port(page);
      await (port as unknown as { pick(component: Locator, expected: string, label: string): Promise<void> })
        .pick(page.locator("c-input-field"), "Contatto diretto", "Modalità contatto");
      expect(await page.locator("input").inputValue()).toBe("Contatto diretto");
    } finally {
      await browser.close();
    }
  });

  it("nel merge clicca ogni radio master anche se il controllo nativo misura un pixel", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("/s/account/001RD00000ywHCnYAM")) {
          await route.fulfill({ contentType: "text/html", body: "<!doctype html><body>Scheda nominativo</body>" });
          return;
        }
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <section role="dialog"><h2>Nominativo</h2><p>Merge dei campi</p></section>
          <div id="merge-fields">
            <span><input style="width:1px;height:1px" type="radio" name="FirstName" value="master" checked></span>
            <span><input style="width:1px;height:1px" type="radio" name="FirstName" value="slave"></span>
            <span><input style="width:1px;height:1px" type="radio" name="LastName" value="master"></span>
            <span><input style="width:1px;height:1px" type="radio" name="LastName" value="slave" checked></span>
          </div>
          <p id="ready" hidden>Tutti i campi sono stati riconciliati</p>
          <button id="save" disabled>Salva</button>
          <script>
            const clicked = new Set();
            const masters = [...document.querySelectorAll('input[value="master"]')];
            for (const input of masters) input.addEventListener('click', () => {
              clicked.add(input.name);
              if (clicked.size === masters.length) {
                document.querySelector('#ready').hidden = false;
                document.querySelector('#save').disabled = false;
              }
            });
            document.querySelector('#save').addEventListener('click', () => {
              location.href = '/CRMImmobiliareLightning/s/account/001RD00000ywHCnYAM/merge-test?left=' + clicked.size;
            });
          </script>
        </body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/account/Account");
      const port = new TecnocloudUiV2Port(page);
      const personId = await (port as unknown as { resolveVisibleMerge(): Promise<string> }).resolveVisibleMerge();
      expect(personId).toBe("001RD00000ywHCnYAM");
      expect(page.url()).toContain("left=2");
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
          <article>Potenziale acquisizione 0 Informatori 0 Soggetti collegati 1</article>
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

  it("non interpreta come zero risultati una ricerca CF ancora in caricamento", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/s/account/Account")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
            <input title="Search..." onkeydown="if(event.key==='Enter') location.href='/CRMImmobiliareLightning/s/global-search/results'">
          </body>` });
          return;
        }
        if (path.includes("/s/global-search/")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
            <h1>Risultati di ricerca</h1><section>Clienti</section>
            <script>setTimeout(() => document.querySelector('section').insertAdjacentHTML('beforeend', '<a data-refid="recordId" data-recordid="person-delayed" href="/CRMImmobiliareLightning/s/account/person-delayed">Nominativo</a>'), 700)</script>
          </body>` });
          return;
        }
        if (path.includes("/s/account/person-delayed")) {
          await route.fulfill({ contentType: "text/html", body: `<!doctype html><body><main></main><script>
            setTimeout(() => {
              document.querySelector('main').innerHTML = [
                ['Codice Fiscale', 'TESTCF0000000000'], ['Nome cliente', 'Nome Collaudo'],
                ['Data Di Nascita', '07/06/49'], ['Luogo Di Nascita', 'BITONTO (BA)']
              ].map(([label, value]) => '<div><div><label>' + label + '</label></div><div class="slds-form-element__static"><span class="slds-grow">' + value + '</span></div></div>').join('');
            }, 600);
          </script></body>` });
          return;
        }
        await route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const matches = await new TecnocloudUiV2Port(page).searchPeopleByExactTaxCode("TESTCF0000000000");
      expect(matches).toEqual([expect.objectContaining({
        id: "person-delayed",
        taxCode: "TESTCF0000000000",
        fullName: "Nome Collaudo",
        birthDate: "1949-06-07",
        birthPlace: "BITONTO",
        birthProvince: "BA",
      })]);
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

  it("conferma l'attività solo dopo il salvataggio reale e distingue il popup successivo", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <div>Indirizzo Completo Immobile</div>
          <article id="activity"><h2>Attivita e appuntamenti (0)</h2><button id="new">Nuovo</button></article>
          <section id="form" role="dialog" hidden>
            <h2>Attivita e appuntamenti</h2>
            <c-input-field><label>Cliente</label><input value="Maria Collaudo"></c-input-field>
            <c-input-field><label>Correlato a</label><input value="IM - VIA TEST 10"></c-input-field>
            <c-input-field><label>Modalità Contatto</label><input role="textbox" value="Telefonata" data-pick="contact"></c-input-field>
            <c-input-field><label>Stato</label><input role="textbox" value="Da eseguire" data-pick="status"></c-input-field>
            <c-input-field><label>Descrizione</label><textarea></textarea></c-input-field>
            <button id="save">Salva</button>
          </section>
          <section id="follow-up" role="dialog" hidden>
            <h2>Attivita e appuntamenti</h2><p>Vuoi pianificare un'altra attivit&agrave;/appuntamento?</p>
            <button onclick="this.closest('[role=dialog]').hidden=true">Annulla</button>
          </section>
          <div id="options"></div>
          <script>
            const form = document.querySelector('#form');
            document.querySelector('#new').onclick = () => form.hidden = false;
            document.querySelectorAll('[data-pick]').forEach(input => input.onclick = () => {
              const values = input.dataset.pick === 'contact' ? ['Telefonata', 'Contatto diretto'] : ['Da eseguire', 'Eseguito'];
              document.querySelector('#options').innerHTML = values.map(value => '<div role="option" data-target="' + input.dataset.pick + '">' + value + '</div>').join('');
            });
            document.querySelector('#options').onclick = event => {
              const option = event.target.closest('[role=option]');
              if (!option) return;
              document.querySelector('[data-pick="' + option.dataset.target + '"]').value = option.textContent.trim();
              document.querySelector('#options').innerHTML = '';
            };
            document.querySelector('#save').onclick = () => {
              const description = form.querySelector('textarea').value;
              document.querySelector('#activity').innerHTML = '<h2>Attivita e appuntamenti (1+)</h2><div>Ricerca - Eseguito</div><div>Descrizione ' + description + '</div>';
              form.hidden = true;
              document.querySelector('#follow-up').hidden = false;
            };
          </script>
        </body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/immobile/property-activity");
      const plan = {
        version: 2, fingerprint: "activity-fixture",
        source: {
          sourcePropertyId: "source-1", jobId: "job-1", municipality: "BITONTO",
          fullAddress: "VIA TEST n. 10, 70032 BITONTO (BA)",
          cadastral: { urbanSection: null, sheet: "38", parcel: "215", parcelDenomination: null, subaltern: "17", income: null },
          category: "A/2", propertyClass: "3", consistency: "6 vani",
          activity: { enabled: true, description: "Non sa nulla", contactMode: "Contatto diretto", status: "Eseguito" }, owners: [],
        },
      } satisfies ImportV2Plan;
      const result = await new TecnocloudUiV2Port(page).ensureActivity("property-activity", plan);
      expect(result.outcome).toBe("created");
      expect(await page.locator('#activity').innerText()).toContain("Non sa nulla");
      expect(await page.locator('[role="dialog"]:visible').count()).toBe(0);
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("scorre il pannello filtri fino ai campi catastali prima di compilarli", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1_200, height: 500 } });
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
          <input id="view" placeholder="--- Seleziona ---" value="• Immobili residenziali">
          <button title="Filters">Filters</button>
          <style>lightning-input{display:block;height:32px} lightning-input input{display:block;width:200px;height:30px}</style>
          <div id="drawer" hidden style="position:fixed;right:0;top:50px;width:360px;height:260px;overflow:auto">
            <lightning-input c-queryviewerfilters_queryviewerfilters data-index="1"><input></lightning-input>
            <div style="height:400px"></div>
            <lightning-input c-queryviewerfilters_queryviewerfilters data-index="9"><input></lightning-input>
            <div style="height:500px"></div>
            <lightning-input c-queryviewerfilters_queryviewerfilters data-index="26"><input></lightning-input>
            <div style="height:120px"></div>
            <lightning-input c-queryviewerfilters_queryviewerfilters data-index="27"><input></lightning-input>
            <div style="height:300px"></div>
            <lightning-input c-queryviewerfilters_queryviewerfilters data-index="31"><input></lightning-input>
            <button id="apply">Applica</button>
          </div>
          <p id="empty" hidden>Nessun risultato</p>
          <script>
            window.searches = [];
            setTimeout(() => document.querySelector('[title=Filters]').addEventListener('click', () => {
              document.querySelector('#drawer').hidden = false;
            }), 700);
            document.querySelector('#apply').addEventListener('click', () => {
              document.querySelector('#empty').hidden = false;
              window.searches.push(['9','26','27','31'].map(index => document.querySelector('lightning-input[data-index="'+index+'"] input').value).join('|'));
            });
          </script>
        </body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const plan: ImportV2Plan = {
        version: 2,
        fingerprint: "cadastral-filter-fixture",
        source: {
          sourcePropertyId: "source-1", jobId: "job-1", municipality: "BITONTO",
          fullAddress: "VIA FRANCIA n. 10 Piano T, 70032 BITONTO (BA)",
          cadastral: { urbanSection: null, sheet: "38", parcel: "215", parcelDenomination: null, subaltern: "17", income: null },
          category: "A/2", propertyClass: "3", consistency: "6 vani",
          activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }, owners: [],
        },
      };
      await new TecnocloudUiV2Port(page).findPropertiesByCadastralIdentity(plan);
      const value = (index: number) => page.locator(`lightning-input[data-index="${index}"] input`).inputValue();
      expect(await Promise.all([value(9), value(26), value(27), value(31)])).toEqual(["FRANCIA", "", "", ""]);
      expect(await page.evaluate(() => (window as unknown as { searches: string[] }).searches)).toEqual([
        "|38|215|17",
        "VIA FRANCIA|||",
        "FRANCIA|||",
      ]);
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("riconosce il posizionamento dal confronto indirizzo e conferma tutti i valori inseriti", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", async (route) => {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><body><main></main><script>
          setTimeout(() => document.querySelector('main').innerHTML = \`
          <section role="dialog">
            <h2>Immobile</h2>
            <input style="width:1px;height:1px" type="radio" name="street" id="street_current-1" value="VIA FRANCIA" checked>
            <input style="width:1px;height:1px" type="radio" name="street" id="street_google-1" value="Via Francia">
            <input style="width:1px;height:1px" type="radio" name="streetN" id="streetN_current-1" value="10">
            <input style="width:1px;height:1px" type="radio" name="streetN" id="streetN_google-1" value="10" checked>
            <input style="width:1px;height:1px" type="radio" name="CAP" id="CAP_current-1" value="70032">
            <input style="width:1px;height:1px" type="radio" name="CAP" id="CAP_google-1" value="70032" checked>
            <c-picklist><label>LOCALITÀ</label><input role="textbox"><div role="option" onclick="this.parentElement.querySelector('input').value=this.textContent">CENTRO BITONTO</div></c-picklist>
            <button onclick="this.closest('[role=dialog]').hidden=true">Salva</button>
          </section>
          \`, 650);
        </script></body>` });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const port = new TecnocloudUiV2Port(page);
      const plan = {
        version: 2, fingerprint: "positioning-fixture",
        source: {
          sourcePropertyId: "source-1", jobId: "job-1", municipality: "BITONTO",
          fullAddress: "VIA FRANCIA n. 10, 70032 BITONTO (BA)",
          cadastral: { urbanSection: null, sheet: "38", parcel: "215", parcelDenomination: null, subaltern: "17", income: null },
          category: "A/2", propertyClass: "3", consistency: "6 vani",
          activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }, owners: [],
        },
      } satisfies ImportV2Plan;
      await (port as unknown as { finishPropertyPositioning(plan: ImportV2Plan): Promise<void> }).finishPropertyPositioning(plan);
      expect(await page.locator('#street_current-1').isChecked()).toBe(true);
      expect(await page.locator('#streetN_current-1').isChecked()).toBe(true);
      expect(await page.locator('#CAP_current-1').isChecked()).toBe(true);
      expect(await page.locator('c-picklist input').inputValue()).toBe("CENTRO BITONTO");
      expect(await page.locator('[role=dialog]').isHidden()).toBe(true);
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
