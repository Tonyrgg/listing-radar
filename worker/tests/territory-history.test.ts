import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adoptHistory, associateHistory, hydrateHistoryProgress, matchHistoricalStreet, resolveRecognizedHistory } from "../src/territory/history.js";
import { exportHistory, historyReadOnlyFetch, historyRows, type HistorySnapshot } from "../src/territory/history-source.js";
import { TerritoryStore } from "../src/territory/store.js";
import { effectiveSource, streetSummary, type Street } from "../src/territory/model.js";
import { lockTerritoryProfile } from "../src/territory/profile-lock.js";
import { buildPlan } from "../src/import-v2/identity.js";
import { importV2Sources } from "../src/import-v2/source.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const street: Street = { id: "20", name: "Via della prova", sisterName: "VIA DELLA PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const snapshot = (): HistorySnapshot => ({ version: 1, readOnly: true, source: "https://example.supabase.co", exportedAt: "2026-10-04T15:00:00Z", skippedJobIds: [], jobs: [{
  job: { id: "job-old", mode: "automatic", status: "completed", current_step: "completed", last_completed_step: "completed", municipality: "BITONTO", street: "Via della prova", civic_number: null, sister_source_url: null, created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T11:00:00Z", completed_at: "2026-08-01T11:00:00Z" },
  graph: { properties: [{ id: "property-old", job_id: "job-old", municipality: "BITONTO", sheet: "49", parcel: "123", subaltern: "4", cadastral_key: "BITONTO|49|123|4", address: "Via della prova 12", census_zone: null, category: "A/3", class: "2", consistency: "4 vani", cadastral_income: 200, processing_status: "completed", crm_record_id: "crm-1", raw_payload: {} }], people: [{ id: "person-old", job_id: "job-old", full_name: "Rossi Mario", birth_place: null, birth_province: null, birth_date: null, tax_code: "RSSMRA80A01A662A", right_type: "Proprietà", share_original: "1/1", share_numerator: 1, share_denominator: 1, share_percentage: 100, mobiles: [], landlines: [], emails: [], raw_payload: null, processing_status: "completed", crm_record_id: "person-crm" }], ownerships: [{ id: "link-old", property_id: "property-old", person_id: "person-old", right_type: "Proprietà", share_percentage: 100 }] },
  items: [{ id: "item-old", property_id: "property-old", stage: "completed", status: "completed", plan: null, checkpoint: { crmPropertyId: "crm-1" }, last_error: null, completed_at: "2026-08-01T11:00:00Z" }], ignoredBusinessRows: [],
}] });
async function setup(streets: Street[] = [street]) { const directory = await mkdtemp(path.join(os.tmpdir(), "territory-history-")); directories.push(directory); return { store: await TerritoryStore.open(directory, streets), directory }; }
describe("Recupero dello storico senza replay delle vecchie scritture", () => {
  it("conserva e recupera l'esclusione delle attività sugli immobili della rete proprietari", async () => {
    const { store } = await setup(); const data = snapshot();
    data.jobs[0]!.graph.properties[0]!.raw_payload = { owner_expansion: { personId: "person-old" } };
    await adoptHistory(store, data);
    const unit = Object.values(store.read().units)[0]!;
    expect(unit.observations[0]!.activityEligible).toBe(false);
    await store.change(s => { delete s.units[unit.key]!.observations[0]!.activityEligible; });
    await store.change(s => hydrateHistoryProgress(s, data));
    expect(store.read().units[unit.key]!.observations[0]!.activityEligible).toBe(false);
  });
  it("una prova d'import precedente non certifica intestatari cambiati nella stessa raccolta", async () => {
    const { store } = await setup(); const data = snapshot(), entry = data.jobs[0]!;
    entry.items[0]!.plan = buildPlan(importV2Sources(entry.job, entry.graph, () => ({ enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" }))[0]!);
    await adoptHistory(store, data);
    expect(streetSummary(store.read(), street).progress.imported).toBe(1);
    entry.graph.people[0]!.full_name = "Intestatario cambiato";
    await adoptHistory(store, data);
    expect(store.read().history![0]!.imported).toBe(0);
    expect(streetSummary(store.read(), street).progress.imported).toBe(0);
    expect(Object.values(store.read().units)[0]!.observations[0]!.importVerified).toBe(true);
  });
  it("associa alla memoria la via ufficiale anche quando SISTER non indica il civico", async () => {
    const { store } = await setup(); const data = snapshot();
    data.jobs[0]!.graph.properties[0]!.address = "VIA DELLA PROVA Piano 1";
    await adoptHistory(store, data);
    expect(store.read().history![0]!.associated).toBe(1);
    expect(store.read().history![0]!.issues).toEqual([]);
  });
  it("riprendere oggi un vecchio import non sovrascrive la sorgente di una raccolta più recente", async () => {
    const { store } = await setup(); const older = snapshot(), newer = snapshot();
    older.jobs[0]!.graph.properties[0]!.raw_payload = {};
    Object.assign(older.jobs[0]!.graph.properties[0]!, { created_at: "2026-08-01T10:00:00Z", updated_at: "2026-10-06T12:00:00Z" });
    const entry = newer.jobs[0]!;
    entry.job = { ...entry.job, id: "new-job", created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T11:00:00Z" };
    entry.graph.properties[0] = { ...entry.graph.properties[0]!, id: "new-property", job_id: "new-job", category: "A/2" };
    entry.graph.people[0] = { ...entry.graph.people[0]!, id: "new-person", job_id: "new-job" };
    entry.graph.ownerships[0] = { ...entry.graph.ownerships[0]!, property_id: "new-property", person_id: "new-person" };
    entry.items = [];
    await adoptHistory(store, newer); await adoptHistory(store, older);
    expect(effectiveSource(Object.values(store.read().units)[0]!).category).toBe("A/2");
    expect(streetSummary(store.read(), street).progress).toMatchObject({ acquisitionRunId: "history:new-job", imported: 0 });
  });
  it("usa l'inventario SISTER intero come denominatore, senza duplicati né immobili di altre vie", async () => {
    const { store } = await setup(); const data = snapshot();
    const inventory = [
      { municipality: "BITONTO", sheet: "49", parcel: "123", subaltern: "4", address: "Via della prova 12", category: "A/3" },
      { municipality: "BITONTO", sheet: "49", parcel: "124", subaltern: "5", address: "Via della prova 14", category: "C/6" },
    ];
    data.jobs[0]!.job.acquisition = { acquisitionCheckpoint: { status: "completed", results: [{ outcome: "found", inventoryProperties: [...inventory, inventory[0]] }] } };
    await adoptHistory(store, data);
    expect(streetSummary(store.read(), street).progress).toMatchObject({ total: 2, imported: 1, percent: 50 });
    expect(Object.values(store.read().units)).toHaveLength(1);
    const repeated = await adoptHistory(store, data); expect(repeated.addedObservations).toBe(0);
    data.jobs[0]!.job.acquisition = { acquisitionCheckpoint: { status: "paused", results: [{ outcome: "failed", inventoryProperties: inventory }] } };
    await adoptHistory(store, data);
    expect(streetSummary(store.read(), street).progress).toMatchObject({ total: null, observed: 2, percent: null });
  });
  it("un portafoglio sviluppato su un'altra via non dimostra un inventario completo per quella via", async () => {
    const other = { ...street, id: "21", name: "Via Laterale", sisterName: "VIA LATERALE" };
    const { store } = await setup([street, other]); const data = snapshot();
    const entry = data.jobs[0]!;
    entry.graph.properties.push({ ...entry.graph.properties[0]!, id: "expanded", parcel: "999", address: "Via Laterale 1" });
    entry.graph.ownerships.push({ ...entry.graph.ownerships[0]!, id: "expanded-link", property_id: "expanded" });
    entry.job.acquisition = { acquisitionCheckpoint: { status: "completed", results: [{ outcome: "found", inventoryProperties: [{ municipality: "BITONTO", sheet: "49", parcel: "123", subaltern: "4", address: "Via della prova 12", category: "A/3" }] }] } };
    await adoptHistory(store, data);
    expect(streetSummary(store.read(), other).progress).toMatchObject({ total: null, observed: 1, percent: null });
  });
  it("aggiorna le vecchie prove dal file locale senza modificare valutazioni e correzioni", async () => {
    const { store, directory } = await setup(); const data = snapshot(); await adoptHistory(store, data);
    const original = store.read(); const unit = Object.values(original.units)[0]!;
    delete unit.observations[0]!.importedAt; delete unit.observations[0]!.crmId; delete unit.observations[0]!.importVerified;
    delete original.history![0]!.acquiredAt; delete original.history![0]!.acquisitionComplete;
    unit.corrections.address = "Confermato a mano";
    await store.replace(original); await writeFile(path.join(directory, "history-snapshot.json"), JSON.stringify(data));
    const reopened = await TerritoryStore.open(directory, [street]); const hydrated = Object.values(reopened.read().units)[0]!;
    expect(hydrated.assessment).toEqual(unit.assessment); expect(hydrated.corrections).toEqual(unit.corrections);
    expect(hydrated.observations).toHaveLength(1);
    expect(streetSummary(reopened.read(), street).progress).toMatchObject({ imported: 1, total: 1, percent: 100 });
    const state = reopened.read(); hydrateHistoryProgress(state, data); expect(state).toEqual(reopened.read());
  });
  it("un import storico senza data non prende la data di aggiornamento o recupero", async () => {
    const { store } = await setup(); const data = snapshot();
    data.jobs[0]!.items[0]!.completed_at = null; data.jobs[0]!.job.completed_at = null;
    await adoptHistory(store, data);
    const progress = streetSummary(store.read(), street).progress;
    expect(progress).toMatchObject({ imported: 1, percent: 100, lastImportedAt: null, tone: "never" });
    expect(Object.values(store.read().units)[0]!.crmId).toBe("crm-1");
  });
  it("recupera dati e prove dell'import ma richiede una verifica attuale del CRM", async () => {
    const { store } = await setup(); const report = await adoptHistory(store, snapshot());
    expect(report).toMatchObject({ jobs: 1, addedObservations: 1, importedEvidence: 1, issues: 0, units: 1 });
    const unit = Object.values(store.read().units)[0]!;
    expect(unit.crmId).toBe("crm-1"); expect(unit.importedAt).toBe("2026-08-01T11:00:00Z");
    expect(unit.assessment?.kind).toBe("unknown");
    expect(store.read().checkpoints).toEqual({}); expect(store.read().runs).toEqual([]);
    expect(store.read().history![0]!.status).toBe("completed");
    expect(streetSummary(store.read(), street)).toMatchObject({ status: "acquired", lastScanAt: null, lastObservationAt: "2026-08-01T10:00:00Z" });
  });
  it("ripetere il recupero conserva lo storico senza duplicare o perdere le correzioni", async () => {
    const { store } = await setup(); await adoptHistory(store, snapshot());
    await store.change(state => { const u = Object.values(state.units)[0]!; u.corrections.address = "Via della prova 14"; u.note = "Conferma umana"; });
    const report = await adoptHistory(store, snapshot());
    const unit = Object.values(store.read().units)[0]!;
    expect(report.addedObservations).toBe(0); expect(unit.observations).toHaveLength(1);
    expect(effectiveSource(unit).fullAddress).toBe("Via della prova 14"); expect(unit.note).toBe("Conferma umana");
    expect(store.read().history).toHaveLength(1); expect(store.read().events).toHaveLength(1);
  });
  it("la fine di un job non prova la fine dell'import di ogni immobile", async () => {
    const { store } = await setup(); const data = snapshot(); data.jobs[0]!.items = [];
    await adoptHistory(store, data);
    expect(Object.values(store.read().units)[0]!.importedAt).toBeNull();
    expect(store.read().history![0]!.imported).toBe(0);
  });
  it("un import concluso dopo la prima esportazione aggiorna le prove, senza replay", async () => {
    const { store } = await setup(); const data = snapshot(); data.jobs[0]!.items[0]!.stage = "property_synced";
    await adoptHistory(store, data); expect(Object.values(store.read().units)[0]!.importedAt).toBeNull();
    await adoptHistory(store, snapshot());
    expect(Object.values(store.read().units)[0]!.importedAt).toBe("2026-08-01T11:00:00Z");
    expect(Object.values(store.read().units)[0]!.observations).toHaveLength(1);
  });
  it("non fonde Codvia omonimi; un'associazione esplicita può risolverli", async () => {
    const { store } = await setup([street, { ...street, id: "21" }]);
    expect((await adoptHistory(store, snapshot())).issues).toBe(1);
    expect(Object.keys(store.read().units)).toHaveLength(0);
    expect((await adoptHistory(store, snapshot(), { "property-old": "21" })).issues).toBe(0);
    expect(Object.values(store.read().units)[0]!.streetIds).toEqual(["21"]);
  });
  it("un'associazione manuale resta valida alla successiva importazione dello storico", async () => {
    const { store } = await setup([street, { ...street, id: "21" }]);
    await adoptHistory(store, snapshot()); await associateHistory(store, "property-old", "21");
    expect(store.read().history![0]!.issues).toHaveLength(0);
    await adoptHistory(store, snapshot());
    expect(store.read().history![0]!.issues).toHaveLength(0);
    expect(Object.values(store.read().units)[0]!.streetIds).toEqual(["21"]);
    expect(Object.values(store.read().units)[0]!.observations).toHaveLength(1);
  });
  it("gli immobili sviluppati dal portafoglio appartengono alla loro via effettiva", async () => {
    const other = { ...street, id: "22", name: "Via diversa", sisterName: "VIA DIVERSA" };
    const { store } = await setup([street, other]); const data = snapshot(); data.jobs[0]!.graph.properties[0]!.address = "Via diversa 2";
    await adoptHistory(store, data);
    expect(Object.values(store.read().units)[0]!.streetIds).toEqual(["22"]);
  });
  it("conserva le quote del collegamento e segnala i proprietari mancanti", async () => {
    const { store } = await setup(); const data = snapshot(); data.jobs[0]!.graph.ownerships[0]!.share_percentage = null;
    await adoptHistory(store, data);
    expect(Object.values(store.read().units)[0]!.observations[0]!.source.acquisitionError).toContain("Quota");
    expect(Object.values(store.read().units)[0]!.observations[0]!.source.owners[0]!.sharePercentage).toBeNull();
  });
  it("una lettura storica più vecchia non sostituisce una lettura recente del laboratorio", async () => {
    const { store } = await setup(); await adoptHistory(store, snapshot());
    await store.change(state => { const u = Object.values(state.units)[0]!; u.observations.push({ ...u.observations[0]!, historyPropertyId: undefined, historyRevision: undefined, at: "2026-09-01T10:00:00Z", runId: "new-run", source: { ...u.observations[0]!.source, fullAddress: "Via della prova 30", sourcePropertyId: "new-source" } }); u.sourceVersionId = "new-source"; });
    const data = snapshot(); data.jobs[0]!.graph.properties[0]!.address = "Via della prova 16";
    await adoptHistory(store, data);
    expect(effectiveSource(Object.values(store.read().units)[0]!).fullAddress).toBe("Via della prova 30");
    expect(Object.values(store.read().units)[0]!.observations).toHaveLength(3);
  });
});
describe("Identificazione della via nello storico SISTER", () => {
  function source(address: string) {
    const data = snapshot(), entry = data.jobs[0]!;
    return { ...importV2Sources(entry.job, entry.graph, () => ({ enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" }))[0]!, fullAddress: address };
  }
  it("riconosce civici con suffissi numerici, senza allargare l'identità CRM", async () => {
    const { store } = await setup(); const data = snapshot();
    data.jobs[0]!.graph.properties[0]!.address = "Via della prova n. 110/13 Piano 1";
    expect((await adoptHistory(store, data)).issues).toBe(0);
    expect(effectiveSource(Object.values(store.read().units)[0]!).fullAddress).toBe("Via della prova n. 110/13 Piano 1");
    expect((await adoptHistory(store, data)).addedObservations).toBe(0);
  });
  it("separa il lotto e i dettagli dall'indirizzo della via", () => {
    expect(matchHistoricalStreet(source("Via della prova n. SNC Lotto 1 Scala A Piano 1-2"), [street])).toEqual([street]);
  });
  it("non sceglie un Codvia quando il nome è duplicato", () => {
    const homonym = { ...street, id: "21" };
    expect(matchHistoricalStreet(source("Via della prova n. 110/13 Piano 1"), [street, homonym])).toEqual([street, homonym]);
  });
  it("conserva i numeri che fanno parte del nome di una traversa", () => {
    const traverse = { ...street, name: "Traversa al numero 126 di via Palombaio", sisterName: "TRAVERSA AL NUMERO 126 DI VIA PALOMBAIO" };
    expect(matchHistoricalStreet(source("TRAVERSA AL NUMERO 126 DI VIA PALOMBAIO n. 4 Piano 4"), [street, traverse])).toEqual([traverse]);
  });
  it("non associa indirizzi multipli alla sola ultima via", () => {
    expect(matchHistoricalStreet(source("Via diversa n. 49; Via della prova n. 11 Piano T"), [street])).toEqual([]);
  });
  it("all'apertura recupera righe già conservate, con prove e date originali", async () => {
    const { store, directory } = await setup([]);
    await adoptHistory(store, snapshot());
    expect(store.read().history![0]!.issues).toHaveLength(1);
    const reopened = await TerritoryStore.open(directory, [street]);
    const state = reopened.read(), unit = Object.values(state.units)[0]!;
    expect(state.history![0]).toMatchObject({ associated: 1, issues: [] });
    expect(unit.observations[0]).toMatchObject({ at: "2026-08-01T10:00:00Z", importedAt: "2026-08-01T11:00:00Z", crmId: "crm-1", importVerified: true });
    expect(resolveRecognizedHistory(state)).toBe(0);
    expect(state.runs).toHaveLength(0);
    expect(state.checkpoints).toEqual({});
  });
  it("il recupero lascia gli omonimi in revisione e conserva le scelte manuali", async () => {
    const { store } = await setup([street, { ...street, id: "21" }]);
    await adoptHistory(store, snapshot());
    let state = store.read(); expect(resolveRecognizedHistory(state)).toBe(0);
    state.historicalStreetMappings = { "property-old": "21" };
    expect(resolveRecognizedHistory(state)).toBe(1);
    expect(Object.values(state.units)[0]!.streetIds).toEqual(["21"]);
    expect(state.historicalStreetMappings).toEqual({ "property-old": "21" });
  });
  it("attende gli import parziali prima di recuperare associazioni", async () => {
    const { store } = await setup([]); await adoptHistory(store, snapshot());
    const state = store.read(); state.streets = [street];
    state.checkpoints["partial"] = { stage: "property_synced" } as any;
    expect(resolveRecognizedHistory(state)).toBe(0);
    expect(state.history![0]!.issues).toHaveLength(1);
  });
});
describe("Sicurezza della lettura e del profilo", () => {
  it("blocca POST, PATCH e DELETE prima della rete", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]")); const guarded = historyReadOnlyFetch(fetcher);
    for (const method of ["POST", "PATCH", "DELETE"]) await expect(guarded("https://example.test", { method })).rejects.toThrow("GET/HEAD");
    expect(fetcher).not.toHaveBeenCalled(); await guarded("https://example.test"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("legge anche oltre il limite di pagina senza perdere righe", async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const client = { from: () => ({ select: () => ({ order: () => ({ range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), error: null }) }) }) }) } as unknown as SupabaseClient;
    expect(await historyRows(client, "test")).toHaveLength(1201);
  });
  it("salta un job modificato durante la lettura dello storico", async () => {
    const job = snapshot().jobs[0]!.job; let jobReads = 0;
    const client = { from: (table: string) => {
      const query = { select: () => query, order: () => query, range: () => query, eq: () => query,
        then: (resolve: (result: unknown) => unknown) => resolve({ error: null, data: table === "property_worker_jobs" ? [{ ...job, updated_at: ++jobReads === 1 ? "2026-08-01T10:00:00Z" : "2026-08-01T11:00:00Z" }] : [] }) };
      return query;
    } } as unknown as SupabaseClient;
    const result = await exportHistory(client, "https://example.test");
    expect(result.jobs).toHaveLength(0); expect(result.skippedJobIds).toEqual([job.id]);
  });
  it("il laboratorio e l'importatore non possono scrivere lo stesso profilo insieme", async () => {
    const { directory } = await setup(); const release = lockTerritoryProfile(directory);
    try { expect(() => lockTerritoryProfile(directory)).toThrow("Chiudi il laboratorio"); } finally { release(); }
    const second = lockTerritoryProfile(directory); second();
    await writeFile(path.join(directory, "territory-writer.lock"), JSON.stringify({ pid: 2147483647, token: "expired" }));
    const recovered = lockTerritoryProfile(directory); recovered();
  });
});
