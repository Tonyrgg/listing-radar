import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritorySync, localSyncConfig, onlineSyncConfig, territoryDigest, type TerritorySyncConfig } from "../src/territory/sync.js";
import type { Street, TerritoryState } from "../src/territory/model.js";

const config: TerritorySyncConfig = { url: "http://127.0.0.1:54321", key: "local-test-only", workspaceId: "fd2503de-cf17-4ed5-bac1-65a5c6d269ce", ownerId: "be0e3d14-4b90-41b9-83b5-43a683fc2523", profileKind: "simulation" };
const street: Street = { id: "123", name: "Via di prova", sisterName: "VIA DI PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-sync-test-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  let remote: { id: string; owner_id: string; profile_kind: string; revision: number; state: TerritoryState } | null = null;
  let uncertain = false, conflict = false, calls = 0;
  let beforeRead: (() => Promise<void>) | undefined;
  const client = {
    from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => { if (beforeRead) await beforeRead(); return { data: structuredClone(remote), error: null }; } }; return query; },
    rpc: async (_: string, args: Record<string, unknown>) => {
      calls++;
      if (conflict || (remote?.revision ?? 0) !== args.p_expected_revision) return { data: null, error: { code: "40001" } };
      remote = { id: config.workspaceId, owner_id: config.ownerId, profile_kind: config.profileKind, revision: (remote?.revision ?? 0) + 1, state: structuredClone(args.p_state as TerritoryState) };
      return uncertain ? { data: null, error: { code: "NETWORK" } } : { data: remote.revision, error: null };
    }
  } as unknown as SupabaseClient;
  const sync = new TerritorySync(store, directory, config, client);
  return { store, directory, sync, remote: () => remote!, calls: () => calls, uncertain: () => { uncertain = true; }, conflict: () => { conflict = true; }, beforeRead: (f: () => Promise<void>) => { beforeRead = f; } };
}
describe("Memoria Territorio separata, revisioni e recupero", () => {
  it("recupera uno storico precedente al setup mantenendo i nuovi dossier della rete", async () => {
    const t = await setup(); await t.sync.push();
    t.remote().revision++;
    t.remote().state.memories[street.id]!.note = "Storico remoto";
    const network: Street = { ...street, id: "network:10", name: "Via della rete", catalogKind: "network" };
    const fresh = await TerritoryStore.open(t.directory, [street, network]);
    const client = { from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: structuredClone(t.remote()), error: null }) }; return query; } } as unknown as SupabaseClient;
    // No baseline: a fresh device has empty dossiers but no local work to lose.
    const directory = await mkdtemp(path.join(os.tmpdir(), "territory-sync-new-network-")); directories.push(directory);
    const receiving = await TerritoryStore.open(directory, fresh.read().streets);
    const registeredAt = receiving.read().memories[network.id]!.registeredAt;
    const sync = new TerritorySync(receiving, directory, config, client);
    expect(await sync.pull()).toEqual({ revision: 2, changed: true });
    expect(receiving.read().memories[network.id]!.registeredAt).toBe(registeredAt);
    expect(receiving.read().streets.map(s => s.id)).toContain(network.id);
    expect(receiving.read().memories[network.id]!.registeredAt).toBeTruthy();
    expect(receiving.read().memories[street.id]!.note).toBe("Storico remoto");
    expect(await sync.pull()).toEqual({ revision: 2, changed: true });
  });
  it("rifiuta URL remoti e configurazioni che potrebbero raggiungere produzione", () => {
    for (const url of ["https://example.supabase.co", "http://127.0.0.1:54321/rest", "http://127.0.0.1:54321?redirect=x", "http://user@localhost:54321"]) expect(() => localSyncConfig({ ...config, url })).toThrow();
    expect(localSyncConfig(config)).toEqual(config);
    expect(territoryDigest({ b: 1, a: { d: 2, c: 3 } })).toBe(territoryDigest({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("carica con revisione atomica e non riscrive dati identici", async () => {
    const t = await setup();
    expect(await t.sync.push()).toEqual({ revision: 1, changed: true });
    expect(await t.sync.push()).toEqual({ revision: 1, changed: false });
    await t.store.change(s => { s.memories[street.id] = { note: "Valore confermato", attention: true, updatedAt: new Date().toISOString() }; });
    expect(await t.sync.push()).toEqual({ revision: 2, changed: true });
    expect(t.calls()).toBe(2);
    expect(await t.sync.status()).not.toHaveProperty("key");
  });
  it("ammette solo il progetto online approvato dal processo principale, senza simulazioni", () => {
    const online: TerritorySyncConfig = { ...config, url: "https://approved.supabase.co", profileKind: "live", environment: "online" };
    expect(onlineSyncConfig(online, online.url)).toEqual(online);
    for (const url of ["https://other.supabase.co", "http://approved.supabase.co", "https://approved.supabase.co/rest", "https://user@approved.supabase.co", "https://approved.supabase.co?x=1", "https://approved.supabase.co:444", "https://example.com"]) expect(() => onlineSyncConfig({ ...online, url }, online.url)).toThrow();
    expect(() => onlineSyncConfig({ ...online, profileKind: "simulation" }, online.url)).toThrow();
    expect(() => new TerritorySync({} as TerritoryStore, "unused", online)).toThrow();
  });
  it("riconcilia automaticamente copie nuove, cambiamenti remoti e modifiche locali senza perderli", async () => {
    const t = await setup();
    expect(await t.sync.reconcile()).toEqual({ revision: 1, changed: true });
    await t.store.change(s => { s.memories[street.id]!.note = "Nota locale"; });
    expect(await t.sync.reconcile()).toEqual({ revision: 2, changed: true });
    t.remote().revision++; t.remote().state.memories[street.id]!.note = "Nota remota";
    expect(await t.sync.reconcile()).toEqual({ revision: 3, changed: true });
    expect(t.store.read().memories[street.id]!.note).toBe("Nota remota");
    t.remote().revision++; t.remote().state.memories[street.id]!.note = "Nuova nota remota";
    await t.store.change(s => { s.memories[street.id]!.note = "Correzione confermata"; });
    await expect(t.sync.reconcile()).rejects.toThrow("Confronta gli archivi");
    expect(t.store.read().memories[street.id]!.note).toBe("Correzione confermata");
    expect(t.remote().state.memories[street.id]!.note).toBe("Nuova nota remota");
  });
  it("separa la revisione online da quella locale e vincola il progetto della baseline", async () => {
    const t = await setup(); await t.sync.push();
    const onlineConfig: TerritorySyncConfig = { ...config, url: "https://approved.supabase.co", profileKind: "live", environment: "online" };
    const client = { from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }; return query; }, rpc: async () => ({ data: 1, error: null }) } as unknown as SupabaseClient;
    const online = new TerritorySync(t.store, t.directory, onlineConfig, client, onlineConfig.url);
    expect((await online.status()).revision).toBe(0);
    await online.push();
    expect((await t.sync.status()).revision).toBe(1);
    expect((await online.status()).environment).toBe("online");
    expect(await readdir(t.directory)).toContain("sync-state-online.json");
    const different = new TerritorySync(t.store, t.directory, { ...onlineConfig, url: "https://other.supabase.co" }, client, "https://other.supabase.co");
    await expect(different.status()).rejects.toThrow("progetto della memoria");
  });
  it("recupera una risposta persa dopo il salvataggio senza duplicare revisioni", async () => {
    const t = await setup(); t.uncertain();
    await expect(t.sync.push()).rejects.toThrow("non confermato");
    expect(await t.sync.push()).toEqual({ revision: 1, changed: false });
    expect(t.calls()).toBe(1);
  });
  it("blocca un conflitto concorrente senza cambiare archivio o baseline", async () => {
    const t = await setup(); await t.sync.push();
    await t.store.change(s => { s.memories[street.id] = { note: "Locale", attention: false, updatedAt: "2026-10-04" }; });
    const before = t.store.read(); t.conflict();
    await expect(t.sync.push()).rejects.toThrow("Un'altra sessione");
    expect(t.store.read()).toEqual(before); expect((await t.sync.status()).revision).toBe(1);
  });
  it("rifiuta push e pull che sovrascriverebbero modifiche di due sessioni", async () => {
    const t = await setup(); await t.sync.push();
    t.remote().revision++; t.remote().state.memories[street.id] = { note: "Remoto", attention: true, updatedAt: "2026-10-04" };
    await t.store.change(s => { s.memories[street.id] = { note: "Locale", attention: false, updatedAt: "2026-10-04" }; });
    await expect(t.sync.push()).rejects.toThrow("Confronta gli archivi");
    await expect(t.sync.pull()).rejects.toThrow("modifiche locali");
    expect(t.store.read().memories[street.id]!.note).toBe("Locale");
  });
  it("scarica un aggiornamento con copia precedente e rende riprendibili le operazioni", async () => {
    const t = await setup(); await t.sync.push();
    t.remote().revision++; t.remote().state.memories[street.id] = { note: "Remoto", attention: true, updatedAt: "2026-10-04" };
    t.remote().state.runs.push({ id: "run", streetId: street.id, operation: "scan", origin: "simulation", state: "running", startedAt: "2026-10-04", endedAt: null, handled: 0, total: null, itemKeys: [], checkpoint: null, error: null });
    expect(await t.sync.pull()).toEqual({ revision: 2, changed: true });
    expect(t.store.read().runs[0]!.state).toBe("paused");
    expect((await readdir(t.directory)).some(f => f.includes("before-sync"))).toBe(true);
  });
  it("non perde una correzione arrivata durante la lettura remota", async () => {
    const t = await setup(); await t.sync.push();
    t.remote().revision++; t.remote().state.memories[street.id] = { note: "Remoto", attention: true, updatedAt: "2026-10-04" };
    t.beforeRead(async () => { await t.store.change(s => { s.memories[street.id] = { note: "Appena confermato", attention: true, updatedAt: "2026-10-04" }; }); });
    await expect(t.sync.pull()).rejects.toThrow("cambiato durante");
    expect(t.store.read().memories[street.id]!.note).toBe("Appena confermato");
  });
  it("preserva il primo archivio locale e rifiuta cambi di profilo o workspace", async () => {
    const t = await setup(); await t.sync.push();
    t.remote().profile_kind = "live"; await expect(t.sync.pull()).rejects.toThrow("altro profilo");
    t.remote().profile_kind = "simulation";
    await writeFile(path.join(t.directory, "sync-state.json"), JSON.stringify({ revision: 1, localHash: territoryDigest(t.store.read()), workspaceId: "altro", ownerId: config.ownerId, profileKind: config.profileKind }));
    await expect(t.sync.push()).rejects.toThrow("configurazione è cambiata");
  });
});
