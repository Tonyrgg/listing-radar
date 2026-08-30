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
    // I filtri sono bottoni che si aprono uno per volta: sei gruppi, sei
    // pannelli, e per ognuno una spiegazione e un azzeramento suoi. Tutti
    // aperti insieme era il modulo che faceva scorrere la scheda.
    expect(html.match(/data-net-chip="/g)).toHaveLength(6);
    expect(html.match(/data-net-panel="/g)).toHaveLength(6);
    expect(html.match(/data-net-info="/g)).toHaveLength(6);
    expect(html.match(/data-net-explain="/g)).toHaveLength(6);
    expect(html.match(/data-net-clear="/g)).toHaveLength(6);
    expect(html).not.toContain('class="network-advanced"');
    expect(html).toContain('id="networkFilterReset"');
    expect(renderer).toContain("networkFilterReset");

    // Nessun campo dell'estensione parte valorizzato: il segnaposto dice il
    // predefinito, e il vuoto deve arrivare al normalizzatore come "mancante".
    for (const id of ["networkMaxDepth", "networkMaxPeople", "networkSeedCount", "networkMinShare"]) {
      expect(html).not.toMatch(new RegExp(`id="${id}"[^>]*\svalue="`));
      expect(renderer).toContain(`numeroOMancante($("${id}").value)`);
    }
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
