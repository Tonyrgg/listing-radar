import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";

describe("Riconcilia già verde con sezioni chiuse", () => {
  it.each(["absent", "collapsed", "visible"])("salva solo la finestra di riconciliazione con campi %s", async (fields) => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.route("https://tecnocasa-group.my.site.com/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><body>
        <main><label>Nome<input value="Mario"></label><button onclick="document.body.dataset.wrongSave='yes'">Salva</button></main>
        <section role="dialog" aria-label="Riconcilia">
          <h2>Riconcilia</h2><div>Merge dei campi</div>
          <p>Tutti i campi sono stati riconciliati. Si può procedere al salvataggio</p>
          <button aria-expanded="false">Cliente</button><button aria-expanded="false">Recapiti ed Indirizzi</button>
          ${fields === "absent" ? "" : `<div ${fields === "collapsed" ? "hidden" : ""}>
            <input type="radio" name="FirstName" value="master"><input type="radio" name="FirstName" value="slave" checked>
          </div>`}
          <footer><button>Annulla</button><button id="save" disabled>Salva</button></footer>
        </section>
        <script>
          setTimeout(() => document.querySelector('#save').disabled = false, 350);
          document.querySelector('#save').onclick = () => {
            document.body.dataset.saved = String(Number(document.body.dataset.saved || 0) + 1);
            document.body.dataset.left = String(document.querySelector('input[value=master]')?.checked || false);
            document.querySelector('[role=dialog]').remove();
          };
        </script></body>` }));
      await page.goto("https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/account/test-person");
      const port = new TecnocloudUiV2Port(page);
      const result = await (port as unknown as { resolveVisibleMerge(): Promise<string> }).resolveVisibleMerge();
      expect(result).toBe("test-person");
      expect(await page.locator('body').getAttribute('data-saved')).toBe("1");
      expect(await page.locator('body').getAttribute('data-wrong-save')).toBeNull();
      if (fields === "visible") expect(await page.locator('body').getAttribute('data-left')).toBe("true");
    } finally { await browser.close(); }
  }, 20_000);
});
