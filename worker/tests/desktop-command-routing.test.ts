import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rendererDirectory = path.resolve(process.cwd(), "src", "desktop", "renderer");

describe("instradamento comandi desktop", () => {
  it("mantiene un solo dispatcher per tutti i comandi del worker", async () => {
    const [html, renderer] = await Promise.all([
      readFile(path.join(rendererDirectory, "index.html"), "utf8"),
      readFile(path.join(rendererDirectory, "renderer.js"), "utf8"),
    ]);

    expect(html).not.toContain("request-archive.js");
    expect(html).not.toContain("mandate-archive.js");
    expect(renderer.match(/document\.addEventListener\("click"/g)).toHaveLength(1);
    expect(renderer).toMatch(/executeButtonCommand\(target,\s*command/);
    expect(renderer).toContain("non ha un comando collegato");
  });

  it("instrada i pulsanti operativi statici senza percorsi silenziosi", async () => {
    const renderer = await readFile(path.join(rendererDirectory, "renderer.js"), "utf8");
    const routedIds = [
      "checkButton",
      "chromeButton",
      "chooseExcelButton",
      "openOperationLogButton",
      "startButton",
      "streetRunStart",
      "streetRunCancel",
      "streetRunAbandon",
      "stopAllButton",
      "requestArchiveStart",
      "requestArchiveCancel",
      "requestArchiveNew",
      "mandateArchiveStart",
      "mandateArchiveCancel",
      "mandateArchiveNew",
      "softwareUpdateCancel",
      "completedImportsLoadMore",
    ];

    for (const id of routedIds) expect(renderer, `manca il comando per #${id}`).toMatch(new RegExp(`target\\.id\\s*===\\s*[\"']${id}[\"']`));
    for (const action of [
      "pause",
      "toggle-auto-retry",
      "resume-current",
      "open-corrections",
      "close-corrections",
      "config",
      "open-review",
      "close-detail",
      "cancel-current",
      "close-completed-session",
    ]) expect(renderer, `manca il comando data-action=${action}`).toMatch(new RegExp(`target\\.dataset\\.action\\s*===\\s*[\"']${action}[\"']`));
  });

  it("registra ricezione, esito, annullamento ed errore dei comandi", async () => {
    const [main, preload] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src", "desktop", "main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src", "desktop", "preload.cjs"), "utf8"),
    ]);

    expect(preload).toContain('recordUiAction: (values) => ipcRenderer.invoke("desktop:record-ui-action", values)');
    expect(main).toContain('ipcMain.handle("desktop:record-ui-action"');
    expect(main).toContain("Comando ricevuto:");
    expect(main).toContain("Comando eseguito:");
    expect(main).toContain("Comando annullato:");
    expect(main).toContain("Comando fallito:");
    expect(main).toContain("worker-operations.ndjson");
  });
});
