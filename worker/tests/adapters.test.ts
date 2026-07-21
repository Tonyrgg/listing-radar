import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { PlaywrightCrmAdapter } from "../src/adapters/crm/index.js";
import { crmFixtureSelectors, crmSelectors } from "../src/adapters/crm/selectors.js";
import { PlaywrightSisterAdapter } from "../src/adapters/sister/index.js";
import { sisterFixtureSelectors } from "../src/adapters/sister/selectors.js";

const fixture = (name: string) => fileURLToPath(new URL(`../src/fixtures/${name}`, import.meta.url));

describe("adattatori con fixture HTML", () => {
  it("estrae soltanto immobili A/C e proprietari", async () => {
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
      expect(owners).toHaveLength(1);
      expect(owners[0]?.taxCode).toBe("CQVMRS49L66A893R");
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
      const addressMatch = (await adapter.findPropertyForPerson("P-42", { ...property, sheet: "99", parcel: "9999", subaltern: "99" })).match;
      expect(addressMatch?.data.matchedBy).toBe("street-and-civic");
      expect(addressMatch?.data).toMatchObject({ address: "Via Roma 12", internal: "2" });
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
        status: "Da eseguire",
      })).resolves.toMatchObject({ outcome: "simulated", crmActivityId: "dry-activity-I-42", attempts: 1 });
      expect(await page.locator('[data-worker-crm="activityDescription"]').inputValue()).toBe("Inserire attività");
      expect(await page.locator('[data-worker-crm="activityDialog"]').isVisible()).toBe(false);
      expect(await page.locator("body").getAttribute("data-activity-origin")).toContain("/s/immobile/I-42");
      expect(await page.locator("body").getAttribute("data-activity-cancelled")).toBe("true");
      expect(await page.locator("body").getAttribute("data-activity-saved")).toBeNull();
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
