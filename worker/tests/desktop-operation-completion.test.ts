import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = (...parts: string[]) => path.resolve(process.cwd(), "src", ...parts);

describe("schermata conclusiva delle operazioni desktop", () => {
  it("pubblica un esito specifico per sincronizzazioni e run concluse", async () => {
    const main = await readFile(source("desktop", "main.ts"), "utf8");

    expect(main).toContain('kind: "acquisition"');
    expect(main).toContain('kind: "requests"');
    expect(main).toContain('kind: "mandates"');
    expect(main).toContain('kind: "street"');
    expect(main).toContain('kind: "network"');
    expect(main).toContain("operationCompletion,");
    expect(main).toContain("operationCompletion = null;");
    expect(main).toContain('title: "Traguardo della rete raggiunto"');
  });

  it("porta il centro operativo al 100% e mostra l'esito prima dei lavori precedenti", async () => {
    const renderer = await readFile(source("desktop", "renderer", "renderer.js"), "utf8");
    const renderAction = renderer.slice(
      renderer.indexOf("function renderAction()"),
      renderer.indexOf("function renderJobs()"),
    );

    expect(renderer).toContain('$("progressPercent").textContent = "100%"');
    expect(renderer).toContain("Operazione completata");
    expect(renderer).toContain('appState.operationCompletion || completed ? "is-complete"');
    expect(renderAction.indexOf("const completion = appState?.operationCompletion"))
      .toBeLessThan(renderAction.indexOf("if (completed)"));
  });
});
