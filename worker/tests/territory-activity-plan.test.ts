import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { TerritoryImportStore } from "../src/territory/import-store.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { freezeRunImport, runActivitySummary } from "../src/territory/activity-plan.js";
import { diffRecords, mergeTerritory, recordsState, syncRecords } from "../src/territory/sync-records.js";
import { buildPlan } from "../src/import-v2/identity.js";
import type { ImportV2Checkpoint } from "../src/import-v2/model.js";
import { unitKey, type Run, type Street } from "../src/territory/model.js";

const street: Street = { id: "proof", name: "Via sintetica", sisterName: "VIA SINTETICA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "run-proof-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  return { store, directory, app: new TerritoryApplication(store, new SimulationProvider(store, 0)) };
}
function fact(id = "first") {
  const source = simulationSource(street, 1, "synthetic");
  source.activity = { ...source.activity, enabled: true, description: id, status: "Da eseguire" };
  const key = unitKey(source);
  const run: Run = { id, streetId: street.id, operation: "apply", origin: "simulation", state: "completed", startedAt: "2026-10-25T10:00:00Z", endedAt: "2026-10-25T10:01:00Z", handled: 1, total: 1, error: null, itemKeys: [key], applySources: { [key]: source }, queueEntryIds: {} };
  const checkpoint: ImportV2Checkpoint = { itemId: id, jobId: source.jobId, propertyId: source.sourcePropertyId, plan: buildPlan(source), stage: "completed", people: [], syncedPeople: [], propertyResolution: { kind: "exact", propertyId: "crm", evidence: {} }, crmPropertyId: "crm", attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: "2026-10-25T10:01:00Z", activityEvidence: { operationId: id, activityId: `task-${id}`, outcome: "created", descriptionVerified: true, statusVerified: true, expectedStatus: "Da eseguire" } };
  freezeRunImport(run, checkpoint);
  return { run, checkpoint, key, source };
}
const created = { created: 1, recovered: 0, disabled: 0, unconfirmed: 0 };

describe("W02: prova immutabile del singolo import", () => {
  it("due run con attivita diverse, checkpoint sostituito e riavvio conservano i conteggi", async () => {
    const { store, app, directory } = await setup();
    await app.start(street.id, "scan"); await app.waitForIdle();
    const key = Object.keys(store.read().units)[0]!;
    await app.enqueue([key]); await app.startQueue([key], { activityMode: "plain" }); await app.waitForIdle();
    const first = store.read().runs.at(-1)!;
    expect(runActivitySummary(store.read(), first)).toEqual(created);
    const proof = structuredClone(first.imports![key]);
    await app.enqueue([key]); await app.startQueue([key], { activityMode: "killer" }); await app.waitForIdle();
    const state = store.read(), second = state.runs.at(-1)!;
    expect(second.imports![key]!.proof!.itemId).not.toBe(proof!.proof!.itemId);
    expect(second.imports![key]!.proof!.activity).not.toEqual(proof!.proof!.activity);
    expect(state.runs.find(r => r.id === first.id)!.imports![key]).toEqual(proof);
    expect(app.importQueue().runs.find(r => r.id === first.id)!.activitySummary).toEqual(created);
    const reopened = await TerritoryStore.open(directory, [street]);
    expect(new TerritoryApplication(reopened, new SimulationProvider(reopened, 0)).importQueue().runs.find(r => r.id === first.id)!.activitySummary).toEqual(created);
    expect(reopened.read().runs.find(r => r.id === first.id)!.imports![key]).toEqual(proof);
  });

  it("prove incomplete, altra operazione e identita discordanti non confermano attivita", async () => {
    const { store } = await setup(), state = store.read();
    for (const mutate of [
      (r: Run, key: string) => { r.imports![key]!.proof!.evidence!.operationId = "other"; },
      (r: Run, key: string) => { delete r.imports![key]!.proof!.evidence!.descriptionVerified; },
      (r: Run, key: string) => { r.imports![key]!.proof!.evidence!.statusVerified = false; },
      (r: Run, key: string) => { r.imports![key]!.proof!.evidence!.activityId = null; },
      (r: Run, key: string) => { r.imports![key]!.proof!.evidence!.expectedStatus = "Eseguito"; },
      (r: Run, key: string) => { r.imports![key]!.proof!.crmId = "different"; },
      (r: Run, key: string) => { r.imports![key]!.proof!.sourcePropertyId = "different"; },
      (r: Run, key: string) => { r.imports![key]!.proof!.activity.description = "different"; },
    ]) {
      const { run, key } = fact(); mutate(run, key);
      expect(runActivitySummary(state, run)).toEqual({ created: 0, recovered: 0, disabled: 0, unconfirmed: 1 });
    }
    const { run, key } = fact(); run.imports![key]!.proof!.evidence!.outcome = "existing";
    expect(runActivitySummary(state, run)).toEqual({ created: 0, recovered: 1, disabled: 0, unconfirmed: 0 });
  });

  it("commit, replay e riavvio mantengono la stessa prova senza duplicare eventi", async () => {
    const { store, directory } = await setup(), { run, key, source, checkpoint } = fact();
    delete run.imports;
    await store.change(s => {
      s.runs.push(run);
      s.units[key] = { key, streetIds: [street.id], observations: [{ at: checkpoint.updatedAt, runId: "scan", source, origin: "simulation" }], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null };
    });
    const port = new TerritoryImportStore(store, street.id, run.id);
    await port.save(checkpoint);
    const saved = store.read().runs[0]!.imports![key];
    checkpoint.activityEvidence!.outcome = "existing";
    await port.save(checkpoint); await port.recordEvent(checkpoint, "stage_completed");
    const reopened = await TerritoryStore.open(directory, [street]), state = reopened.read();
    expect(state.runs[0]!.imports![key]).toEqual(saved);
    expect(state.units[key]!.journal!.filter(e => e.kind === "import_completed")).toHaveLength(1);
    expect(state.events.filter(e => e.id === `import:${checkpoint.itemId}:completed`)).toHaveLength(1);
    const before = reopened.read(); checkpoint.propertyId = "wrong";
    await expect(new TerritoryImportStore(reopened, street.id, run.id).save(checkpoint)).rejects.toThrow("incoerente");
    expect(reopened.read()).toEqual(before);
  });

  it("sync incrementale e merge multi-copia preservano fatti interi e separano le run", async () => {
    const { store } = await setup(), first = fact(), second = fact("second");
    const base = store.read(); base.runs = [first.run];
    const local = structuredClone(base), remote = structuredClone(base);
    local.runs.push(second.run);
    remote.runs[0]!.handled = 4;
    remote.runs[0]!.imports![first.key] = structuredClone(second.run.imports![second.key]!);
    for (const [a, b] of [[local, remote], [remote, local]]) {
      const merged = mergeTerritory(base, a!, b!);
      expect(merged.runs.find(r => r.id === first.run.id)!.imports).toEqual(first.run.imports);
      expect(merged.runs.find(r => r.id === second.run.id)!.imports).toEqual(second.run.imports);
      expect(Object.values(merged.syncConflicts ?? {}).some(c => c.path.includes("imports"))).toBe(true);
      const records = syncRecords(base);
      for (const row of diffRecords(base, merged)) records.set(JSON.stringify([row.collection, row.key]), row);
      const restored = recordsState(records);
      expect(runActivitySummary(restored, restored.runs.find(r => r.id === first.run.id)!)).toEqual(created);
      expect(mergeTerritory(merged, merged, merged).runs).toEqual(merged.runs);
    }
  });

  it("storico senza prova resta non confermato anche con checkpoint perfetto; disabilitato e distinto", async () => {
    const { store, app } = await setup(), { run, checkpoint, key } = fact();
    delete run.imports![key]!.proof;
    await store.change(s => { s.runs.push(run); s.checkpoints[checkpoint.propertyId] = checkpoint; });
    expect(app.importQueue().runs[0]!.activitySummary).toEqual({ created: 0, recovered: 0, disabled: 0, unconfirmed: 1 });
    freezeRunImport(run, checkpoint);
    expect(run.imports![key]!.proof).toBeUndefined();
    delete run.imports;
    checkpoint.plan!.source.activity.enabled = false;
    run.applySources![key]!.activity.enabled = false;
    checkpoint.activityEvidence = { activityId: null, outcome: "disabled" };
    freezeRunImport(run, checkpoint);
    expect(runActivitySummary(store.read(), run)).toEqual({ created: 0, recovered: 0, disabled: 1, unconfirmed: 0 });
  });
});
