import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rendererFile = path.resolve(process.cwd(), "src", "desktop", "renderer", "renderer.js");
const stylesFile = path.resolve(process.cwd(), "src", "desktop", "renderer", "styles.css");

describe("navigazione del worker durante una lavorazione", () => {
  it("non riporta automaticamente l'utente alla pagina Lavorazioni", async () => {
    const renderer = await readFile(rendererFile, "utf8");

    expect(renderer).not.toContain(
      'anyOperationActive && document.body.dataset.workerView !== "operations"',
    );
    expect(renderer).toContain("lockSecondaryPageActions(anyOperationActive)");
  });

  it("lascia navigabili le pagine ma rende inattive le loro azioni", async () => {
    const [renderer, styles] = await Promise.all([
      readFile(rendererFile, "utf8"),
      readFile(stylesFile, "utf8"),
    ]);

    expect(renderer).toContain('for (const id of ["sync", "history", "settings"])');
    expect(renderer).toContain("section.inert = locked");
    expect(renderer).toContain('section.toggleAttribute("data-operation-locked", locked)');
    expect(styles).toContain("details.section[data-operation-locked]");
    expect(styles).toContain("cursor: not-allowed");
  });
});
