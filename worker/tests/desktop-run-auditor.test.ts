import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("sorveglianza automatica desktop", () => {
  it("vive nella Cronologia e non espone più una run manuale", () => {
    const html = read("src/desktop/renderer/index.html");
    const renderer = read("src/desktop/renderer/renderer.js");
    const preload = read("src/desktop/preload.cjs");
    const main = read("src/desktop/main.ts");

    expect(html).toContain("Sorveglianza automatica · attiva su ogni run");
    expect(html).not.toContain('data-scroll="collaudo"');
    expect(html).not.toContain('id="collaudoStart"');
    expect(renderer).not.toContain("startCollaudo");
    expect(preload).not.toContain("desktop:start-collaudo");
    expect(main).toContain("auditPersistedImport");
    expect(main).toContain("auditStreetRun(result, { expandAllOwners })");
    expect(main).toContain('source: "run-auditor"');
  });
});
