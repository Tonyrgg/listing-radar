import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Rete proprietari basata sullo Street Registry", () => {
  it("espone la coda delle vie e i filtri applicati all'intera sessione", async () => {
    const [html, renderer] = await Promise.all([
      readFile(path.join(root, "src/desktop/renderer/index.html"), "utf8"),
      readFile(path.join(root, "src/desktop/renderer/renderer.js"), "utf8"),
    ]);

    expect(html).toContain("Lavora in sequenza le vie di Bitonto");
    for (const id of [
      "networkRegistryStart", "networkRegistryPause", "networkRegistryRefresh", "networkRegistryZone",
      "networkRegistryNext", "networkRegistryQueue", "networkStreetFloorMode",
      "networkStreetFloorValue", "networkStreetMinCivic", "networkStreetMaxCivic",
      "networkStreetResidentialOnly",
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(renderer).toContain(id);
    }
    expect(renderer).toContain("continuerà con le vie successive");
    expect(renderer).toContain("filters:");
    expect(renderer).toContain("startNetworkRun");
    expect(renderer).toContain('zoneId: $("networkRegistryZone").value || null');
    expect(renderer).toContain("item.zone_rank");
  });

  it("prosegue su più vie, rinnova il lease e aspetta l'import CRM", async () => {
    const [main, service, preload] = await Promise.all([
      readFile(path.join(root, "src/desktop/main.ts"), "utf8"),
      readFile(path.join(root, "src/services/street-registry.ts"), "utf8"),
      readFile(path.join(root, "src/desktop/preload.cjs"), "utf8"),
    ]);

    expect(main).toContain("async function runStreetRegistryNetwork");
    expect(main).toContain("while (!networkRunCancellationRequested)");
    expect(main).toContain("if (pendingStreetRun) await pendingStreetRun");
    expect(main).toContain("if (importPromise) await importPromise");
    expect(main).toContain("completedJob.status === \"completed\"");
    expect(main).toContain("scheduleStreetRegistryLeaseHeartbeat");
    expect(service).toContain('this.client.rpc("renew_street_registry_work"');
    expect(preload).toContain("startNetworkRun");
    expect(main).toContain('ipcMain.handle("desktop:start-network-run"');
    expect(main).toContain("networkRunCancellationRequested = true");
    expect(main).toContain('scope: input.zoneId ? "zone" : "city"');
    expect(service).toContain('this.client.from("internal_zones")');
  });
});
