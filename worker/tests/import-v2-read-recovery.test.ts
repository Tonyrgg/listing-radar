import { describe, expect, it, vi } from "vitest";
import { chromium, type Page } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
function setup(dialogs = 0, paused = () => false) {
  const reload = vi.fn().mockResolvedValue(undefined), page = { reload, locator: () => ({ count: async () => dialogs }) } as unknown as Page;
  const port = new TecnocloudUiV2Port(page, false, { isInterruptionRequested: paused, recoverReadLoading: true }); vi.spyOn(port, "assertSession").mockResolvedValue(undefined);
  return { port: port as unknown as { readAction<T>(label: string, op: () => Promise<T>): Promise<T>; action<T>(label: string, op: () => Promise<T>): Promise<T> }, reload };
}
describe("Ripresa delle sole letture CRM bloccate", () => {
  it("recupera in Chrome la scheda rimasta sul caricamento infinito del titolo immobile", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage(); let loads = 0;
      await page.route("https://tecnocasa-group.my.site.com/**", async route => {
        loads++;
        await route.fulfill({ contentType: "text/html", body: loads === 1 ? '<div role="status">Caricamento…</div>' : '<h1>Immobile</h1><li class="slds-page-header__detail-block"><span class="slds-text-title">Indirizzo Completo Immobile</span><c-output-field>Via Francesco Perrese N. 12</c-output-field></li><div><div><label>Catasto Foglio</label></div><span class="slds-form-element__static">49</span></div><div><div><label>Catasto Particella</label></div><span class="slds-form-element__static">10</span></div><div><div><label>Catasto Subalterno</label></div><span class="slds-form-element__static">1</span></div>' });
      });
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/immobile/001RD00000TestXY");
      const port = new TecnocloudUiV2Port(page, false, { recoverReadLoading: true }) as unknown as { readAction<T>(label: string, op: () => Promise<T>): Promise<T>; readPropertySummary(id: string): Promise<{ cadastral: { sheet: string }; fullAddress: string }> };
      const result = await port.readAction("Inventario immobili della via", () => port.readPropertySummary("001RD00000TestXY"));
      expect(loads).toBe(2); expect(result.cadastral.sheet).toBe("49"); expect(result.fullAddress).toContain("Perrese");
    } finally { await browser.close(); }
  }, 35000);
  it("aggiorna la pagina e ripete la lettura dopo un timeout dell'inventario", async () => {
    const { port, reload } = setup(), read = vi.fn().mockRejectedValueOnce(new Error("locator.waitFor: Timeout 20000ms exceeded Indirizzo Completo Immobile")).mockResolvedValue("immobile");
    expect(await port.readAction("Inventario immobili della via", read)).toBe("immobile");
    expect(reload).toHaveBeenCalledWith({ waitUntil: "commit", timeout: 30000 }); expect(read).toHaveBeenCalledTimes(2);
  });
  it("limita i refresh a due e non trasforma un sito fermo in un risultato vuoto", async () => {
    const { port, reload } = setup(), read = vi.fn().mockRejectedValue(new Error("Timeout caricamento"));
    await expect(port.readAction("Ricerca catastale", read)).rejects.toThrow("Timeout");
    expect(read).toHaveBeenCalledTimes(3); expect(reload).toHaveBeenCalledTimes(2);
  });
  it("non ricarica moduli aperti, sessioni scadute o un'operazione interrotta", async () => {
    const a = setup(1); await expect(a.port.readAction("Lettura", async () => { throw new Error("Timeout"); })).rejects.toThrow("Timeout"); expect(a.reload).not.toHaveBeenCalled();
    const b = setup(); await expect(b.port.readAction("Lettura", async () => { throw new ImportV2Error("Sessione scaduta", "global_session", { global: true }); })).rejects.toThrow("scaduta"); expect(b.reload).not.toHaveBeenCalled();
    const c = setup(0, () => true); const read = vi.fn(); await expect(c.port.readAction("Lettura", read)).rejects.toThrow("pausa"); expect(read).not.toHaveBeenCalled(); expect(c.reload).not.toHaveBeenCalled();
  });
  it("un salvataggio fallito non viene ripetuto dall'automatismo di refresh", async () => {
    const { port, reload } = setup(), save = vi.fn().mockRejectedValue(new Error("Timeout dopo salvataggio"));
    await expect(port.action("Creazione immobile", save)).rejects.toThrow("Timeout");
    expect(save).toHaveBeenCalledOnce(); expect(reload).not.toHaveBeenCalled();
  });
});
