import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { SisterStreetRun } from "../src/services/sister-street-run.js";
import { runStreetRegistrySequence } from "../src/services/street-registry-sequence.js";
import { ImportV2Engine } from "../src/import-v2/engine.js";
import { runImportV2Batch } from "../src/import-v2/queue.js";
import { importV2Sources, type AcquiredGraph } from "../src/import-v2/source.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import { addAcquired, installSisterFixture, WorkflowMemoryStore, WorkflowUiFixture } from "./helpers/import-v2-workflow-fixture.js";

describe("Collaudo locale acquisizione → Import V2 → rilettura CRM", () => {
  it.each(["via completa", "rete proprietari"])("%s: CF assente, creazione, merge verde, immobile esistente e ripresa", async mode => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const crmPage = await browser.newPage();
      const fixture = new WorkflowUiFixture();
      fixture.seedProperty("VIA SECONDA", "216");
      await fixture.install(crmPage);
      const store = new WorkflowMemoryStore();
      const imported: string[] = [];
      const sources = [] as ReturnType<typeof importV2Sources>;
      const runStreet = async (street: string, parcel: string) => {
        const sisterPage = await browser.newPage();
        try {
          await installSisterFixture(sisterPage, street, parcel);
          const jobId = `job-${parcel}`;
          const graph: AcquiredGraph = { properties: [], people: [], ownerships: [] };
          const checkpoint = await new SisterStreetRun(sisterPage, {
            acquireOwners: true, strategy: "bulk_exact_variants", mode: "live", importJobId: jobId,
            onPropertyAcquired: (_variant, property, owners) => addAcquired(graph, jobId, property, owners),
          }).run(street);
          expect(checkpoint).toMatchObject({ status: "completed", totalAcceptedProperties: 1, totalOwnersRead: 1 });
          const currentSources = importV2Sources({ id: jobId }, graph, () => ({
            enabled: true, description: "Contatto proprietari", contactMode: "Contatto diretto", status: "Eseguito",
          }));
          sources.push(...currentSources);
          if (parcel === "216" && fixture.person) {
            fixture.person.Nome = "MARIO";
            fixture.person.Cognome = "ROSSI";
            fixture.person["Telefono fisso"] = "0801111111";
          }
          // Desktop starts a fresh worker/port for each acquired street.
          const result = await runImportV2Batch(new ImportV2Engine(new TecnocloudUiV2Port(crmPage), store, { maxTransientAttempts: 1 }), currentSources);
          expect(result.paused, JSON.stringify(store.failures)).toBeNull();
          expect(result.quarantined, JSON.stringify(store.failures)).toEqual([]);
          expect(result.completed).toHaveLength(1);
          imported.push(street);
        } finally { await sisterPage.close(); }
      };
      if (mode === "via completa") {
        await runStreet("VIA GUIDONE", "215");
        await runStreet("VIA SECONDA", "216");
      } else {
        const queue = [{ street: "VIA GUIDONE", parcel: "215" }, { street: "VIA SECONDA", parcel: "216" }];
        let pending: Promise<void> | null = null;
        let claimed = 0;
        expect(await runStreetRegistrySequence({
          isCancelled: () => false,
          next: async () => {
            expect(imported).toHaveLength(claimed);
            const claim = queue.shift() ?? null;
            if (claim) { claimed++; pending = runStreet(claim.street, claim.parcel); }
            return claim;
          },
          onClaim: async () => {}, waitForStreet: async () => { await pending; },
          outcome: () => "completed", onFinished: async () => {},
        })).toBe("exhausted");
      }
      expect(imported).toEqual(["VIA GUIDONE", "VIA SECONDA"]);
      expect(fixture.person).toMatchObject({ Nome: "Mario", Cognome: "Rossi", Cellulare: "3331111111", "Telefono fisso": "0801111111", Email: "mario@example.it" });
      expect(fixture.writes.filter(w => w === "person:create")).toHaveLength(1);
      expect(fixture.writes.filter(w => w === "person:update")).toHaveLength(1);
      expect(fixture.writes.filter(w => w === "property:create")).toHaveLength(1);
      expect(fixture.writes.filter(w => w === "activity:create")).toHaveLength(2);
      expect(fixture.properties).toHaveLength(2);
      expect(fixture.searches).toContainEqual(["", "38", "216", "17"]);
      expect(fixture.searches.some(values => values[0]?.includes("SECONDA"))).toBe(false);
      // A restarted engine and UI adapter must honor the durable completed checkpoints.
      const writes = [...fixture.writes];
      const resumed = await runImportV2Batch(new ImportV2Engine(new TecnocloudUiV2Port(crmPage), store), sources);
      expect(resumed.completed).toHaveLength(2);
      expect(fixture.writes).toEqual(writes);
      expect(fixture.errors).toEqual([]);
    } finally { await browser.close(); }
  }, 90_000);

  it("una ricerca CF fallita ferma il batch sul primo immobile, senza scartare i successivi", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const sister = await browser.newPage();
      const fixture = new WorkflowUiFixture();
      fixture.failSearch = true;
      await fixture.install(page);
      await installSisterFixture(sister, "VIA GUIDONE", "215");
      const graph: AcquiredGraph = { properties: [], people: [], ownerships: [] };
      await new SisterStreetRun(sister, {
        onPropertyAcquired: (_v, property, owners) => addAcquired(graph, "job", property, owners),
      }).run("VIA GUIDONE");
      const [source] = importV2Sources({ id: "job" }, graph, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }));
      const store = new WorkflowMemoryStore();
      const result = await runImportV2Batch(new ImportV2Engine(new TecnocloudUiV2Port(page), store), [source!, { ...source!, sourcePropertyId: "next" }]);
      expect(result).toMatchObject({ completed: [], quarantined: [], paused: { propertyId: source!.sourcePropertyId, stage: "planned" } });
      expect(store.checkpoints.has("next")).toBe(false);
      expect(fixture.writes).toEqual([]);
    } finally { await browser.close(); }
  }, 20_000);

  it("la ricerca catastale lenta legge l'immobile già presente prima di allargare alla via", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const sister = await browser.newPage();
      const fixture = new WorkflowUiFixture();
      fixture.seedProperty("VIA GUIDONE", "215");
      fixture.propertySearchDelay = 3200;
      await fixture.install(page);
      await installSisterFixture(sister, "VIA GUIDONE", "215");
      const graph: AcquiredGraph = { properties: [], people: [], ownerships: [] };
      await new SisterStreetRun(sister, {
        onPropertyAcquired: (_v, property, owners) => addAcquired(graph, "job", property, owners),
      }).run("VIA GUIDONE");
      const [source] = importV2Sources({ id: "job" }, graph, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }));
      const found = await new TecnocloudUiV2Port(page).findPropertiesByCadastralIdentity({ version: 2, fingerprint: "fixture", source: source! });
      expect(found.map(p => p.id)).toEqual(["p-215"]);
      expect(fixture.searches).toEqual([["", "38", "215", "17"]]);
      expect(fixture.writes).toEqual([]);
    } finally { await browser.close(); }
  }, 15_000);

  it("riprende dopo il salvataggio del nominativo senza ricrearlo né riscriverlo", async () => {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    try {
      const page = await browser.newPage();
      const sister = await browser.newPage();
      const fixture = new WorkflowUiFixture();
      fixture.failPropertySearch = true;
      await fixture.install(page);
      await installSisterFixture(sister, "VIA GUIDONE", "215");
      const graph: AcquiredGraph = { properties: [], people: [], ownerships: [] };
      await new SisterStreetRun(sister, {
        onPropertyAcquired: (_v, property, owners) => addAcquired(graph, "job", property, owners),
      }).run("VIA GUIDONE");
      const sources = importV2Sources({ id: "job" }, graph, () => ({ enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" }));
      const store = new WorkflowMemoryStore();
      const stopped = await runImportV2Batch(new ImportV2Engine(new TecnocloudUiV2Port(page), store), sources);
      expect(stopped).toMatchObject({ completed: [], quarantined: [], paused: { stage: "people_synced" } });
      expect(fixture.writes).toEqual(["person:create"]);
      fixture.failPropertySearch = false;
      const resumed = await runImportV2Batch(new ImportV2Engine(new TecnocloudUiV2Port(page), store), sources);
      expect(resumed.paused, JSON.stringify(store.failures)).toBeNull();
      expect(resumed.quarantined, JSON.stringify(store.failures)).toEqual([]);
      expect(resumed.completed).toHaveLength(1);
      expect(fixture.writes.filter(w => w.startsWith("person:"))).toEqual(["person:create"]);
      expect(fixture.properties).toHaveLength(1);
    } finally { await browser.close(); }
  }, 50_000);
});
