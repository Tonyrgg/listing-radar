import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = (...parts: string[]) => path.resolve(process.cwd(), "src", ...parts);

describe("sidebar contestuale della lavorazione", () => {
  it("durante la run privilegia il lavoro attivo e non propone la ripresa", async () => {
    const renderer = await readFile(source("desktop", "renderer", "renderer.js"), "utf8");

    expect(renderer).toContain("const activeInspectorJob = workRunActive");
    expect(renderer).toContain("const inspectorRunActive = Boolean(workRunActive && job.id === appState.activeJobId)");
    expect(renderer).toContain('inspectorRunActive ? "In corso"');
    expect(renderer).toContain('data-scroll="operationConsole">Apri centro operativo</button>');
    expect(renderer).toMatch(/const primary = workRunActive[\s\S]*?Apri centro operativo[\s\S]*?: complete[\s\S]*?Riprendi dal punto salvato/);
  });

  it("mostra record corrente e compatta le regole durante l'esecuzione", async () => {
    const [renderer, styles] = await Promise.all([
      readFile(source("desktop", "renderer", "renderer.js"), "utf8"),
      readFile(source("desktop", "renderer", "styles.css"), "utf8"),
    ]);

    expect(renderer).toContain('class="inspector-section inspector-current"');
    expect(renderer).toContain("liveProgress?.address");
    expect(renderer).toContain("Regole fissate per questa run");
    expect(styles).toContain(".inspector-status.is-running");
    expect(styles).toContain(".inspector-current");
  });
});
