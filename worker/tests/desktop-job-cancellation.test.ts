import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("annullamento delle lavorazioni dalla cronologia", () => {
  it("rimuove subito il job dalla cache e protegge la cache dalle letture remote già in corso", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");

    expect(main).toContain("snapshotRemoteRevision += 1");
    expect(main).toContain("jobs: snapshotRemoteData.jobs.filter((job) => job.id !== jobId)");
    expect(main).toContain("completedImports: snapshotRemoteData.completedImports.filter(({ job }) => job.id !== jobId)");
    expect(main).toContain("if (snapshotRemoteRevision === revision)");
  });

  it("riabilita la finestra di conferma se la cancellazione remota fallisce", () => {
    const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");

    expect(renderer).toMatch(/await window\.propertyWorker\.cancelJob\(pendingCancelJobId\);[\s\S]*finally \{[\s\S]*cancelInFlight = false/);
  });
});
