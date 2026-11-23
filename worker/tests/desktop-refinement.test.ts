import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve(process.cwd(), "src", "desktop", "renderer");

describe("Rifinitura vie", () => {
  it("rimuove la rifinitura dalla navigazione e conserva la compatibilità dei dati legacy", async () => {
    const [html, renderer, preload] = await Promise.all([
      readFile(path.join(rendererRoot, "index.html"), "utf8"),
      readFile(path.join(rendererRoot, "renderer.js"), "utf8"),
      readFile(path.resolve(process.cwd(), "src", "desktop", "preload.cjs"), "utf8"),
    ]);
    for(const view of ["operations","refinement","portoni","history"])expect(html).not.toContain(`data-scroll="${view}"`);
    expect(html).toContain('data-scroll="sync"');
    expect(html).toContain('id="refinement"');
    expect(html).toContain("Non crea nuove schede immobili");
    expect(html).toContain('id="refinementStart"');
    expect(html).toContain('id="refinementCloudStreet"');
    expect(html).toContain('id="refinementSisterStreet"');
    expect(html).toContain('id="refinementJobsList"');
    expect(html).toContain('id="refinementCompletedList"');
    expect(html).toContain('id="refinementDiagnosticList"');
    expect(html).toContain('id="refinementActivityList"');
    expect(html).toContain("Usato nel filtro Indirizzo degli immobili residenziali");
    expect(html).toContain("Usato per acquisire i dati catastali della via");
    expect(renderer).toContain("window.propertyWorker.startRefinement");
    expect(renderer).toContain("renderRefinementArchive");
    expect(renderer).toContain("appState?.refinement?.jobs");
    expect(renderer).toContain('update.activityItem.workspace === "rifinitura"');
    expect(renderer).toContain('sisterStreet: resume ? checkpoint.requestedStreet : $("refinementSisterStreet").value');
    expect(renderer).toContain('checkpoint.runSettings?.refinementCloudStreet ?? checkpoint.runSettings?.refinementSecondaryStreet ?? checkpoint.requestedStreet');
    expect(renderer).toContain('refinementOrigin === "completed_lavorazione"');
    expect(renderer).toContain("Lavorazione completata");
    expect(renderer).toContain('data-resume-acquisition="${job.id}">Avvia rifinitura');
    expect(preload).toContain('ipcRenderer.invoke("desktop:start-refinement"');
  });
});
