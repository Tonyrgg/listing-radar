import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = (...parts: string[]) => path.resolve(process.cwd(), "src", ...parts);

describe("controlli di arresto desktop", () => {
  it("espone arresto globale e abbandono recuperabile del checkpoint", async () => {
    const [main, preload, html, chrome] = await Promise.all([
      readFile(source("desktop", "main.ts"), "utf8"),
      readFile(source("desktop", "preload.cjs"), "utf8"),
      readFile(source("desktop", "renderer", "index.html"), "utf8"),
      readFile(source("services", "chrome.ts"), "utf8"),
    ]);

    expect(html).toContain('id="stopAllButton"');
    expect(html).toContain('id="runControls"');
    expect(html).toContain('id="stopAfterNextImportButton"');
    expect(html).not.toContain('id="stopAfterNextImportToggle"');
    /* L'autocompila non e piu un interruttore: sono tre modalita, e la terza
     * non scrive nessuna attivita nel gestionale. Restano una regola globale,
     * valida per lavorazioni, long run, richieste e incarichi. */
    expect(html).not.toContain('id="autoFillDirectContactToggle"');
    expect(html).toContain('data-activity-mode="direct_contact"');
    expect(html).toContain('data-activity-mode="plain"');
    expect(html).toContain('data-activity-mode="none"');
    expect(html).toContain('id="streetRunAbandon"');
    expect(preload).toContain('stopAll: () => ipcRenderer.invoke("desktop:stop-all")');
    expect(preload).toContain('setStopAfterNextImport: (enabled) => ipcRenderer.invoke("desktop:set-stop-after-next-import", enabled)');
    expect(preload).toContain('abandonStreetRun: () => ipcRenderer.invoke("desktop:abandon-street-run")');
    expect(main).toContain('ipcMain.handle("desktop:stop-all"');
    expect(main).toContain("propertyActivityMode: () => preferences.propertyActivityMode");
    expect(main).toContain('status: "acquisition_skipped"');
    expect(main).toContain("continuo con gli elementi validi");
    expect(main).toContain("repairLongRunJobForImport");
    expect(main).toContain("forceLiveImport ? false : input.dryRun");
    expect(chrome).toContain("a0Q3Y00000ecMlzUAE");
    expect(chrome).toContain("a0Q3Y00000echeFUAQ");
    expect(main).toContain('ipcMain.handle("desktop:abandon-street-run"');
    expect(main).toContain("sister-street-run.abandoned.");
    expect(main).toContain("await rename(source, archived)");
  });

  it("interrompe anche le pagine Playwright degli import archivio", async () => {
    const [requests, mandates, runner] = await Promise.all([
      readFile(source("services", "request-archive-importer.ts"), "utf8"),
      readFile(source("services", "mandate-archive-importer.ts"), "utf8"),
      readFile(source("services", "runner.ts"), "utf8"),
    ]);

    for (const importer of [requests, mandates]) {
      expect(importer).toContain("async interrupt()");
      expect(importer).toContain("await chrome.browser.close().catch");
      expect(importer).toContain('status: cancelled ? "cancelled" : "failed"');
    }
    expect(runner).toContain("async interrupt()");
    expect(runner).toContain("this.interruptActiveBrowser = () => tabs.browser.close()");
  });

  it("offre un nuovo avvio senza obbligare la ripresa degli archivi parziali", async () => {
    const [html, renderer] = await Promise.all([
      readFile(source("desktop", "renderer", "index.html"), "utf8"),
      readFile(source("desktop", "renderer", "renderer.js"), "utf8"),
    ]);

    expect(html).toContain('id="requestArchiveNew"');
    expect(html).toContain('id="mandateArchiveNew"');
    expect(renderer).toMatch(/requestArchiveNew[\s\S]*startRequestArchiveImport\(\)/);
    expect(renderer).toMatch(/mandateArchiveNew[\s\S]*startMandateArchiveImport\(\)/);
    expect(renderer).toContain("renderRunControls");
    expect(renderer).toContain("!appState?.stopAfterNextImport");
    expect(renderer).not.toContain("stopAfterNextImportToggle");
  });

  it("usa una plancia senza sidebar, con stati automatici e un carosello unico", async () => {
    const [html, renderer, main] = await Promise.all([
      readFile(source("desktop", "renderer", "index.html"), "utf8"),
      readFile(source("desktop", "renderer", "renderer.js"), "utf8"),
      readFile(source("desktop", "main.ts"), "utf8"),
    ]);

    expect(html).not.toContain('class="side-nav"');
    /* Il controllo dei collegamenti resta automatico: la fascia a tutta
     * larghezza e sparita e lo stato vive nella pastiglia della testata. Il
     * ri-controllo manuale torna soltanto dentro la barra d'errore, dov'e
     * la domanda a cui risponde. */
    expect(html).not.toContain('class="connection-strip"');
    expect(html).toContain('id="connectionPill"');
    expect(html).toContain('id="connectionAlert"');
    expect(html).toContain('id="checkButton"');
    /* «Apri Chrome di lavoro» resta nella testata: il controllo dei
     * collegamenti e diventato automatico, ma aprire la finestra di lavoro e
     * ancora un gesto che tocca alla persona, e senza il pulsante il ponte
     * `openChrome` restava codice irraggiungibile. */
    expect(html).toContain('id="chromeButton"');
    expect(html).toContain('id="operationConsole"');
    expect(html.match(/data-run-slide="/g)).toHaveLength(3);
    expect(renderer).toContain("setRunSlide");
    expect(main).toContain("scheduleHealthChecks");
    expect(main).toContain("resetStaleOperationState");
    expect(main).toContain("streetRunPromise = runPromise");
    expect(main).toContain("networkRunPromise = runPromise");
  });
});
