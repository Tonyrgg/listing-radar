import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("UX e motori separati delle run", () => {
  const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../src/services/runner.ts", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");

  it("congela le impostazioni e usa il registro per il dettaglio", () => {
    expect(main).toContain("withLockedImportRunOptions");
    expect(runner).toContain("lockedImportOptions");
    expect(main).toContain("buildPropertyRunLedger");
    expect(main).toContain('"sister-refinement-run.json"');
    expect(main).toContain("refinementRunCheckpoint");
    expect(main).toContain("streetRunError = null;");
    expect(renderer).toContain("Impostazioni fissate alla partenza");
    expect(renderer).toContain("Eseguito con anomalie");
    expect(renderer).toContain("Riparte da qui");
  });

  it("mantiene checkpoint e ripresa distinti per Rifinitura e Portoni", () => {
    expect(main).toContain('engine: requestedEngine');
    expect(main).toContain('engine: "portoni"');
    expect(main).toContain("resumeSheetId");
    expect(renderer).toContain("Riprendi rifinitura");
    expect(renderer).toContain("data-portoni-resume");
  });
});
