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

  it("lascia navigabili pagine e archivi e blocca soltanto l'avvio di un secondo motore", async () => {
    const [renderer, styles] = await Promise.all([
      readFile(rendererFile, "utf8"),
      readFile(stylesFile, "utf8"),
    ]);

    expect(renderer).toContain('for (const id of ["refinement", "portoni", "sync", "history", "settings"])');
    expect(renderer).not.toContain("section.inert = sectionLocked");
    expect(renderer).toContain('section.toggleAttribute("data-operation-locked", sectionLocked)');
    expect(renderer).toContain('const starts = ["refinementStart", "portoniStart", "portoniBlank"');
    expect(styles).not.toContain('body[data-fase="lavora"] .workspace > details.section');
  });
});
