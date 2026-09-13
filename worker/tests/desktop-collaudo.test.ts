import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("collaudatore desktop", () => {
  it("espone un solo scenario reale con consenso, stop e rapporto", () => {
    const html = read("src/desktop/renderer/index.html");
    expect(html).toContain('data-scroll="collaudo"');
    expect(html).toContain('id="collaudoConsent"');
    expect(html).toContain('id="collaudoStart"');
    expect(html).toContain('id="collaudoStop"');
    expect(html).toContain("VIA PIETRO COLLETTA");
    expect(html).toContain('id="collaudoAssertions"');
  });

  it("collega renderer, preload e processo principale senza accettare una via libera", () => {
    const renderer = read("src/desktop/renderer/renderer.js");
    const preload = read("src/desktop/preload.cjs");
    const main = read("src/desktop/main.ts");
    expect(renderer).toContain("window.propertyWorker.startCollaudo()");
    expect(renderer).toContain("window.propertyWorker.stopCollaudo()");
    expect(preload).toContain('ipcRenderer.invoke("desktop:start-collaudo")');
    expect(preload).toContain('ipcRenderer.invoke("desktop:stop-collaudo")');
    expect(main).toContain('street: COLLAUDO_STREET');
    expect(main).toContain("assertCollaudoStreet(property.address)");
    expect(main).toContain("collaudoPropertyKeys.size >= COLLAUDO_MAX_PROPERTIES");
    expect(main).toContain("input.refinement || input.collaudo ? false : preferences.expandAllOwners");
    expect(main).toContain("Rileggo il checkpoint del collaudo fermato prima di riprendere le righe aperte");
    expect(renderer).toContain('resumable ? "Rivalida e riprendi" : "Avvia collaudo"');
  });
});
