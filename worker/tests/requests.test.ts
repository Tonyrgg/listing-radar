import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { collectCrmRequestArchive, extractCrmRequestDetail, normalizeCrmRequest } from "../src/adapters/crm/requests.js";
import { requestItemsStillToProcess } from "../src/services/request-archive-importer.js";

const fixture = (name: string) => path.resolve("src", "fixtures", name);

describe("archivio richieste CRM", () => {
  it("in ripresa salta gli elementi completati e ritenta errori o interruzioni", () => {
    const items = requestItemsStillToProcess([
      { id: "1", status: "completed" },
      { id: "2", status: "failed" },
      { id: "3", status: "running" },
      { id: "4", status: "pending" },
    ]);
    expect(items.map((item) => item.id)).toEqual(["2", "3", "4"]);
  });

  it("pagina tutto l'archivio e conserva le colonne della lista", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(await readFile(fixture("crm-request-archive.html"), "utf8"));
      const items = await collectCrmRequestArchive(page);
      expect(items.map((item) => item.externalId)).toEqual(["REQ-1", "REQ-2"]);
      expect(items[0]?.listFields).toMatchObject({ "Nome cliente": "Cliente Uno", Prezzo: "€ 120.000" });
    } finally { await browser.close(); }
  });

  it("estrae campi, booleani, cliente, stato e sezioni correlate dal dettaglio", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://crm.test/**", async route => route.fulfill({ contentType: "text/html", body: await readFile(fixture("crm-request-detail.html"), "utf8") }));
      await page.goto("https://crm.test/CRMImmobiliareLightning/s/richiestaimmobiliare/REQ-1/prima");
      const detail = await extractCrmRequestDetail(page);
      expect(detail).toMatchObject({ externalId: "REQ-1", status: "In Gestione", clientExternalId: "CLIENT-1" });
      expect(detail.fields).toMatchObject({ Cliente: "Cliente Uno", "Richiesta Calda": true, Prezzo: "120,000" });
      expect(detail.relatedSections[0]).toMatchObject({ heading: "NOTE (1)" });
      const normalized = normalizeCrmRequest(detail);
      expect(normalized.request).toMatchObject({ contract_type: "sale", budget_max: 120000, rooms_ideal: 3, priority: "high", destination: "first_home", financing_method: "full_mortgage" });
    } finally { await browser.close(); }
  });
});
