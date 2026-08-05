import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { collectCrmMandateArchive, extractCrmMandateDetail, normalizeCrmMandate, resolveCrmPropertyCondition } from "../src/adapters/crm/mandates.js";
import { mandateItemsStillToProcess } from "../src/services/mandate-archive-importer.js";

const fixture = (name: string) => path.resolve("src", "fixtures", name);

describe("archivio incarichi CRM", () => {
  it("in ripresa salta gli immobili già completati", () => {
    const items = mandateItemsStillToProcess([
      { id: "1", status: "completed" }, { id: "2", status: "failed" },
      { id: "3", status: "running" }, { id: "4", status: "pending" },
    ]);
    expect(items.map((item) => item.id)).toEqual(["2", "3", "4"]);
  });

  it("pagina l'archivio e conserva tutte le colonne della lista", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm-mandate-archive.html"), "utf8"));
      const items = await collectCrmMandateArchive(page);
      expect(items.map((item) => item.externalId)).toEqual(["MAN-1", "MAN-2"]);
      expect(items[0]?.listFields).toMatchObject({ "Immobile: Proprietario": "Mario Rossi", "Prezzo Incarico": "€ 120.000" });
    } finally { await browser.close(); }
  });

  it("estrae dettaglio, storico, immagini e allegati e normalizza l'immobile", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://crm.test/**", async route => route.fulfill({ contentType: "text/html", body: await readFile(fixture("crm-mandate-detail.html"), "utf8") }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/immobile/PROP-1/primo");
      const detail = await extractCrmMandateDetail(page, {
        externalId: "MAN-1", title: "IN - Primo - Vendita",
        url: "https://crm.test/CRMImmobiliareLightning/s/incarico/MAN-1/primo",
        listFields: { "Immobile: Comune": "Bitonto" },
      });
      expect(detail).toMatchObject({ mandateExternalId: "MAN-1", propertyExternalId: "PROP-1", status: "Aperto" });
      expect(detail.fieldEntries.find((entry) => entry.label === "Proprietario")?.links[0]?.externalId).toBe("OWNER-1");
      expect(detail.evolutionText).toContain("Incarico acquisito");
      expect(detail.images[0]?.src).toContain("property.jpg");
      expect(detail.attachments[0]?.url).toContain("planimetria.pdf");
      expect(normalizeCrmMandate(detail)).toMatchObject({
        external_crm_id: "PROP-1", external_mandate_id: "MAN-1", contract_type: "sale",
        property_type: "apartment", price: 120000, commercial_sqm: 95, rooms: 3,
        floor: 2, availability_status: "available_now", mandate_status: "active", condition: "normal",
        description: "Soggiorno luminoso con balcone angolare.",
      });
    } finally { await browser.close(); }
  });

  it("riduce gli stati CRM ai cinque esiti operativi senza perdere gli originali nel payload", () => {
    expect(resolveCrmPropertyCondition("Nuovo", "Usato")).toBe("new");
    expect(resolveCrmPropertyCondition("Ristrutturato", "Nuovo")).toBe("renovated");
    expect(resolveCrmPropertyCondition("Buono", "Usato")).toBe("normal");
    expect(resolveCrmPropertyCondition("Normale", "Usato")).toBe("normal");
    expect(resolveCrmPropertyCondition("Da Ristrutturare", "Usato")).toBe("to_renovate");
    expect(resolveCrmPropertyCondition("Scarso", "Usato")).toBe("poor");
  });
});
