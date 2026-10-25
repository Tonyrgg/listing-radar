import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { TerritoryImportStore } from "../src/territory/import-store.js";
import { SimulationProvider } from "../src/territory/providers.js";
import { IMPORT_TIMING_FILE, importTimingReport } from "../src/territory/import-timing.js";
import { logger } from "../src/logger.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import type { SourceProperty } from "../src/import-v2/model.js";
import type { Street } from "../src/territory/model.js";

const directories: string[] = [];
const street: Street = { id: "timing", name: "Via Prova", sisterName: "VIA PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    const target = path.resolve(dir);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("v2-timing-")) throw new Error("Directory di test inattesa");
    await rm(target, { recursive: true, force: true });
  }
});
async function setup(retryLookup = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "v2-timing-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  class Provider extends SimulationProvider {
    override async candidates(street: Street, source: SourceProperty) {
      if (retryLookup) { retryLookup = false; throw new ImportV2Error("Caricamento incompleto", "transient_portal", { retryable: true }); }
      return super.candidates(street, source);
    }
  }
  const app = new TerritoryApplication(store, new Provider(store, 0));
  await app.start(street.id, "scan"); await app.waitForIdle();
  const key = app.detail(street.id).units[0]!.key;
  await app.enqueue([key]); const runId = await app.startQueue([key]); await app.waitForIdle();
  return { directory, store, app, key, runId, filename: path.join(directory, IMPORT_TIMING_FILE) };
}

describe("misure import nel percorso operativo V2 locale", () => {
  it("misura anche la ricerca preliminare fallita e il suo recupero nella stessa run", async () => {
    const { filename, store } = await setup(true);
    const report = await importTimingReport(filename);
    expect(report).toMatchObject({ records: 11, observedItems: 1, parseClean: true });
    expect(report.phases.find(phase => phase.event === "lookup_failed")).toMatchObject({ stage: "candidate_lookup", samples: 1, failuresByKind: { transient_portal: 1 } });
    expect(report.phases.find(phase => phase.event === "lookup_completed")?.samples).toBe(1);
    expect(store.read().runs.at(-1)?.state).toBe("completed");
  });

  it("conserva tutte le fasi del vero motore attraverso TerritoryImportStore senza altre riscritture del ledger", async () => {
    const { directory, store, key, runId, filename } = await setup();
    const report = await importTimingReport(filename, runId);
    expect(report).toMatchObject({ records: 10, observedItems: 1, invalidLines: 0, parseClean: true, sampleAvailable: true });
    expect(report.phases.map(p => p.stage).sort()).toEqual(["candidate_lookup", "queued", "planned", "people_resolved", "people_synced", "property_resolved", "property_synced", "ownerships_synced", "verified", "activity_synced"].sort());
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    const checkpoint = Object.values(store.read().checkpoints)[0]!;
    const revision = store.revision, port = new TerritoryImportStore(store, street.id, runId);
    await port.recordEvent(checkpoint, "stage_completed", { executedStage: "activity_synced", durationMs: 2, operationDurationMs: 1, checkpointSaveDurationMs: 1, failure: { message: "SECRET-NOT-TO-LOG" } });
    expect(store.revision).toBe(revision);
    expect(await readFile(filename, "utf8")).not.toContain("SECRET-NOT-TO-LOG");
    expect((await TerritoryStore.open(directory, [street])).read().units[key]!.crmId).toBeTruthy();
    expect((await importTimingReport(filename, "other-run")).sampleAvailable).toBe(false);
  });

  it("segnala righe troncate, duplicati e conflitti anziche presentarli come un campione pulito", async () => {
    const { filename } = await setup();
    const first = (await readFile(filename, "utf8")).split("\n")[0]!;
    const conflict = { ...JSON.parse(first), durationMs: 999999 };
    await appendFile(filename, `${first}\n${JSON.stringify(conflict)}\n{"version":`);
    const report = await importTimingReport(filename);
    expect(report).toMatchObject({ records: 10, duplicates: 1, conflicts: 1, invalidLines: 1, parseClean: false });
  });

  it("un file diagnostico non scrivibile non invalida il checkpoint CRM gia conservato", async () => {
    const { store, directory, runId } = await setup();
    const filename = path.join(directory, IMPORT_TIMING_FILE);
    await rm(filename); await mkdir(filename);
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const checkpoint = Object.values(store.read().checkpoints)[0]!, revision = store.revision;
    await new TerritoryImportStore(store, street.id, runId).recordEvent(checkpoint, "stage_completed", { executedStage: "activity_synced", durationMs: 2, operationDurationMs: 1, checkpointSaveDurationMs: 1 });
    expect(warning).toHaveBeenCalledOnce();
    expect(store.revision).toBe(revision);
    expect(store.read().checkpoints[checkpoint.propertyId]!.stage).toBe("completed");
  });
});
