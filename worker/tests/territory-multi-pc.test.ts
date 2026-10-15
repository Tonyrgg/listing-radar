import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritorySync, territoryDigest, type TerritorySyncConfig } from "../src/territory/sync.js";
import { diffRecords, mergeTerritory, recordsState, resolveSyncConflict, syncRecords, type SyncRecord } from "../src/territory/sync-records.js";
import { TerritorySyncLoop } from "../src/territory/sync-loop.js";
import { simulationSource } from "../src/territory/providers.js";
import { ensureMemoryUnit, appendUnitEvent } from "../src/territory/unit-memory.js";
import { unitKey, type Street, type TerritoryState } from "../src/territory/model.js";

const config: TerritorySyncConfig = { url: "https://approved.supabase.co", key: "test-only", workspaceId: "fd2503de-cf17-4ed5-bac1-65a5c6d269ce", ownerId: "be0e3d14-4b90-41b9-83b5-43a683fc2523", profileKind: "live", environment: "online" };
const street: Street = { id: "123", name: "Via Michele Tatulli", sisterName: "VIA MICHELE TATULLI", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function server() {
  let state: TerritoryState | undefined, revision = 0;
  const versions = new Map<string, { row: SyncRecord; revision: number }>();
  let fail = false, loseReply = false, casConflict = false;
  let duringSave: (() => Promise<void>) | undefined;
  const payloads: { name: string; bytes: number; count: number; since?: number }[] = [];
  const client = { rpc: async (name: string, args: Record<string, any>) => {
    if (fail) return { error: { code: "NETWORK" }, data: null };
    if (name === "read_territory_workspace_changes") {
      const rows = [...versions.values()].filter(v => v.revision > args.p_since).map(v => v.row);
      payloads.push({ name, bytes: JSON.stringify(rows).length, count: rows.length, since: args.p_since });
      return { data: { revision, changes: structuredClone(rows) }, error: null };
    }
    if (duringSave) { const fn = duringSave; duringSave = undefined; await fn(); }
    if (casConflict) { casConflict = false; return { error: { code: "40001" }, data: null }; }
    if (args.p_expected_revision !== revision) return { error: { code: "40001" }, data: null };
    const records = state ? syncRecords(state) : new Map<string, SyncRecord>();
    const changes = name === "save_territory_lab_workspace" ? [...syncRecords(args.p_state).values()] : args.p_changes as SyncRecord[];
    revision++;
    for (const row of changes) { const key = JSON.stringify([row.collection, row.key]); versions.set(key, { row: structuredClone(row), revision }); if (row.deleted) records.delete(key); else records.set(key, structuredClone(row)); }
    state = recordsState(records);
    payloads.push({ name, bytes: JSON.stringify(changes).length, count: changes.length });
    if (loseReply) { loseReply = false; return { data: null, error: { code: "NETWORK" } }; }
    return { data: revision, error: null };
  } } as unknown as SupabaseClient;
  return { client, payloads, state: () => structuredClone(state!), revision: () => revision, fail: (v: boolean) => { fail = v; }, loseReply: () => { loseReply = true; }, conflict: () => { casConflict = true; }, duringSave: (fn: () => Promise<void>) => { duringSave = fn; } };
}
async function pc(remote: ReturnType<typeof server>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "worker-multi-pc-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  const sync = new TerritorySync(store, directory, config, remote.client, config.url);
  return { directory, store, sync };
}
const source = (index: number) => simulationSource(street, index, `source-${index}`);
async function acquire(store: TerritoryStore, index: number) {
  const item = source(index);
  await store.change(s => { const u = ensureMemoryUnit(s, item, "2026-10-15T12:00:00Z", `scan-${index}`); u.observations[0]!.origin = "sister"; u.streetIds = [street.id]; });
  return unitKey(item);
}

it("riunisce gli archivi preesistenti di due PC e propaga Tatulli senza perdere note e successi", async () => {
  const remote = server(), a = await pc(remote), b = await pc(remote);
  await acquire(a.store, 1); const key = await acquire(b.store, 2);
  await b.store.change(s => { s.units[key]!.importedAt = "2026-10-15T12:01:00Z"; s.units[key]!.crmId = "crm-import-success"; s.memories[street.id]!.note = "Nota ufficio 2"; });
  await a.sync.reconcile(); await b.sync.reconcile(); await a.sync.reconcile();
  expect(a.store.read().units[key]).toMatchObject({ crmId: "crm-import-success", importedAt: "2026-10-15T12:01:00Z" });
  expect(Object.keys(a.store.read().units)).toHaveLength(2);
  expect(a.store.read().memories[street.id]!.note).toBe("Nota ufficio 2");
  expect(Object.values(a.store.read().syncConflicts ?? {})).toHaveLength(0);
  expect(territoryDigest(a.store.read())).toBe(territoryDigest(b.store.read()));
  expect(await readdir(b.directory)).toContain("territory-ledger.json.before-shared-recovery.json");
  const before = remote.revision(); await a.sync.reconcile(); await b.sync.reconcile(); expect(remote.revision()).toBe(before);
  expect(remote.payloads.at(-1)).toMatchObject({ count: 0, bytes: 2 });
});

it("trasferisce solo record modificati, riceve le rimozioni e non riscrive la rete invariata", async () => {
  const remote = server(), a = await pc(remote), b = await pc(remote);
  const key = await acquire(a.store, 1); await a.sync.reconcile(); await b.sync.reconcile();
  await a.store.change(s => { s.importQueue = { [key]: { id: "entry", key, streetId: street.id, addedAt: "2026-10-15T12:03:00Z" } }; });
  await a.sync.reconcile(); await b.sync.reconcile(); expect(b.store.read().importQueue?.[key]?.id).toBe("entry");
  const uploaded = remote.payloads.filter(p => p.name === "save_territory_workspace_changes").at(-1)!;
  expect(uploaded.count).toBe(1);
  await b.store.change(s => { delete s.importQueue![key]; }); await b.sync.reconcile(); await a.sync.reconcile();
  expect(a.store.read().importQueue).toEqual({});
  expect(remote.payloads.filter(p => p.name === "read_territory_workspace_changes").at(-1)?.count).toBe(1);
});

it("sincronizza durante la run e non perde un successo registrato mentre la rete risponde", async () => {
  const remote = server(), a = await pc(remote), b = await pc(remote);
  const key = await acquire(a.store, 1); await a.sync.reconcile(); await b.sync.reconcile();
  await a.store.change(s => { s.runs.push({ deviceId: a.store.deviceId, id: "running", streetId: street.id, operation: "apply", origin: "live", state: "running", startedAt: "2026-10-15T12:00:00Z", endedAt: null, handled: 0, total: 1, itemKeys: [key], error: null }); });
  remote.duringSave(async () => { await a.store.change(s => { s.units[key]!.importedAt = "2026-10-15T12:05:00Z"; s.units[key]!.crmId = "success"; }); });
  await a.sync.reconcile(); expect(a.store.read().units[key]!.crmId).toBe("success");
  expect((await a.sync.status()).pending).toBe(true);
  await a.sync.reconcile(); await b.sync.reconcile();
  expect(b.store.read().units[key]!.crmId).toBe("success");
  expect(b.store.read().runs[0]).toMatchObject({ state: "running", deviceId: a.store.deviceId });
  const reopened = await TerritoryStore.open(b.directory, [street]); expect(reopened.read().runs[0]!.state).toBe("running");
  const ownerReopened = await TerritoryStore.open(a.directory, [street]); expect(ownerReopened.read().runs[0]!.state).toBe("stopped");
});

it("ritenta CAS e risposte perse; offline conserva i dati e alla riapertura converge", async () => {
  const remote = server(), a = await pc(remote), b = await pc(remote);
  await a.sync.reconcile(); await b.sync.reconcile();
  remote.fail(true); const key = await acquire(b.store, 1);
  await expect(b.sync.reconcile()).rejects.toThrow("conservati");
  remote.fail(false); remote.conflict(); remote.loseReply();
  await expect(b.sync.reconcile()).rejects.toThrow("non confermato");
  const revision = remote.revision(); await b.sync.reconcile(); await a.sync.reconcile();
  expect(remote.revision()).toBe(revision); expect(a.store.read().units[key]).toBeDefined();
  const reopened = await TerritoryStore.open(b.directory, [street]);
  await new TerritorySync(reopened, b.directory, config, remote.client, config.url).reconcile();
  expect(remote.revision()).toBe(revision);
  expect(JSON.parse(await readFile(path.join(b.directory, "sync-state-online.json"), "utf8")).baseline.units[key]).toBeDefined();
});

it("conserva entrambe le note concorrenti, sincronizza gli altri dati e condivide la risoluzione", async () => {
  const remote = server(), a = await pc(remote), b = await pc(remote);
  await a.sync.reconcile(); await b.sync.reconcile();
  await a.store.change(s => { s.memories[street.id]!.note = "Ufficio 1"; });
  await b.store.change(s => { s.memories[street.id]!.note = "Ufficio 2"; });
  const key = await acquire(b.store, 1);
  await a.sync.reconcile(); await b.sync.reconcile(); await a.sync.reconcile();
  expect(a.store.read().units[key]).toBeDefined();
  const conflicts = (await a.sync.status()).conflicts; expect(conflicts).toHaveLength(1);
  expect(new Set(conflicts[0]!.values)).toEqual(new Set(["Ufficio 1", "Ufficio 2"]));
  await a.store.change(s => resolveSyncConflict(s, conflicts[0]!.id, 0));
  await a.sync.reconcile(); await b.sync.reconcile();
  expect((await b.sync.status()).conflicts).toHaveLength(0);
  expect(b.store.read().memories[street.id]!.note).toBe(conflicts[0]!.values[0]);
});

it("l'unione conserva cronologia, verifica più recente e non resuscita un'iscrizione rimossa offline", async () => {
  const remote = server(), a = await pc(remote);
  const key = await acquire(a.store, 1), local = a.store.read(), other = structuredClone(local);
  local.importQueue = { [key]: { id: "old-entry", key, streetId: street.id, addedAt: "2026-10-15T12:00:00Z" } };
  appendUnitEvent(other.units[key]!, ["old-entry", "removed"], { at: "2026-10-15T13:00:00Z", runId: "manual", kind: "queue_removed", origin: "live", message: "Removed" });
  other.units[key]!.observations.push({ ...other.units[key]!.observations[0]!, at: "2026-10-15T14:00:00Z", runId: "new-scan" });
  const merged = mergeTerritory(undefined, local, other);
  expect(merged.importQueue).toEqual({}); expect(merged.units[key]!.observations).toHaveLength(2);
  expect(diffRecords(recordsState(syncRecords(merged)), merged)).toHaveLength(0);
});

it("polling inattivo, azioni continue e chiusura non accavallano gli scambi", async () => {
  vi.useFakeTimers(); let resolve: (() => void) | undefined;
  const exchange = vi.fn(async () => { if (exchange.mock.calls.length === 2) await new Promise<void>(r => { resolve = r; }); });
  const loop = new TerritorySyncLoop(exchange);
  await loop.flush(); expect(exchange).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 15; i++) { loop.changed(); await vi.advanceTimersByTimeAsync(100); }
  expect(exchange).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(20000); expect(exchange).toHaveBeenCalledTimes(2);
  resolve!(); await vi.advanceTimersByTimeAsync(15000); expect(exchange).toHaveBeenCalledTimes(3);
  await loop.close(); expect(exchange).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(30000); expect(exchange).toHaveBeenCalledTimes(4);
});

it("unisce aggiunte e rimozioni indipendenti ai gruppi di vie senza resuscitare la vecchia selezione", async () => {
  const remote = server(), a = await pc(remote);
  const base = a.store.read(); base.zones = { z: { id: "z", name: "Centro", streetIds: ["one", "two"], updatedAt: "2026-10-01" } };
  const local = structuredClone(base), other = structuredClone(base);
  local.zones!.z!.streetIds = ["two"]; other.zones!.z!.streetIds = ["one", "two", "three"];
  expect(mergeTerritory(base, local, other).zones!.z!.streetIds).toEqual(["three", "two"]);
  base.importQueue = { k: { id: "old", key: "k", streetId: street.id, addedAt: "2026-10-01" } };
  local.importQueue = {}; other.importQueue = { k: { id: "new", key: "k", streetId: street.id, addedAt: "2026-10-15" } };
  expect(mergeTerritory(base, local, other).importQueue!.k!.id).toBe("new");
  expect(mergeTerritory(base, other, local).importQueue!.k!.id).toBe("new");
});

it("mantiene l'ultima verifica positiva anche quando l'altra postazione ha una lettura negativa più recente", async () => {
  const remote = server(), a = await pc(remote), base = a.store.read();
  base.cloudMemory = { properties: {}, people: {} };
  const local = structuredClone(base), other = structuredClone(base);
  local.cloudMemory!.people.CF = { crmIds: [], status: "not_found", lastCheckedAt: "2026-10-15T12:00:00Z", lastVerifiedAt: null };
  other.cloudMemory!.people.CF = { crmIds: ["person-id"], status: "found", lastCheckedAt: "2026-10-14T12:00:00Z", lastVerifiedAt: "2026-10-14T12:00:00Z" };
  expect(mergeTerritory(base, local, other).cloudMemory!.people.CF).toEqual({ ...local.cloudMemory!.people.CF, crmIds: ["person-id"], lastVerifiedAt: "2026-10-14T12:00:00Z" });
});

it("una memoria Cloud vuota dopo la prima acquisizione non lascia modifiche pendenti permanenti", async () => {
  const remote = server(), a = await pc(remote);
  await a.sync.reconcile(); await acquire(a.store, 1);
  await a.store.change(s => { s.cloudMemory = { properties: {}, people: {} }; });
  await a.sync.reconcile(); await a.sync.reconcile();
  expect((await a.sync.status()).pending).toBe(false);
  const prior = remote.revision(); await a.sync.reconcile(); expect(remote.revision()).toBe(prior);
});

it("conserva le due geometrie confermate in conflitto per una scelta esplicita", async () => {
  const remote = server(), a = await pc(remote), base = a.store.read();
  const local = structuredClone(base), other = structuredClone(base);
  local.networkBindings = { n: { officialId: street.id, confirmedAt: "2026-10-15", geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } } };
  other.networkBindings = { n: { officialId: street.id, confirmedAt: "2026-10-15", geometry: { type: "LineString", coordinates: [[5, 6], [7, 8]] } } };
  const merged = mergeTerritory(base, local, other);
  // Geometry is one confirmed object: coordinates must never be unioned into a new route.
  expect(merged.networkBindings!.n!.geometry).toEqual(other.networkBindings.n!.geometry);
  expect(Object.values(merged.syncConflicts!)).toHaveLength(1);
  expect(Object.values(merged.syncConflicts!)[0]!.values).toHaveLength(2);
});
