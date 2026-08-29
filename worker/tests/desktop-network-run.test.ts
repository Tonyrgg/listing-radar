import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("controlli desktop esplorazione rete", () => {
  it("espone una coda senza import automatico e una pausa cooperativa", async () => {
    const [html, renderer, preload, main] = await Promise.all([
      readFile(path.join(root, "src/desktop/renderer/index.html"), "utf8"),
      readFile(path.join(root, "src/desktop/renderer/renderer.js"), "utf8"),
      readFile(path.join(root, "src/desktop/preload.cjs"), "utf8"),
      readFile(path.join(root, "src/desktop/main.ts"), "utf8"),
    ]);
    expect(html).toContain('id="networkRunStart"');
    for (const id of ["networkFloorMode", "networkFloorValue", "networkMinOwnerAge", "networkMaxOwnerAge", "networkMinOwnerCount", "networkMaxOwnerCount", "networkMinCivic", "networkMaxCivic"]) {
      expect(html).toContain(`id="${id}"`);
      expect(renderer).toContain(id);
    }
    expect(renderer).toContain("startNetworkRun");
    // I filtri stanno in banda, non in righe: una colonna sola vorrebbe dire
    // essere tornati al modulo precedente al riferimento 6b.
    expect(html).toContain('class="network-filter-grid"');
    expect(html.match(/class="network-filter-field"/g)).toHaveLength(4);
    expect(html).not.toContain('class="network-filter-row"');
    expect(html).toContain('id="networkFilterReset"');
    expect(renderer).toContain("networkFilterReset");
    for (const obsolete of ["networkRunRestart", "Torna al checkpoint", "Rete esplorata", "Coda congelata"]) {
      expect(html).not.toContain(obsolete);
      expect(renderer).not.toContain(obsolete);
    }
    expect(renderer).toContain("resume: false");
    expect(main).toContain('pushActivity("Nuova esplorazione rete proprietaria avviata"');
    expect(preload).toContain("startNetworkRun");
    expect(main).toContain('ipcMain.handle("desktop:start-network-run"');
    expect(main).toContain("networkRunCancellationRequested = true");
  });
});
