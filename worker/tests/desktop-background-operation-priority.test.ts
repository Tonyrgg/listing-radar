import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rendererPath = path.resolve(
  process.cwd(),
  "src",
  "desktop",
  "renderer",
  "renderer.js",
);

describe("priorità delle operazioni desktop in background", () => {
  it("mostra la sincronizzazione attiva prima di errori o completamenti precedenti", async () => {
    const renderer = await readFile(rendererPath, "utf8");
    const renderAction = renderer.slice(
      renderer.indexOf("function renderAction()"),
      renderer.indexOf("function renderJobs()"),
    );

    expect(renderer).toContain("function activeBackgroundOperation()");
    expect(renderer).toContain("appState?.mandateArchive?.active");
    expect(renderer).toContain("appState?.requestArchive?.active");
    expect(renderAction.indexOf("const backgroundRun = activeBackgroundOperation()"))
      .toBeLessThan(renderAction.indexOf("if (completed)"));
    expect(renderAction.indexOf("if (completed)"))
      .toBeLessThan(renderAction.indexOf("if (hasVisibleForegroundError())"));
  });

  it("non aggiunge riprova e stato di errore mentre un archivio sta avanzando", async () => {
    const renderer = await readFile(rendererPath, "utf8");
    const enhancer = renderer.slice(
      renderer.indexOf("function enhanceActionPanel()"),
      renderer.indexOf("function updateAutoRetryCountdown()"),
    );

    expect(renderer).toContain(
      "return Boolean(appState?.lastError && !hasActiveBackgroundOperation());",
    );
    expect(enhancer).not.toContain("appState?.lastError");
    expect(enhancer).toContain("hasVisibleForegroundError()");
    expect(renderer).toContain(
      'anyOperationActive ? "In lavorazione"',
    );
  });
});
