import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider } from "../src/territory/providers.js";
import { effectiveSource, type Street } from "../src/territory/model.js";
import { runSettings } from "../src/territory/run-options.js";
import { ImportV2Error } from "../src/import-v2/errors.js";

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
  it("rifiuta intervalli invertiti, piani mancanti e modalità non supportate", () => {
    expect(() => runSettings({ filters: { minCivicNumber: 10, maxCivicNumber: 2 } })).toThrow("civico finale");
    expect(() => runSettings({ filters: { floorMode: "exact" } })).toThrow("Indica il piano");
    expect(() => runSettings({ filters: { floorValue: 101 } })).toThrow();
    expect(() => runSettings({ activityMode: "killer" })).toThrow();
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
    expect(store.read().runs.at(-1)?.error).toContain("nessuna creazione");
    expect(store.read().runs.at(-1)?.state).toBe("paused");
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
    expect(store.read().runs.at(-1)?.state).toBe("paused");
    expect(Object.values(store.read().virtualActivities!)).toHaveLength(1);
    expect(effectiveSource(store.read().units[key]!).activity.enabled).toBe(false);
    const reopened = await TerritoryStore.open(directory, [street]);
    const second = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    await expect(second.start(street.id, "apply", [key], id, { activityMode: "none" })).rejects.toThrow("opzioni iniziali");
    await expect(second.start(street.id, "apply", [key], undefined, { activityMode: "none" })).rejects.toThrow("run originale");
    await second.start(street.id, "apply", [key], id); await second.waitForIdle();
    expect(reopened.read().runs.at(-1)?.state).toBe("completed");
    const activities = Object.values(reopened.read().virtualActivities!);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.activity.status).toBe("Da eseguire");
  });
  it("esclude dalle attività la rete proprietari e lo storico senza provenienza verificata", async () => {
    const { store, app, key } = await setup();
    await store.change(s => { const observation = s.units[key]!.observations[0]!; observation.historyPropertyId = "old-property"; observation.activityEligible = false; });
    await app.start(street.id, "apply", [key], undefined, { activityMode: "plain" }); await app.waitForIdle();
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    expect(Object.values(store.read().virtualActivities ?? {})).toHaveLength(0);
    expect(store.read().runs.at(-1)?.applySources?.[key]?.activity.enabled).toBe(false);
  });
});
