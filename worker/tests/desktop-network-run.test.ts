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
    expect(html).toContain("Non importa nulla");
    expect(renderer).toContain("startNetworkRun");
    expect(preload).toContain("startNetworkRun");
    expect(main).toContain('ipcMain.handle("desktop:start-network-run"');
    expect(main).toContain("networkRunCancellationRequested = true");
  });
});
