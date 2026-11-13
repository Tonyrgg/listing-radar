import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { CrmPropertySummary, CrmOwnershipSnapshot } from "../src/import-v2/model.js";

describe("lettura identita immobile Tecnocloud", () => {
  it('recognizes the actual record title outside h1/h2 and ignores links to other records',async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try{
      const page=await browser.newPage(),id='a0V000000000001AAA';
      await page.route('https://tecnocasa-group.my.site.com/**',route=>route.fulfill({contentType:'text/html',body:`<span class="slds-page-header__title">IM-AB123</span><h2>Dettagli</h2><p>Indirizzo Completo Immobile</p><label>Catasto Foglio</label><a href="/s/immobile/other">NT-OTHER</a>`}));
      await page.goto(`https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/immobile/${id}`);
      const port=new TecnocloudUiV2Port(page);await expect(port.assertPropertyWritable(id)).resolves.toBeUndefined();
      await page.locator('.slds-page-header__title').evaluate(node=>{node.textContent='IN-AB123';});
      await expect(port.assertPropertyWritable(id)).rejects.toThrow(/protetta/);
      await page.locator('.slds-page-header__title').evaluate(node=>{node.textContent='';});
      await expect(port.assertPropertyWritable(id)).rejects.toMatchObject({kind:'global_portal',options:{global:true,retryable:true}});
    }finally{await browser.close();}
  });
  it("evita le liste proprietari nel confronto, ma le rilegge nella verifica completa e controlla la sessione", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/");
      const port = new TecnocloudUiV2Port(page);
      const internal = port as unknown as { readPropertySummary(id: string): Promise<CrmPropertySummary>; readOwnerships(id: string): Promise<CrmOwnershipSnapshot[]> };
      const summary: CrmPropertySummary = { id: "property", displayName: "Immobile", fullAddress: "Via Prova 1", cadastral: null };
      const identity = vi.spyOn(internal, "readPropertySummary").mockResolvedValue(summary);
      const ownerships = vi.spyOn(internal, "readOwnerships").mockResolvedValue([]);
      expect(await port.readPropertyIdentity("property")).toEqual(summary);
      expect(ownerships).not.toHaveBeenCalled();
      expect(await port.readProperty("property")).toEqual({ ...summary, owners: [] });
      expect(ownerships).toHaveBeenCalledExactlyOnceWith("property");
      await page.setContent('<input type="password">');
      await expect(port.readPropertyIdentity("property")).rejects.toThrow("Sessione Tecnocloud scaduta");
      expect(identity).toHaveBeenCalledTimes(2);
    } finally { vi.restoreAllMocks(); await browser.close(); }
  });
});
