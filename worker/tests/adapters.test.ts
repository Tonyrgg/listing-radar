import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { PlaywrightCrmAdapter } from "../src/adapters/crm/index.js";
import { crmFixtureSelectors, crmSelectors } from "../src/adapters/crm/selectors.js";
import { PlaywrightSisterAdapter } from "../src/adapters/sister/index.js";
import { sisterFixtureSelectors, sisterSelectors } from "../src/adapters/sister/selectors.js";

const fixture = (name: string) => fileURLToPath(new URL(`../src/fixtures/${name}`, import.meta.url));

describe("adattatori con fixture HTML", () => {
  it("salta i record SISTER privi di dati catastali senza perdere l'ordine dei record validi", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("sister-results-empty-records.html"), "utf8"));
      const adapter = new PlaywrightSisterAdapter(page, sisterSelectors);
      const properties = await adapter.extractProperties();
      expect(properties.map(({ subaltern }) => subaltern)).toEqual(["4", "7"]);
      expect(properties.map(({ category }) => category)).toEqual(["A/3", "C/2"]);
      expect(properties.map(({ rawPayload }) => rawPayload.sourceOrder)).toEqual([2, 4]);
      expect(adapter.getIgnoredEmptyProperties()).toEqual([
        expect.objectContaining({ rowIndex: 0, subaltern: "2" }),
        expect.objectContaining({ rowIndex: 1, subaltern: "3" }),
        expect.objectContaining({ rowIndex: 3, subaltern: "6" }),
      ]);
      expect(adapter.getIgnoredCategories()).toEqual([]);
    } finally { await browser.close(); }
  });

  it("mantiene l'ordine esatto delle sedici righe mostrate da SISTER", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("sister-results-order.html"), "utf8"));
      const properties = await new PlaywrightSisterAdapter(page, sisterSelectors).extractProperties();
      expect(properties).toHaveLength(9);
      expect(properties.map(({ parcel, subaltern }) => `${parcel}|${subaltern}`)).toEqual([
        "2278|20", "2455|9", "2455|10", "2455|11", "2455|12", "2455|15", "2455|16", "2455|17", "2455|18",
      ]);
      expect(properties.map(({ category }) => category)).toEqual([
        "C/2", "A/2", "A/2", "A/2", "A/2", "A/2", "A/2", "A/2", "A/2",
      ]);
      expect(properties.map(({ rawPayload }) => rawPayload.sourceOrder)).toEqual([0, 8, 9, 10, 11, 12, 13, 14, 15]);
    } finally { await browser.close(); }
  });

  it("legge in blocco un inventario SISTER molto grande senza congelare la long mode", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const rows = Array.from({ length: 2_200 }, (_, index) => `
        <tr>
          <td><input name="visImmSel" type="radio" value="${index}" /></td>
          <td>50</td><td>${1_000 + index}</td><td>${index + 1}</td>
          <td>VIA TEST n. ${index + 1}</td><td>U</td><td>A03</td><td>2</td><td>5 vani</td><td>432,10</td>
        </tr>`).join("");
      await page.setContent(`<!doctype html><body>
        <fieldset><legend>Dati della ricerca</legend>Comune: BITONTO Codice: A893 Indirizzo: VIA TEST Numeri civici</fieldset>
        <form name="SceltaVisuraImmSoggForm"><table class="listaIsp4">
          <tr><th></th><th>Foglio</th><th>Particella</th><th>Sub</th><th>Indirizzo</th><th>Zona cens</th><th>Categoria</th><th>Classe</th><th>Consistenza</th><th>Rendita</th></tr>
          ${rows}
        </table></form>
      </body>`);
      const startedAt = Date.now();
      const properties = await new PlaywrightSisterAdapter(page, sisterSelectors).extractProperties();
      const elapsedMs = Date.now() - startedAt;
      expect(properties).toHaveLength(2_200);
      expect(properties[2_199]).toMatchObject({ sheet: "50", parcel: "3199", subaltern: "2200", category: "A/3" });
      expect(elapsedMs).toBeLessThan(5_000);
    } finally { await browser.close(); }
  }, 10_000);

  it("riconosce l'Elenco indirizzi come pagina operativa per la long mode", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body>
        <form name="SceltaIndirizzoForm">
          <select name="indirizzoSel"><option value="1">VIA TEST</option></select>
        </form>
      </body>`);
      const adapter = new PlaywrightSisterAdapter(page, sisterSelectors);
      expect(await adapter.detectPage()).toBe(false);
      expect(await adapter.detectOperationalPage()).toBe("address-list");
    } finally { await browser.close(); }
  });

  it("estrae le categorie A/C nell'ordine SISTER e i proprietari", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("sister-results.html"), "utf8"));
      const adapter = new PlaywrightSisterAdapter(page, sisterFixtureSelectors);
      expect(await adapter.detectPage()).toBe(true);
      const properties = await adapter.extractProperties();
      expect(properties).toHaveLength(1);
      expect(properties[0]).toMatchObject({ sheet: "58", parcel: "1234", subaltern: "7", category: "A/3", cadastralIncome: 432.1 });
      const owners = await adapter.extractOwners(properties[0]!);
      expect(owners).toHaveLength(2);
      expect(owners.map((owner) => owner.taxCode)).toEqual(["CQVMRS49L66A893R", "CRLCLD78R26A893Q"]);
      expect(adapter.getIgnoredBusinesses()).toEqual([
        expect.objectContaining({ fullName: "EDILE & IMMOBILIARE COCE S.R.L.", taxCode: "075******24", reason: "business-tax-code", rowIndex: 0 }),
      ]);
    } finally { await browser.close(); }
  });

  it("cerca nominativi e immobili nel gestionale fixture", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      expect(await adapter.detectPage()).toBe(true);
      expect((await adapter.findPerson({ taxCode: "CQVMRS49L66A893R", phones: [], fullName: "Maria", birthDate: null })).matches[0]?.id).toBe("P-42");
      const property = {
        municipality: "BITONTO", sheet: "58", parcel: "1234", subaltern: "7", address: "Via Roma 12",
        censusZone: null, category: "A/3", class: "2", consistency: "5 vani", cadastralIncome: 432.1, rawPayload: {},
      };
      expect((await adapter.findPropertyForPerson("P-42", property)).match?.id).toBe("I-42");
      expect((await adapter.findLinkedPropertyByAddress("P-42", property)).match).toMatchObject({
        id: "I-42",
        data: { matchedBy: "address-for-person-selection", addressVerified: true },
      });
      const addressMatch = (await adapter.findPropertyForPerson("P-42", { ...property, sheet: "99", parcel: "9999", subaltern: "99" })).match;
      expect(addressMatch).toBeNull();
      expect((await adapter.findPropertyForPerson("P-42", property, ["I-42"])).match).toBeNull();
    } finally { await browser.close(); }
  });

  it("apre Visualizza tutto, ignora le righe NT e identifica l'immobile dalla terna catastale", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const visitedProperties: string[] = [];
      const accountHtml = `
        <main>
          <article data-worker-crm="personPropertiesCard">
            Immobili/Notizie/Incarichi (4)
            <a data-worker-crm="personPropertyLinks" href="/CRMImmobiliareLightning/s/immobile/I-FIRST">IM - Via Roma 12</a>
            <a data-worker-crm="personPropertyLinks" href="/CRMImmobiliareLightning/s/immobile/I-SECOND">IM - Via Roma 12</a>
            <button data-worker-crm="personPropertiesViewAll"
              onclick="document.querySelector('[data-worker-crm=personPropertiesModal]').hidden=false">
              Visualizza tutto
            </button>
          </article>
          <section role="dialog" data-worker-crm="personPropertiesModal" hidden>
            <h2>Immobili/Notizie/Incarichi (4)</h2>
            <table><tbody>
              <tr data-worker-crm="personPropertiesModalRows">
                <td><a data-worker-crm="personPropertiesModalName" href="/CRMImmobiliareLightning/s/notizia/NT-1">NT - Abitazione - Locazione</a></td>
              </tr>
              <tr data-worker-crm="personPropertiesModalRows">
                <td><a data-worker-crm="personPropertiesModalName" href="/CRMImmobiliareLightning/s/immobile/I-WRONG">IM - Via Roma 12 - Abitazione</a></td>
              </tr>
              <tr data-worker-crm="personPropertiesModalRows">
                <td><a data-worker-crm="personPropertiesModalName" href="/CRMImmobiliareLightning/s/immobile/I-MATCH">IM - Via Roma 12 - Abitazione</a></td>
              </tr>
              <tr data-worker-crm="personPropertiesModalRows">
                <td><a data-worker-crm="personPropertiesModalName" href="/CRMImmobiliareLightning/s/incarico/IN-1">IN - Via Roma 12</a></td>
              </tr>
            </tbody></table>
            <button data-worker-crm="personPropertiesModalClose"
              onclick="document.querySelector('[data-worker-crm=personPropertiesModal]').hidden=true">
              Chiudi
            </button>
          </section>
        </main>`;
      const propertyHtml = (sheet: string, parcel: string, subaltern: string) => `
        <main>
          <div data-worker-crm="propertySheetValue">${sheet}</div>
          <div data-worker-crm="propertyParcelValue">${parcel}</div>
          <div data-worker-crm="propertySubalternValue">${subaltern}</div>
          <div data-worker-crm="propertyAddressValue">Via Roma 12, 70032 BITONTO (BA)</div>
        </main>`;
      await page.route("https://crm.test/**", async (route) => {
        const url = new URL(route.request().url());
        const propertyId = url.pathname.match(/\/s\/immobile\/([^/]+)/)?.[1];
        if (!propertyId) {
          await route.fulfill({ contentType: "text/html", body: accountHtml });
          return;
        }
        visitedProperties.push(propertyId);
        await route.fulfill({
          contentType: "text/html",
          body: propertyId === "I-MATCH"
            ? propertyHtml("50", "2455", "9")
            : propertyHtml("50", "2455", "10"),
        });
      });
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      const result = await adapter.findPropertyForPerson("P-42", {
        municipality: "BITONTO",
        sheet: "50",
        parcel: "2455",
        subaltern: "9",
        address: "Via Roma 12",
        censusZone: "U",
        category: "A/2",
        class: "3",
        consistency: "6 vani",
        cadastralIncome: null,
        rawPayload: {},
      });

      expect(result.match).toMatchObject({
        id: "I-MATCH",
        data: {
          matchedBy: "cadastral",
          identityVerified: true,
          sheet: "50",
          parcel: "2455",
          subaltern: "9",
        },
      });
      expect(visitedProperties).toEqual(["I-WRONG", "I-MATCH"]);
    } finally { await browser.close(); }
  });

  it("mantiene univoci i selettori CRM calibrati sulla struttura reale", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm-production-shell.html"), "utf8"));
      const expected = {
        propertySheetValue: "50",
        propertyParcelValue: "1391",
        propertySubalternValue: "27",
        propertyAddressValue: "Via Borgo San Francesco 29 [2], 70032 BITONTO (BA)",
      } as const;
      for (const [key, value] of Object.entries(expected)) {
        const locator = page.locator(crmSelectors[key as keyof typeof expected]);
        expect(await locator.count(), key).toBe(1);
        expect((await locator.textContent())?.trim(), key).toBe(value);
      }
      expect(await page.locator(crmSelectors.activityCard).count()).toBe(1);
      const dialog = page.locator(crmSelectors.activityDialog);
      expect(await dialog.count()).toBe(1);
      expect(await page.locator(crmSelectors.activityDescription).count()).toBe(1);
      expect(await page.locator(crmSelectors.activityClient).inputValue()).toBe("Benedetta Pappapicco");
      expect(await page.locator(crmSelectors.activityRelatedProperty).locator("input").inputValue()).toContain("Via Borgo San Francesco 29 [2]");
      expect(await page.locator(crmSelectors.activityStatus).inputValue()).toBe("Da eseguire");
      expect(await page.locator(crmSelectors.activityCancel).count()).toBe(1);
      expect(await page.locator(crmSelectors.propertyOwnersCard).count()).toBe(1);
      expect(await page.locator(crmSelectors.propertyOwnersCard).locator(crmSelectors.propertyOwnerLinks).count()).toBe(1);
    } finally { await browser.close(); }
  });

  it("prepara una sola attività dalla scheda immobile e la annulla in dry-run", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = await readFile(fixture("crm.html"), "utf8");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.createPropertyActivity({
        propertyId: "I-42",
        propertyAddress: "Via Roma 12 [2]",
        fallbackPersonId: "P-42",
        description: "Inserire attività",
        contactMode: "Telefonata",
        status: "Da eseguire",
      })).resolves.toMatchObject({ outcome: "simulated", crmActivityId: "dry-activity-I-42", attempts: 1 });
      expect(await page.locator('[data-worker-crm="activityDescription"]').inputValue()).toBe("Inserire attività");
      expect(await page.locator('[data-worker-crm="activityDialog"]').isVisible()).toBe(false);
      expect(await page.locator("body").getAttribute("data-activity-origin")).toContain("/s/immobile/I-42");
      expect(await page.locator("body").getAttribute("data-activity-cancelled")).toBe("true");
      expect(await page.locator("body").getAttribute("data-activity-saved")).toBeNull();
    } finally { await browser.close(); }
  });

  it("imposta Contatto diretto ed Eseguito per un immobile senza telefoni", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = await readFile(fixture("crm.html"), "utf8");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.createPropertyActivity({
        propertyId: "I-42",
        propertyAddress: "Via Roma 12 [2]",
        fallbackPersonId: "P-42",
        description: "Non sa nulla",
        contactMode: "Contatto diretto",
        status: "Eseguito",
      })).resolves.toMatchObject({ outcome: "simulated" });
      expect(await page.locator('[data-worker-crm="activityContactMode"]').inputValue()).toBe("Contatto diretto");
      expect(await page.locator('[data-worker-crm="activityStatus"]').inputValue()).toBe("Eseguito");
      expect(await page.locator('[data-worker-crm="activityDescription"]').inputValue()).toBe("Non sa nulla");
    } finally { await browser.close(); }
  });

  it("recupera Cliente e immobile correlato quando la modale attività li apre vuoti", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = (await readFile(fixture("crm.html"), "utf8"))
        .replace(
          '<input data-worker-crm="activityClient" value="Maria Acquaviva">',
          '<input data-worker-crm="activityClient" value=""><button data-worker-crm="activityOption" onclick="document.querySelector(\'[data-worker-crm=activityClient]\').value=\'Maria Acquaviva\'"><span data-item-id="P-42">P-42 Maria Acquaviva</span></button>',
        )
        .replace(
          '<div data-worker-crm="activityRelatedProperty"><input value="IM - Via Roma 12 [2]"></div>',
          '<div data-worker-crm="activityRelatedProperty"><input value=""></div><button data-worker-crm="activityOption" onclick="document.querySelector(\'[data-worker-crm=activityRelatedProperty] input\').value=\'IM - Via Roma 12 [2]\'">IM - Via Roma 12 [2]</button>',
        );
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.createPropertyActivity({
        propertyId: "I-42",
        propertyAddress: "Via Roma 12 [2]",
        fallbackPersonId: "P-42",
        description: "Inserire attività",
        contactMode: "Telefonata",
        status: "Da eseguire",
      })).resolves.toMatchObject({ outcome: "simulated", correlatedProperty: "IM - Via Roma 12 [2]" });
      expect(await page.locator('[data-worker-crm="activityClient"]').inputValue()).toBe("Maria Acquaviva");
      expect(await page.locator("body").getAttribute("data-activity-cancelled")).toBe("true");
    } finally { await browser.close(); }
  });

  it("accetta il prefill IM della scheda immobile verificata anche se il testo indirizzo è abbreviato", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = (await readFile(fixture("crm.html"), "utf8"))
        .replace("IM - Via Roma 12 [2]", "IM - Via T. Traetta 47");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.createPropertyActivity({
        propertyId: "I-42",
        propertyAddress: "VIA TOMMASO TRAETTA n. 47-49 Piano T-1",
        fallbackPersonId: "P-42",
        description: "Inserire attività",
        contactMode: "Telefonata",
        status: "Da eseguire",
      })).resolves.toMatchObject({ outcome: "simulated", correlatedProperty: "IM - Via T. Traetta 47" });
    } finally { await browser.close(); }
  });

  it("chiude, ricarica e ritenta da solo quando il primo caricamento dell'attività è incompleto", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = (await readFile(fixture("crm.html"), "utf8"))
        .replace('<input data-worker-crm="activityClient" value="Maria Acquaviva">', '<input data-worker-crm="activityClient" value="">')
        .replace(
          'onclick="document.body.dataset.activityOrigin=location.pathname;document.querySelector(\'[data-worker-crm=activityDialog]\').hidden=false"',
          'onclick="const attempt=Number(localStorage.getItem(\'activity-attempt\')||0)+1;localStorage.setItem(\'activity-attempt\',String(attempt));document.body.dataset.activityOrigin=location.pathname;document.querySelector(\'[data-worker-crm=activityClient]\').value=attempt>2?\'Maria Acquaviva\':\'\';document.querySelector(\'[data-worker-crm=activityDialog]\').hidden=false"',
        );
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.createPropertyActivity({
        propertyId: "I-42",
        propertyAddress: "Via Roma 12 [2]",
        // A non-default description proves that retry cleanup only discards
        // the worker-owned form; it must not classify it as a manual draft.
        description: "Non sa nulla",
        contactMode: "Telefonata",
        status: "Da eseguire",
      })).resolves.toMatchObject({ outcome: "simulated", attempts: 3 });
      expect(await page.evaluate(() => localStorage.getItem("activity-attempt"))).toBe("3");
    } finally { await browser.close(); }
  });

  it("annulla una vecchia finestra Soggetto correlato e continua con l'attività", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = await readFile(fixture("crm.html"), "utf8");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      await page.locator('[data-worker-crm="ownerDialog"]').evaluate((dialog) => { (dialog as HTMLElement).hidden = false; });
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.createPropertyActivity({
        propertyId: "I-42",
        propertyAddress: "Via Roma 12 [2]",
        fallbackPersonId: "P-42",
        description: "Inserire attività",
        contactMode: "Telefonata",
        status: "Da eseguire",
      })).resolves.toMatchObject({ outcome: "simulated" });
      expect(await page.locator('[data-worker-crm="ownerDialog"]').isVisible()).toBe(false);
    } finally { await browser.close(); }
  });

  it("chiude automaticamente una modale attività vuota rimasta aperta prima della ricerca", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      await page.locator('[data-worker-crm="activityDialog"]').evaluate((dialog) => { (dialog as HTMLElement).hidden = false; });
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      const result = await adapter.findPerson({ taxCode: "CQVMRS49L66A893R", phones: [], fullName: "Maria", birthDate: null });
      expect(result.matches[0]?.id).toBe("P-42");
      expect(await page.locator('[data-worker-crm="activityDialog"]').isVisible()).toBe(false);
      expect(await page.locator("body").getAttribute("data-activity-cancelled")).toBe("true");
    } finally { await browser.close(); }
  });

  it("chiude la richiesta di pianificare un'altra attività e prosegue", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      await page.locator('[data-worker-crm="activityFollowUpDialog"]').evaluate((dialog) => { (dialog as HTMLElement).hidden = false; });
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      const result = await adapter.findPerson({ taxCode: "CQVMRS49L66A893R", phones: [], fullName: "Maria", birthDate: null });
      expect(result.matches[0]?.id).toBe("P-42");
      expect(await page.locator('[data-worker-crm="activityFollowUpDialog"]').isVisible()).toBe(false);
      expect(await page.locator("body").getAttribute("data-activity-follow-up-closed")).toBe("cancel");
    } finally { await browser.close(); }
  });

  it("non scarta automaticamente una modale attività compilata manualmente", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      await page.locator('[data-worker-crm="activityDialog"]').evaluate((dialog) => { (dialog as HTMLElement).hidden = false; });
      await page.locator('[data-worker-crm="activityDescription"]').fill("Nota inserita manualmente");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.findPerson({ taxCode: "CQVMRS49L66A893R", phones: [], fullName: "Maria", birthDate: null }))
        .rejects.toThrow("attività compilata manualmente");
      expect(await page.locator('[data-worker-crm="activityDialog"]').isVisible()).toBe(true);
    } finally { await browser.close(); }
  });

  it("conferma il merge soltanto quando la fixture Cloud non segnala problemi", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      const created = await adapter.createPerson({
        fullName: "ACQUAVIVA MARIA ROSARIA", birthPlace: "Bitonto", birthProvince: "BA", birthDate: "1949-07-26",
        taxCode: "CQVMRS49L66A893R", rightType: "Proprietà", shareOriginal: "1/1", shareNumerator: 1,
        shareDenominator: 1, sharePercentage: 100, mobiles: [], landlines: [], emails: [], whatsapp: [], rawPayload: {},
      }, ["P-1", "P-2"]);
      expect(created.mergeStatus).toBe("ready");
      await expect(adapter.confirmPersonMerge()).resolves.toMatchObject({ status: "completed", personId: "P-99" });
    } finally { await browser.close(); }
  });

  it("considera riuscita la creazione appena il CRM espone l'id, anche se la card immobili sta ancora caricando", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      await page.locator('[data-worker-crm="personPropertiesCard"]').evaluate((card) => {
        (card as HTMLElement).hidden = true;
      });
      await page.locator('[data-worker-crm="personSave"]').evaluate((button) => button.removeAttribute("onclick"));
      await page.locator('[data-worker-crm="personMergeDialog"]').evaluate((dialog) => dialog.remove());
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await expect(adapter.createPerson({
        fullName: "ACQUAVIVA MARIA ROSARIA", birthPlace: "Bitonto", birthProvince: "BA", birthDate: "1949-07-26",
        taxCode: "CQVMRS49L66A893R", rightType: "ProprietÃ ", shareOriginal: "1/1", shareNumerator: 1,
        shareDenominator: 1, sharePercentage: 100, mobiles: [], landlines: [], emails: [], whatsapp: [], rawPayload: {},
      })).resolves.toMatchObject({
        personId: "P-99",
        mergeStatus: "not_required",
        details: { workspaceReady: false },
      });
    } finally { await browser.close(); }
  });

  it("riconosce la striscia verde reale e preme l'unico Salva della finestra merge", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://example.test/**", (route) => route.fulfill({ body: "<!doctype html><body></body>" }));
      await page.goto("https://example.test/CRMImmobiliareLightning/s/account/P-99");
      await page.setContent(`<!doctype html><body>
        <section role="dialog">
          <h2>Riconcilia</h2>
          <div>ATTENZIONE — informativa GDPR necessaria</div>
          <div>
            <strong>Merge dei campi</strong>
            <p>Tutti i campi sono stati riconciliati. Si può procedere al salvataggio</p>
          </div>
          <button>Annulla</button>
          <button>Indietro</button>
          <button onclick="document.body.dataset.mergeSaved='true'; this.closest('[role=dialog]').hidden=true">Salva</button>
        </section>
      </body>`);
      const adapter = new PlaywrightCrmAdapter(page, false, crmSelectors);
      await expect(adapter.inspectPersonMerge()).resolves.toMatchObject({ status: "ready" });
      await expect(adapter.confirmPersonMerge()).resolves.toMatchObject({ status: "completed", personId: "P-99" });
      expect(await page.locator("body").getAttribute("data-merge-saved")).toBe("true");
      expect(await page.locator('[role="dialog"]').isVisible()).toBe(false);
    } finally { await browser.close(); }
  });

  it("non preme Salva se la conferma verde del merge non è presente", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body>
        <section role="dialog">
          <h2>Nominativo</h2>
          <div><strong>Merge dei campi</strong><p>Verifica dei campi ancora in corso</p></div>
          <button onclick="document.body.dataset.mergeSaved='true'">Salva</button>
        </section>
      </body>`);
      const adapter = new PlaywrightCrmAdapter(page, false, crmSelectors);
      await expect(adapter.inspectPersonMerge()).resolves.toMatchObject({ status: "pending" });
      await expect(adapter.confirmPersonMerge()).resolves.toMatchObject({ status: "pending" });
      expect(await page.locator("body").getAttribute("data-merge-saved")).toBeNull();
    } finally { await browser.close(); }
  });

  it("riconcilia tutti i valori dell'importer nella colonna sinistra prima di salvare", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.route("https://example.test/**", (route) => route.fulfill({ body: "<!doctype html><body></body>" }));
      await page.goto("https://example.test/CRMImmobiliareLightning/s/account/P-99");
      await page.setContent(`<!doctype html><body>
        <section role="dialog" style="position:relative;width:1000px;height:620px">
          <h2>Riconcilia</h2><div><strong>Merge dei campi</strong><p id="merge-message">Seleziona i valori da mantenere</p></div>
          <button class="importer" style="position:absolute;left:410px;top:180px;width:230px;height:34px" onclick="this.dataset.selected='true';if(document.querySelectorAll('.importer[data-selected=true]').length===3)document.querySelector('#merge-message').textContent='Tutti i campi sono stati riconciliati. Si può procedere al salvataggio'">Anna</button>
          <button class="importer" style="position:absolute;left:410px;top:230px;width:230px;height:34px" onclick="this.dataset.selected='true';if(document.querySelectorAll('.importer[data-selected=true]').length===3)document.querySelector('#merge-message').textContent='Tutti i campi sono stati riconciliati. Si può procedere al salvataggio'">Dellapigna</button>
          <button class="importer" style="position:absolute;left:410px;top:280px;width:230px;height:34px" onclick="this.dataset.selected='true';if(document.querySelectorAll('.importer[data-selected=true]').length===3)document.querySelector('#merge-message').textContent='Tutti i campi sono stati riconciliati. Si può procedere al salvataggio'">DLLNNA57A46A893A</button>
          <button style="position:absolute;left:660px;top:180px;width:230px;height:34px">Anna esistente</button>
          <button style="position:absolute;left:660px;top:230px;width:230px;height:34px">Della Pigna</button>
          <button style="position:absolute;left:660px;top:280px;width:230px;height:34px">CF esistente</button>
          <button style="position:absolute;right:170px;bottom:20px">Annulla</button><button style="position:absolute;right:20px;bottom:20px" onclick="document.body.dataset.mergeSaved='true';this.closest('[role=dialog]').hidden=true">Salva</button>
        </section>
      </body>`);
      const adapter = new PlaywrightCrmAdapter(page, false, crmSelectors);
      await expect(adapter.confirmPersonMerge()).resolves.toMatchObject({ status: "completed", personId: "P-99" });
      expect(await page.locator(".importer[data-selected=true]").count()).toBe(3);
      expect(await page.locator("body").getAttribute("data-merge-saved")).toBe("true");
    } finally { await browser.close(); }
  });

  it("chiude con Annulla una riconciliazione non confermabile prima di cambiare caso", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body>
        <section role="dialog">
          <h2>Riconcilia</h2>
          <div><strong>Merge dei campi</strong><p>Non si può procedere al salvataggio</p></div>
          <button onclick="document.body.dataset.mergeCancelled='true'; this.closest('[role=dialog]').hidden=true">Annulla</button>
          <button>Salva</button>
        </section>
      </body>`);
      const adapter = new PlaywrightCrmAdapter(page, false, crmSelectors);

      await expect(adapter.inspectPersonMerge()).resolves.toMatchObject({ status: "blocked" });
      await expect(adapter.dismissPersonMerge()).resolves.toEqual({ dismissed: true, method: "cancel" });
      expect(await page.locator("body").getAttribute("data-merge-cancelled")).toBe("true");
      expect(await page.locator('[role="dialog"]').isVisible()).toBe(false);
    } finally { await browser.close(); }
  });

  it("dopo uno skip chiude il caso e torna sempre alla home del gestionale", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://crm.test/**", (route) => {
        const isHome = new URL(route.request().url()).pathname === "/CRMImmobiliareLightning/s";
        return route.fulfill({
          contentType: "text/html",
          body: isHome
            ? '<!doctype html><body><main data-worker-crm="pageMarker">Home CRM</main></body>'
            : `<!doctype html><body>
                <section role="dialog" data-worker-crm="personMergeDialog">
                  <h2>Riconcilia</h2><div>Merge dei campi</div>
                  <p data-worker-crm="personMergeMessage">Non si può procedere al salvataggio</p>
                  <span data-worker-crm="personMergeBlocked">Conflitto</span>
                  <button data-worker-crm="personMergeCancel" onclick="this.closest('[role=dialog]').hidden=true">Annulla</button>
                </section>
              </body>`,
        });
      });
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-BLOCKED");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);

      await expect(adapter.resetToCrmHome()).resolves.toMatchObject({
        homeUrl: "https://crm.test/CRMImmobiliareLightning/s",
        mergeDismissed: true,
        mergeDismissMethod: "cancel",
      });
      expect(new URL(page.url()).pathname).toBe("/CRMImmobiliareLightning/s");
    } finally { await browser.close(); }
  });

  it("prima di una nuova azione salva sempre una Riconcilia verde rimasta aperta", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://crm.test/**", (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <article data-worker-crm="personPropertiesCard">Immobili/Notizie/Incarichi (0)</article>
          <div class="flex"><div><label>Cellulare</label></div><div><span class="slds-form-element__static"><span class="slds-grow">3331234567</span></span></div></div>
          <section role="dialog" data-worker-crm="personMergeDialog">
            <h2>Riconcilia</h2>
            <div>Merge dei campi</div>
            <p data-worker-crm="personMergeMessage">Tutti i campi sono stati riconciliati. Si può procedere al salvataggio</p>
            <button data-worker-crm="personMergeCancel">Annulla</button>
            <button data-worker-crm="personMergeConfirm" onclick="document.body.dataset.mergeSaved='true'; this.closest('[role=dialog]').hidden=true">Salva</button>
          </section>
        </body></html>`,
      }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-99");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);

      await expect(adapter.inspectPersonMerge()).resolves.toMatchObject({ status: "ready" });
      await expect(adapter.findMissingPersonPhones("P-99", ["3331234567"]))
        .resolves.toEqual([]);
      expect(await page.locator("body").getAttribute("data-merge-saved")).toBe("true");
      expect(await page.locator('[data-worker-crm="personMergeDialog"]').isVisible()).toBe(false);
    } finally { await browser.close(); }
  });

  it("esclude completamente gli intestatari aziendali senza confonderli con i privati", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body data-worker-page="sister-results">
        <span data-worker-field="municipality">BITONTO</span><span data-worker-field="street">VIA ROMA</span><span data-worker-field="civic-number">12</span>
        <table><tr data-worker-row="property">
          <td data-worker-field="sheet">58</td><td data-worker-field="parcel">2000</td><td data-worker-field="subaltern">8</td>
          <td data-worker-field="address">Via Roma 12</td><td data-worker-field="census-zone">U</td><td data-worker-field="category">A/3</td>
          <td data-worker-field="class">4</td><td data-worker-field="consistency">5 vani</td><td data-worker-field="cadastral-income">432,10</td>
          <td><pre data-worker-owner>EDILE &amp; IMMOBILIARE COCE S.R.L.\n07504350724\nProprietÃ \n1/1</pre></td>
        </tr></table></body>`);
      const adapter = new PlaywrightSisterAdapter(page, sisterFixtureSelectors);
      const [property] = await adapter.extractProperties();
      expect(await adapter.extractOwners(property!)).toEqual([]);
      expect(adapter.hasIgnoredBusinessOnRow(0)).toBe(true);
      expect(adapter.getIgnoredBusinesses()[0]).toMatchObject({ taxCode: "075******24", reason: "business-tax-code" });
    } finally { await browser.close(); }
  });

  it("collega un comproprietario scegliendo la scheda esatta, il diritto, il ruolo e la quota", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = await readFile(fixture("crm.html"), "utf8");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/I-42");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await expect(adapter.linkOwner("I-42", {
        personId: "P-99",
        searchLabel: "Mario Rossi",
        phones: ["3331234567"],
      }, 100 / 3)).resolves.toMatchObject({ linkId: "owner-link-P-99", selection: "crm_id", note: null });
      expect(await page.locator('[data-worker-crm="ownerPersonId"]').inputValue()).toBe("Mario Rossi");
      expect(await page.locator('[data-worker-crm="ownerRight"]').inputValue()).toBe("Proprietà");
      expect(await page.locator('[data-worker-crm="ownerRole"] input').inputValue()).toBe("Comproprietario");
      expect(await page.locator('[data-worker-crm="ownerShare"]').inputValue()).toBe("33,33");
      expect(await page.locator("body").getAttribute("data-owner-saved")).toBe("true");
    } finally { await browser.close(); }
  }, 12_000);

  it("riconosce una scheda nominativo già aperta dal codice fiscale e dal nome", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = await readFile(fixture("crm.html"), "utf8");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html.replace("</body>", "<p>Michele Murgolo</p><p>MRGMHL65B09A893K</p></body>") }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.openExistingPerson({ taxCode: "MRGMHL65B09A893K", phones: [], fullName: "MICHELE MURGOLO", birthDate: null }, "P-42"))
        .resolves.toMatchObject({ id: "P-42", data: { taxCodeVerified: true, nameVerified: true } });
    } finally { await browser.close(); }
  });

  it("dopo Accesso negato torna alla home e ritrova il nominativo risultante dal merge", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const searchPage = `<!doctype html><html><body>
        <main data-worker-crm="pageMarker">
          <button data-worker-crm="personSearchPage">Clienti</button>
          <input data-worker-crm="personSearchTaxCode">
          <input data-worker-crm="personSearchPhone">
          <button data-worker-crm="personSearchSubmit">Cerca</button>
          <h1 data-worker-crm="personResultsReady">Risultati di ricerca</h1>
          <div data-worker-crm="personResultRows">
            <span data-worker-crm="personResultId">P-MERGED</span>
            <span data-worker-crm="personResultLabel">Mario Rossi</span>
            <button data-worker-crm="personResultOpen">Apri</button>
          </div>
          <span data-worker-crm="recordId">P-MERGED</span>
          <article data-worker-crm="personPropertiesCard">Immobili/Notizie/Incarichi (0)</article>
          <div>Mario Rossi RSSMRA80A01A893X</div>
        </main>
      </body></html>`;
      await page.route("https://crm.test/**", (route) => {
        const oldRecord = route.request().url().includes("/account/P-DELETED");
        return route.fulfill({
          contentType: "text/html",
          body: oldRecord
            ? `<!doctype html><body><div data-worker-crm="accessDeniedMarker">Accesso negato — La pagina a cui stai cercando di accedere non esiste oppure non hai i diritti per visualizzarla</div></body>`
            : searchPage,
        });
      });
      await page.goto("https://crm.test/CRMImmobiliareLightning/s");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);

      await expect(adapter.openExistingPerson({
        taxCode: "RSSMRA80A01A893X",
        phones: ["3331234567"],
        fullName: "Mario Rossi",
        birthDate: "1980-01-01",
      }, "P-DELETED")).resolves.toMatchObject({
        id: "P-MERGED",
        data: {
          source: "crm-merged-person-recovery",
          inaccessiblePersonId: "P-DELETED",
          recoveredFromAccessDenied: true,
        },
      });
    } finally { await browser.close(); }
  });

  it("non crea duplicati se la card dichiara immobili ma non espone i collegamenti", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = (await readFile(fixture("crm.html"), "utf8"))
        .replace('<article data-worker-crm="personPropertiesCard">', '<article data-worker-crm="personPropertiesCard">Immobili/Notizie/Incarichi (1)')
        .replace(/<a[^>]+data-worker-crm="personPropertyLinks"[\s\S]*?<\/a>/g, "");
      await page.route("https://crm.test/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-42");
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      await expect(adapter.findPropertyForPerson("P-42", {
        municipality: "BITONTO", sheet: "50", parcel: "2455", subaltern: "9", address: "Via Borgo San Francesco 62",
        censusZone: "U", category: "A/2", class: "3", consistency: "6 vani", cadastralIncome: null, rawPayload: {},
      })).rejects.toThrow("non ne espone l'elenco");
    } finally { await browser.close(); }
  });

  it("distingue Nuovo da Relaziona immobile esistente nella card del nominativo", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm-person-properties-menu.html"), "utf8"));
      const card = page.locator(crmSelectors.personPropertiesCard);
      expect(await card.count()).toBe(1);
      expect(await card.locator(crmSelectors.propertyCreate).count()).toBe(1);
      expect(await card.locator(crmSelectors.propertyCreateMenuItem).count()).toBe(1);
      expect((await card.locator(crmSelectors.propertyCreateMenuItem).textContent())?.trim()).toBe("Nuovo");
    } finally { await browser.close(); }
  });

  it("crea l'immobile dal menu Immobili/Notizie/Incarichi del nominativo", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await expect(adapter.createProperty({
        municipality: "BITONTO", sheet: "50", parcel: "2278", subaltern: "20",
        address: "Via Borgo San Francesco 62", censusZone: null, category: "C/2",
        class: "4", consistency: "3 mq", cadastralIncome: null, rawPayload: {},
      })).resolves.toBe("P-99");
      expect(await page.locator("body").getAttribute("data-property-creation-origin")).toBe("person-card");
      expect(await page.locator("body").getAttribute("data-property-wizard-advanced")).toBe("1");
      expect(await page.locator("body").getAttribute("data-property-type")).toBe("Box / posti auto");
      expect(await page.locator("body").getAttribute("data-property-subtype")).toBe("Box");
      expect(await page.locator("body").getAttribute("data-property-locality")).toBe("BITONTO");
      expect(await page.locator(crmFixtureSelectors.propertyAddress).inputValue()).toBe("Via Borgo San Francesco");
      expect(await page.locator(crmFixtureSelectors.propertyCivic).inputValue()).toBe("62");
      expect(await page.locator(crmFixtureSelectors.propertyInternal).inputValue()).toBe(".");
      expect(await page.locator(crmFixtureSelectors.propertyMunicipality).locator("input").inputValue()).toBe("BITONTO");
      expect(await page.locator(crmFixtureSelectors.propertyCadastralSectionUrban).locator("input").inputValue()).toBe("BA");
      expect(await page.locator(crmFixtureSelectors.propertyCadastralSheet).locator("input").inputValue()).toBe("50");
      expect(await page.locator(crmFixtureSelectors.propertyCadastralParcel).locator("input").inputValue()).toBe("2278");
      expect(await page.locator(crmFixtureSelectors.propertyCadastralSubaltern).locator("input").inputValue()).toBe("20");
      expect(await page.locator(crmFixtureSelectors.propertyCadastralGroup).locator("xpath=..").locator('input[role="textbox"]').inputValue()).toBe("Gruppo C");
      expect(await page.locator(crmFixtureSelectors.propertyCadastralType).locator("xpath=..").locator('input[role="textbox"]').inputValue()).toContain("C02");
    } finally { await browser.close(); }
  });

  it("prepara lo spostamento di un recapito assegnato al nominativo sbagliato", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      const result = await adapter.transferPhoneAssignments("PERSONA-NOUVA", {
        fullName: "Mario Rossi", birthPlace: "BITONTO", birthProvince: "BA", birthDate: "1980-01-01",
        taxCode: "RSSMRA80A01A893X", rightType: "ProprietÃ ", shareOriginal: "1/1",
        shareNumerator: 1, shareDenominator: 1, sharePercentage: 100,
        mobiles: ["333 1234567"], landlines: [], emails: [], whatsapp: [], rawPayload: {},
      }, [{ phone: "3331234567", personId: "PERSONA-VECCHIA", label: "Altro nominativo" }]);
      expect(result).toEqual({
        moved: [{ phone: "3331234567", fromPersonId: "PERSONA-VECCHIA", toPersonId: "PERSONA-NOUVA" }],
        alreadyAssigned: [],
        simulated: true,
      });
    } finally { await browser.close(); }
  });

  it("verifica i campi del nominativo senza duplicare recapiti già presenti", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://crm.test/**", (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <article data-worker-crm="personPropertiesCard">Immobili/Notizie/Incarichi (0)</article>
          <div class="flex"><div><label>Cellulare</label></div><div><span class="slds-form-element__static"><span class="slds-grow">3331234567</span></span></div></div>
          <div class="flex"><div><label>Telefono fisso</label></div><div><span class="slds-form-element__static"><span class="slds-grow">0801234567</span></span></div></div>
          <div class="flex"><div><label>Telefono Ufficio</label></div><div><span class="slds-form-element__static"><span class="slds-grow"></span></span></div></div>
          <div class="flex"><div><label>Altro telefono</label></div><div><span class="slds-form-element__static"><span class="slds-grow"></span></span></div></div>
          <div class="flex"><div><label>Email</label></div><div><span class="slds-form-element__static"><span class="slds-grow"></span></span></div></div>
          <div class="flex"><div><label>Email Secondaria</label></div><div><span class="slds-form-element__static"><span class="slds-grow"></span></span></div></div>
        </body></html>`,
      }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-99");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await expect(adapter.findMissingPersonPhones("P-99", [
        "3331234567",
        "0801234567",
        "3490000000",
      ])).resolves.toEqual(["3490000000"]);
      await expect(adapter.transferPhoneAssignments("P-99", {
        fullName: "Mario Rossi", birthPlace: "BITONTO", birthProvince: "BA", birthDate: "1980-01-01",
        taxCode: "RSSMRA80A01A893X", rightType: "ProprietÃ ", shareOriginal: "1/1",
        shareNumerator: 1, shareDenominator: 1, sharePercentage: 100,
        mobiles: ["3331234567"], landlines: ["0801234567"], emails: [], whatsapp: [], rawPayload: {},
      }, [
        { phone: "3331234567", personId: "P-99", label: "Mario Rossi" },
        { phone: "0801234567", personId: "P-99", label: "Mario Rossi" },
      ])).resolves.toEqual({
        moved: [],
        alreadyAssigned: ["3331234567", "0801234567"],
        simulated: false,
      });
    } finally { await browser.close(); }
  });

  it("inserisce una sola volta un numero presente sia tra cellulari sia tra fissi", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const contactRow = (label: string, id: string) => `
        <div class="flex"><div><label for="${id}">${label}</label></div>
          <div><span class="slds-form-element__static"><span class="slds-grow"></span></span><input id="${id}"></div>
          ${label === "Cellulare" ? '<button class="inline-edit-trigger">Modifica</button>' : ""}
        </div>`;
      await page.route("https://crm.test/**", (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <article data-worker-crm="personPropertiesCard">Immobili/Notizie/Incarichi (0)</article>
          ${contactRow("Cellulare", "mobile")}
          ${contactRow("Telefono fisso", "landline")}
          ${contactRow("Telefono Ufficio", "office")}
          ${contactRow("Altro telefono", "other")}
          ${contactRow("Email", "email")}
          ${contactRow("Email Secondaria", "email2")}
          <button role="button">Salva</button>
        </body></html>`,
      }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-99");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await adapter.transferPhoneAssignments("P-99", {
        fullName: "Mario Rossi", birthPlace: "BITONTO", birthProvince: "BA", birthDate: "1980-01-01",
        taxCode: "RSSMRA80A01A893X", rightType: "Proprietà", shareOriginal: "1/1",
        shareNumerator: 1, shareDenominator: 1, sharePercentage: 100,
        mobiles: ["3331234567"], landlines: ["3331234567"], emails: [], whatsapp: [], rawPayload: {},
      }, []);
      expect(await page.locator("#mobile").inputValue()).toBe("3331234567");
      expect(await page.locator("#landline").inputValue()).toBe("");
      expect(await page.locator("#office").inputValue()).toBe("");
      expect(await page.locator("#other").inputValue()).toBe("");
    } finally { await browser.close(); }
  });

  it("salva davvero la riconciliazione verde comparsa dopo l'aggiornamento dei recapiti", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const contactRow = (label: string, id: string) => `
        <div class="flex"><div><label for="${id}">${label}</label></div>
          <div><span class="slds-form-element__static"><span class="slds-grow"></span></span><input id="${id}"></div>
          ${label === "Cellulare" ? '<button class="inline-edit-trigger">Modifica</button>' : ""}
        </div>`;
      await page.route("https://crm.test/**", (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <article data-worker-crm="personPropertiesCard">Immobili/Notizie/Incarichi (0)</article>
          ${contactRow("Cellulare", "mobile")}
          ${contactRow("Telefono fisso", "landline")}
          ${contactRow("Telefono Ufficio", "office")}
          ${contactRow("Altro telefono", "other")}
          ${contactRow("Email", "email")}
          ${contactRow("Email Secondaria", "email2")}
          <button role="button" onclick="document.querySelector('[data-worker-crm=personMergeDialog]').hidden=false">Salva</button>
          <section role="dialog" data-worker-crm="personMergeDialog" hidden>
            <h2>Riconcilia</h2>
            <p data-worker-crm="personMergeMessage">Tutti i campi sono stati riconciliati. Si può procedere al salvataggio</p>
            <span data-worker-crm="personMergeReady">Merge dei campi</span>
            <button data-worker-crm="personMergeCancel">Annulla</button>
            <button data-worker-crm="personMergeConfirm" onclick="document.body.dataset.mergeSaved='true'; this.closest('[role=dialog]').hidden=true">Salva</button>
          </section>
        </body></html>`,
      }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/account/P-99");
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);

      await adapter.transferPhoneAssignments("P-99", {
        fullName: "Mario Rossi", birthPlace: "BITONTO", birthProvince: "BA", birthDate: "1980-01-01",
        taxCode: "RSSMRA80A01A893X", rightType: "Proprietà", shareOriginal: "1/1",
        shareNumerator: 1, shareDenominator: 1, sharePercentage: 100,
        mobiles: ["3331234567"], landlines: [], emails: [], whatsapp: [], rawPayload: {},
      }, []);

      expect(await page.locator("body").getAttribute("data-merge-saved")).toBe("true");
      expect(await page.locator('[data-worker-crm="personMergeDialog"]').isVisible()).toBe(false);
    } finally { await browser.close(); }
  });

  it("segnala un recapito ambiguo senza fermare l'intero import", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const adapter = new PlaywrightCrmAdapter(page, true, crmFixtureSelectors);
      const result = await adapter.transferPhoneAssignments("PERSONA-NUOVA", {
        fullName: "Mario Rossi", birthPlace: "BITONTO", birthProvince: "BA", birthDate: "1980-01-01",
        taxCode: "RSSMRA80A01A893X", rightType: "Proprietà", shareOriginal: "1/1",
        shareNumerator: 1, shareDenominator: 1, sharePercentage: 100,
        mobiles: ["3331234567"], landlines: [], emails: [], whatsapp: [], rawPayload: {},
      }, [
        { phone: "3331234567", personId: "P-1", label: "Primo nominativo" },
        { phone: "3331234567", personId: "P-2", label: "Secondo nominativo" },
      ]);
      expect(result.moved).toEqual([]);
      expect(result.unresolved).toEqual([{
        phone: "3331234567",
        personIds: ["P-1", "P-2"],
        reason: "multiple_assignments",
      }]);
    } finally { await browser.close(); }
  });

  it("sceglie la proposta Google prima della località e del salvataggio", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const html = (await readFile(fixture("crm.html"), "utf8")).replace(
        '<div><span>Via Borgo San Francesco</span><span data-worker-crm="propertyGoogleSameValue">Stesso valore</span></div>',
        '<div><span>Via Borgo San Francesco</span><button id="google-address-suggestion" onclick="document.body.dataset.googleAddressSelected=this.textContent.trim()">Via Borgo S. Francesco</button></div>',
      );
      await page.setContent(html);
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await expect(adapter.createProperty({
        municipality: "BITONTO", sheet: "50", parcel: "2278", subaltern: "20",
        address: "Via Borgo San Francesco 62", censusZone: null, category: "C/2",
        class: "4", consistency: "3 mq", cadastralIncome: null, rawPayload: {},
      })).resolves.toBe("P-99");
      expect(await page.locator("body").getAttribute("data-google-address-selected")).toBe("Via Borgo S. Francesco");
      expect(await page.locator("body").getAttribute("data-property-locality")).toBe("BITONTO");
    } finally { await browser.close(); }
  });

  it("compila l'anagrafica completa con nomi leggibili e recapiti già disponibili", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      await adapter.createPerson({
        fullName: "ACQUAVIVA MARIA ROSARIA", birthPlace: "BITONTO", birthProvince: "BA", birthDate: "1949-07-26",
        taxCode: "CQVMRS49L66A893R", rightType: "Proprietà", shareOriginal: "1/1", shareNumerator: 1,
        shareDenominator: 1, sharePercentage: 100, mobiles: ["3331112222", "3334445555"],
        landlines: ["0801234567"], emails: ["maria@example.it"], whatsapp: [], rawPayload: {},
      });
      expect(await page.locator(crmFixtureSelectors.personFirstName).inputValue()).toBe("Maria Rosaria");
      expect(await page.locator(crmFixtureSelectors.personLastName).inputValue()).toBe("Acquaviva");
      expect(await page.locator(crmFixtureSelectors.personGender).inputValue()).toBe("F");
      expect(await page.locator(crmFixtureSelectors.personBirthPlace).inputValue()).toBe("BITONTO");
      expect(await page.locator(crmFixtureSelectors.personBirthPlace).getAttribute("readonly")).not.toBeNull();
      expect(await page.locator("body").getAttribute("data-selected-birth-place")).toBe("BITONTO - BA");
      expect(await page.locator(crmFixtureSelectors.personBirthDate).inputValue()).toBe("26/07/1949");
      expect(await page.locator(crmFixtureSelectors.personTaxCode).inputValue()).toBe("CQVMRS49L66A893R");
      expect(await page.locator(crmFixtureSelectors.personMobile).inputValue()).toBe("3331112222");
      expect(await page.locator(crmFixtureSelectors.personOfficePhone).inputValue()).toBe("0801234567");
      expect(await page.locator(crmFixtureSelectors.personOtherPhone).inputValue()).toBe("3334445555");
      expect(await page.locator(crmFixtureSelectors.personEmail).inputValue()).toBe("maria@example.it");
    } finally { await browser.close(); }
  });

  it("non conferma un merge quando la fixture Cloud segnala un conflitto", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm.html"), "utf8"));
      await page.locator('[data-worker-crm="personMergeReady"]').evaluate((element) => element.remove());
      await page.locator('[data-worker-crm="personMergeDialog"]').evaluate((dialog) => {
        const blocked = document.createElement("span");
        blocked.setAttribute("data-worker-crm", "personMergeBlocked");
        blocked.textContent = "Conflitto Cloud";
        dialog.append(blocked);
      });
      const adapter = new PlaywrightCrmAdapter(page, false, crmFixtureSelectors);
      const created = await adapter.createPerson({
        fullName: "ACQUAVIVA MARIA ROSARIA", birthPlace: "Bitonto", birthProvince: "BA", birthDate: "1949-07-26",
        taxCode: "CQVMRS49L66A893R", rightType: "Proprietà", shareOriginal: "1/1", shareNumerator: 1,
        shareDenominator: 1, sharePercentage: 100, mobiles: [], landlines: [], emails: [], whatsapp: [], rawPayload: {},
      }, ["P-1", "P-2"]);
      expect(created.mergeStatus).toBe("blocked");
      await expect(adapter.confirmPersonMerge()).resolves.toMatchObject({ status: "blocked", personId: null });
      expect(await page.locator('[data-worker-crm="personMergeDialog"]').isVisible()).toBe(true);
    } finally { await browser.close(); }
  });
});
