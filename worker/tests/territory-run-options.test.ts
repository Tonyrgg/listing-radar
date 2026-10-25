import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { effectiveSource, type Street } from "../src/territory/model.js";
import { runSettings, sourceForApply } from "../src/territory/run-options.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import { buildPlan } from "../src/import-v2/identity.js";
import { canEnableQueuedActivity, runActivitySummary } from "../src/territory/activity-plan.js";

const street: Street = { id: "1", name: "Via di prova", sisterName: "VIA DI PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-options-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  const app = new TerritoryApplication(store, new SimulationProvider(store, 0));
  await app.start(street.id, "scan"); await app.waitForIdle();
  await app.start(street.id, "compare"); await app.waitForIdle();
  const key = Object.keys(store.read().units)[0]!;
  return { store, app, key, directory };
}
describe("Opzioni operative V2, congelate per run", () => {
  it("le quattro modalita rispettano recapiti, intestatari inclusi e ordinali congelati", () => {
    const source = simulationSource(street, 1, "test"), original = structuredClone(source);
    expect(sourceForApply(source, runSettings({ activityMode: "none" })).activity.enabled).toBe(false);
    expect(sourceForApply(source, runSettings({ activityMode: "plain" })).activity).toMatchObject({ enabled: true, contactMode: "Telefonata", status: "Da eseguire" });
    expect(sourceForApply(source, runSettings({ activityMode: "direct_contact" }), true, 2).activity).toMatchObject({ contactMode: "Contatto diretto", status: "Eseguito", description: "Ripassare in un secondo momento" });
    source.owners[0]!.contacts.phones = ["3330000000"];
    expect(sourceForApply(source, runSettings({ activityMode: "direct_contact" })).activity).toMatchObject({ contactMode: "Telefonata", status: "Da eseguire" });
    expect(sourceForApply(source, runSettings({ activityMode: "killer" }), true, 2).activity).toMatchObject({ contactMode: "Telefonata", status: "Eseguito", description: "Ci abita" });
    expect(sourceForApply(source, runSettings({ activityMode: "killer" }), false).activity.enabled).toBe(false);
    expect(source.activity).toEqual(original.activity);
    source.owners = [{ ...source.owners[0]!, sharePercentage: 100, contacts: { phones: [], emails: [] } }, { ...source.owners[0]!, sourcePersonId: "other", sharePercentage: 0 }];
    expect(sourceForApply(source, runSettings({ activityMode: "killer", includeCoOwners: false })).activity.contactMode).toBe("Contatto diretto");
    expect(sourceForApply(source, runSettings({ activityMode: "killer", includeCoOwners: true })).activity.contactMode).toBe("Telefonata");
  });
  it("Killer ruota gli esiti per immobile e conserva il piano anche dopo la riapertura", async () => {
    const { store, app, directory } = await setup();
    const keys = app.detail(street.id).units.filter(u => ["1", "2", "3"].includes(u.source.cadastral.subaltern)).map(u => u.key);
    for (const key of keys) await app.correct(key, { owners: effectiveSource(store.read().units[key]!).owners.map(owner => ({ ...owner, contacts: { ...owner.contacts, phones: ["3330000000"] } })) }, "");
    await app.enqueue(keys); await app.startQueue(keys, { activityMode: "killer" }); await app.waitForIdle();
    expect(store.read().runs.at(-1)!.state).toBe("completed");
    expect(Object.values(store.read().runs.at(-1)!.applySources!).map(s => s.activity.description)).toEqual(["Non vende", "Ci abita", "Segreteria"]);
    expect(Object.values(store.read().virtualActivities!).map(a => a.activity.status)).toEqual(["Eseguito", "Eseguito", "Eseguito"]);
    expect(runActivitySummary(store.read(), store.read().runs.at(-1)!)).toEqual({ created: 3, recovered: 0, disabled: 0, unconfirmed: 0 });
    const summaryState = store.read(), summaryRun = summaryState.runs.at(-1)!;
    summaryRun.imports![keys[0]!]!.proof!.evidence!.operationId = "old-operation";
    expect(runActivitySummary(summaryState, summaryRun).unconfirmed).toBe(1);
    const reopened = await TerritoryStore.open(directory, [street]);
    expect(reopened.read().runs.at(-1)!.applySources).toEqual(store.read().runs.at(-1)!.applySources);
    expect(effectiveSource(reopened.read().units[keys[0]!]!).activity.enabled).toBe(false);
  });
  it("rifiuta intervalli invertiti, piani mancanti e modalità non supportate", () => {
    expect(() => runSettings({ filters: { minCivicNumber: 10, maxCivicNumber: 2 } })).toThrow("civico finale");
    expect(() => runSettings({ filters: { floorMode: "exact" } })).toThrow("Indica il piano");
    expect(() => runSettings({ filters: { floorValue: 101 } })).toThrow();
    expect(() => runSettings({ activityMode: "unsupported" })).toThrow();
    expect(runSettings({ activityMode: "killer" }).activityMode).toBe("killer");
    expect(runSettings().activityMode).toBe("none");
    expect(runSettings().includeCoOwners).toBe(true);
  });
  it("applica i filtri e li mantiene dopo pausa e riapertura", async () => {
    const { store, app, directory } = await setup();
    const options = { filters: { floorMode: "exact", floorValue: 2, minCivicNumber: 4, maxCivicNumber: 8 } };
    const id = await app.start(street.id, "scan", [], undefined, options);
    app.pause(); await app.waitForIdle();
    const reopened = await TerritoryStore.open(directory, [street]);
    const second = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    await expect(second.start(street.id, "scan", [], id, {})).rejects.toThrow("opzioni iniziali");
    await second.start(street.id, "scan", [], id); await second.waitForIdle();
    const run = reopened.read().runs.find(r => r.id === id)!;
    expect(run.state).toBe("completed");
    expect(run.itemKeys).toHaveLength(1);
    expect(reopened.read().units[run.itemKeys[0]!]!.observations.at(-1)?.source.cadastral.subaltern).toBe("3");
    expect(run.settings?.filters).toEqual(runSettings(options).filters);
    expect(second.detail(street.id).street.progress.total).toBe(6);
    expect(store.read().runs.find(r => r.id === id)?.settings?.filters.floorValue).toBe(2);
  });
  it("solo schede esistenti respinge la selezione da creare senza iniziare scritture", async () => {
    const { app, store, key } = await setup(); const count = store.read().runs.length;
    await expect(app.start(street.id, "apply", [key], undefined, { importPolicy: "existing_only" })).rejects.toThrow("deseleziona");
    expect(store.read().runs).toHaveLength(count);
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(0);
  });
  it("recupera i filtri delle vecchie run senza opzioni esplicite dal checkpoint originale", async () => {
    const { app, store } = await setup();
    const filters = runSettings({ filters: { residentialOnly: true, floorMode: "exact", floorValue: 2 } }).filters;
    const id = await app.start(street.id, "scan", [], undefined, { filters }); app.pause(); await app.waitForIdle();
    await store.change(s => { const prior = s.runs.find(r => r.id === id)!; delete prior.settings; prior.checkpoint = { next: 1, filters }; });
    await app.start(street.id, "scan", [], id); await app.waitForIdle();
    const run = store.read().runs.find(r => r.id === id)!;
    expect(run.settings?.filters).toEqual(filters);
    expect(run.itemKeys).toHaveLength(1);
  });
  it("rilegge la scheda esistente e non la ricrea se scompare dal confronto", async () => {
    const { store } = await setup(); const key = Object.keys(store.read().units)[2]!;
    class Gone extends SimulationProvider { override async candidates() { return { rows: [], complete: true }; } }
    const app = new TerritoryApplication(store, new Gone(store, 0));
    await app.start(street.id, "apply", [key], undefined, { importPolicy: "existing_only" }); await app.waitForIdle();
    expect(app.quarantineList().at(-1)?.reason).toContain("nessuna creazione");
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(0);
  });
  it("lavora il solo principale senza eliminare gli altri collegamenti già esistenti", async () => {
    const { app, store, key } = await setup();
    await store.change(s => {
      const source = s.units[key]!.observations[0]!.source;
      source.owners[0]!.sharePercentage = 60;
      source.owners.push({ ...structuredClone(source.owners[0]!), sourcePersonId: "co-owner", taxCode: "VRDLGU80A01A662M", fullName: "Verdi Luigi", sharePercentage: 40 });
    });
    await app.start(street.id, "compare", [key]); await app.waitForIdle();
    await app.start(street.id, "apply", [key]); await app.waitForIdle();
    const crmId = store.read().units[key]!.crmId!;
    expect(store.read().virtualCrm[crmId]!.owners).toHaveLength(2);
    await app.start(street.id, "apply", [key], undefined, { includeCoOwners: false }); await app.waitForIdle();
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    expect(store.read().virtualCrm[crmId]!.owners).toHaveLength(2);
    expect(effectiveSource(store.read().units[key]!).owners).toHaveLength(2);
    const checkpoint = store.read().checkpoints[effectiveSource(store.read().units[key]!).sourcePropertyId]!;
    expect(Object.keys(checkpoint.people)).toHaveLength(1);
  });
  it("riprende un'attività salvata con esito incerto senza duplicarla o cambiare opzioni", async () => {
    const { store, key, directory } = await setup();
    let uncertain = true;
    class UncertainActivity extends SimulationProvider {
      override async port() {
        const port = await super.port(), ensure = port.ensureActivity.bind(port);
        port.ensureActivity = async (...args) => { const result = await ensure(...args); if (uncertain) { uncertain = false; throw new ImportV2Error("Risposta persa dopo attività", "verification_failed"); } return result; };
        return port;
      }
    }
    const app = new TerritoryApplication(store, new UncertainActivity(store, 0));
    const id = await app.start(street.id, "apply", [key], undefined, { activityMode: "plain" }); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", skipped: { [key]: expect.anything() } });
    expect(Object.values(store.read().virtualActivities!)).toHaveLength(1);
    expect(effectiveSource(store.read().units[key]!).activity.enabled).toBe(false);
    const reopened = await TerritoryStore.open(directory, [street]);
    class ChangedCandidates extends SimulationProvider {
      override async candidates(s: Street, source: import("../src/import-v2/model.js").SourceProperty) {
        const result = await super.candidates(s, source);
        return { ...result, rows: [{ ...result.rows[0]!, cadastral: null, id: "incomplete-after-pause" }] };
      }
    }
    const changed = new TerritoryApplication(reopened, new ChangedCandidates(reopened, 0));
    await changed.enqueue([key]); await changed.startQueue([key], { activityMode: "none", includeCoOwners: false }); await changed.waitForIdle();
    expect(reopened.read().runs.at(-1)).toMatchObject({ state: "completed", skipped: { [key]: expect.anything() } });
    expect(Object.keys(reopened.read().checkpoints)).toHaveLength(1);
    expect(changed.quarantineList().some(item => item.origin === "apply")).toBe(true);
    expect(Object.values(reopened.read().virtualActivities!)).toHaveLength(1);
    const second = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    await expect(second.start(street.id, "apply", [key], id)).rejects.toThrow("terminato");
    await second.start(street.id, "scan"); await second.waitForIdle();
    await expect(second.correct(key, { category: "A/2" }, "")).rejects.toThrow("piano originale");
    await second.dequeue([key]); await second.enqueue([key]);
    // A crash may leave the old preview unchanged while the property was written.
    await reopened.change(s => { s.units[key]!.assessment = { ...s.units[key]!.assessment!, kind: "create" }; });
    await second.startQueue([key], { activityMode: "none", includeCoOwners: false, importPolicy: "existing_only" }); await second.waitForIdle();
    expect(reopened.read().runs.at(-1)?.state).toBe("completed");
    expect(reopened.read().runs.at(-1)!.unitSettings![key]).toMatchObject({ activityMode: "plain", includeCoOwners: true, importPolicy: "create_update" });
    expect(reopened.read().runs.at(-1)!.applySources![key]!.activity.enabled).toBe(true);
    const activities = Object.values(reopened.read().virtualActivities!);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.activity.status).toBe("Da eseguire");
  });
  it("rispetta l'attività scelta esplicitamente anche per un immobile dello storico o dei portafogli", async () => {
    const { store, app, key } = await setup();
    await store.change(s => { const observation = s.units[key]!.observations[0]!; observation.historyPropertyId = "old-property"; observation.activityEligible = false; });
    await app.start(street.id, "apply", [key], undefined, { activityMode: "plain" }); await app.waitForIdle();
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    expect(Object.values(store.read().virtualActivities ?? {})).toHaveLength(1);
    expect(store.read().runs.at(-1)?.applySources?.[key]?.activity.enabled).toBe(true);
  });
  it("Killer attiva l'attività di un vecchio piano Nessuna senza modificare dati, intestatari o import policy", async () => {
    const { store, app, key } = await setup();
    const source = effectiveSource(store.read().units[key]!);
    const plan = buildPlan(source);
    await store.change(s => {
      s.checkpoints[source.sourcePropertyId] = { itemId: "old-item", jobId: source.jobId, propertyId: source.sourcePropertyId, stage: "queued", plan, people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: null, attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: new Date().toISOString() };
      s.runs.push({ id: "old-run", streetId: street.id, operation: "apply", origin: "simulation", state: "stopped", startedAt: new Date().toISOString(), endedAt: null, handled: 0, total: 1, itemKeys: [key], error: null, settings: runSettings({ activityMode: "none", includeCoOwners: true }), applySources: { [key]: source } });
    });
    await app.enqueue([key]); expect(app.importQueue().entries[0]!.recovery?.canEnableActivity).toBe(true);
    await app.startQueue([key], { activityMode: "killer", includeCoOwners: false }); await app.waitForIdle();
    const run = store.read().runs.at(-1)!;
    expect(run.unitSettings![key]).toMatchObject({ activityMode: "killer", includeCoOwners: true });
    expect(run.applySources![key]!.owners).toEqual(source.owners);
    expect(Object.values(store.read().virtualActivities!)).toHaveLength(1);
    expect(Object.values(store.read().virtualActivities!)[0]!.activity.status).toBe("Eseguito");
    expect(store.read().checkpoints[source.sourcePropertyId]!.plan!.source.activity.enabled).toBe(true);
  });
  it("un piano con attività inviata non può essere riconvertito come se non fosse mai partito", async () => {
    const { store, key } = await setup(); const source = effectiveSource(store.read().units[key]!);
    const checkpoint = { itemId: "item", jobId: source.jobId, propertyId: source.sourcePropertyId, stage: "verified" as const, plan: buildPlan(source), people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: null, attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: "2026-10-15" };
    expect(canEnableQueuedActivity(checkpoint)).toBe(true);
    expect(canEnableQueuedActivity({ ...checkpoint, activityWrite: { operationId: "item", preparedAt: "2026-10-15", submittedAt: "2026-10-15", baselineIds: [] } })).toBe(false);
    expect(canEnableQueuedActivity({ ...checkpoint, activityEvidence: { activityId: "task", outcome: "existing" } })).toBe(false);
  });
});
