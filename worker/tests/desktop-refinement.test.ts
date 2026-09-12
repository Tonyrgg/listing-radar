import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve(process.cwd(), "src", "desktop", "renderer");

describe("Rifinitura vie", () => {
  it("espone una pagina autonoma e comunica il confine esistente-solamente", async () => {
    const [html, renderer, preload] = await Promise.all([
      readFile(path.join(rendererRoot, "index.html"), "utf8"),
      readFile(path.join(rendererRoot, "renderer.js"), "utf8"),
      readFile(path.resolve(process.cwd(), "src", "desktop", "preload.cjs"), "utf8"),
    ]);
    expect(html).toContain('data-scroll="refinement"');
    expect(html).toContain('id="refinement"');
    expect(html).toContain("Non crea nuove schede immobili");
    expect(html).toContain('id="refinementStart"');
    expect(renderer).toContain("window.propertyWorker.startRefinement");
    expect(preload).toContain('ipcRenderer.invoke("desktop:start-refinement"');
  });
});
