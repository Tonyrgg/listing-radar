import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TerritoryStore } from "../../worker/src/territory/store";
import { TerritorySync, type TerritorySyncConfig } from "../../worker/src/territory/sync";

const workspace = "fd2503de-cf17-4ed5-bac1-65a5c6d269ce", owner = "be0e3d14-4b90-41b9-83b5-43a683fc2523";
const initial = { version: 1, streets: [{ id: "tatulli", name: "Via Michele Tatulli", sisterName: "VIA MICHELE TATULLI", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false }], memories: { tatulli: { note: "", attention: false, updatedAt: "2026-10-01" } }, units: {}, runs: [], events: [], checkpoints: {}, virtualCrm: {}, virtualPeople: {} };
const auth = `set request.jwt.claims = '{"sub":"${owner}","role":"service_role"}';`;
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon, service_role;
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb->>'role'$$; ${auth}`);
  await db.exec(await readFile(path.resolve("supabase/migrations/0013_territory_lab_sync.sql"), "utf8"));
  await db.query("select public.save_territory_lab_workspace($1::uuid,$2::uuid,'live',0,$3::jsonb)", [workspace, owner, JSON.stringify(initial)]);
  await db.exec(await readFile(path.resolve("supabase/migrations/0027_territory_incremental_sync.sql"), "utf8"));
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    const entries = Object.entries(args), casts: Record<string,string> = { p_workspace_id: "uuid", p_owner_id: "uuid", p_profile_kind: "text", p_since: "bigint", p_expected_revision: "bigint", p_changes: "jsonb", p_state: "jsonb" };
    if (!/^(read_territory_workspace_changes|save_territory_workspace_changes|save_territory_lab_workspace)$/.test(name)) throw new Error("Unexpected RPC");
    try { const result = await db.query<{ data: any }>(`select public.${name}(${entries.map(([key], i) => `${key} => $${i+1}::${casts[key]}`).join(",")}) as data`, entries.map(([key,v]) => casts[key] === "jsonb" ? JSON.stringify(v) : v)); return { data: result.rows[0]!.data, error: null }; }
    catch (error) { return { data: null, error }; }
  } } as unknown as SupabaseClient;
  const read = async (since: number) => { const result = await client.rpc("read_territory_workspace_changes", { p_workspace_id: workspace, p_owner_id: owner, p_profile_kind: "live", p_since: since }); if (result.error) throw result.error; return result.data; };
  return { db, client, read };
}

it("migration retains old archives; deltas, queue tombstones, rollback and owner boundaries work in PostgreSQL", async () => {
  const { db, client, read } = await setup();
  try {
    const first = await read(0); expect(first.revision).toBe(1); expect(first.changes).toHaveLength(3);
    expect(await read(1)).toEqual({ revision: 1, changes: [] });
    const args = { p_workspace_id: workspace, p_owner_id: owner, p_profile_kind: "live", p_expected_revision: 1 };
    const entry = { collection: "importQueue", key: "unit", value: { id: "entry", key: "unit", streetId: "tatulli", addedAt: "2026-10-15T12:00:00Z" } };
    expect((await client.rpc("save_territory_workspace_changes", { ...args, p_changes: [entry] })).data).toBe(2);
    expect((await read(1)).changes).toEqual([{ ...entry, deleted: false }]);
    expect((await client.rpc("save_territory_workspace_changes", { ...args, p_changes: [] })).error).toMatchObject({ code: "40001" });
    const bad = await client.rpc("save_territory_workspace_changes", { ...args, p_expected_revision: 2, p_changes: [ { ...entry, deleted: true }, { collection: "unknown", key: "a", value: {} } ] });
    expect(bad.error).toBeTruthy(); expect((await read(2)).revision).toBe(2);
    expect((await read(0)).changes).toContainEqual({ ...entry, deleted: false });
    expect((await client.rpc("save_territory_workspace_changes", { ...args, p_expected_revision: 2, p_changes: [{ ...entry, deleted: true }] })).data).toBe(3);
    expect((await read(2)).changes).toEqual([{ collection: "importQueue", key: "unit", value: null, deleted: true }]);
    const event = { id: "event", streetId: "tatulli", at: "2026-10-15T12:00:00Z", text: "Imported" };
    expect((await client.rpc("save_territory_workspace_changes", { ...args, p_expected_revision: 3, p_changes: [{ collection: "events", key: "event", value: event }] })).data).toBe(4);
    expect((await read(3)).changes).toEqual([{ collection: "events", key: "event", value: event, deleted: false }]);
    await db.exec(`set role authenticated; set request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}';`);
    await expect(read(0)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from public.territory_workspace_records")).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role; set role anon;"); await expect(read(0)).rejects.toMatchObject({ code: "42501" });
  } finally { await db.close(); }
}, 30000);

it("two independent worker profiles converge through the real delta SQL, including concurrent writes and deletions", async () => {
  const { db, client, read } = await setup(); const directories: string[] = [];
  try {
    const config: TerritorySyncConfig = { url: "https://approved.supabase.co", key: "test", workspaceId: workspace, ownerId: owner, profileKind: "live", environment: "online" };
    const pc = async () => { const dir = await mkdtemp(path.join(os.tmpdir(),"sync-pg-")); directories.push(dir); const store = await TerritoryStore.open(dir, initial.streets); return { store, sync: new TerritorySync(store, dir, config, client, config.url) }; };
    const a = await pc(), b = await pc();
    await Promise.all([a.sync.reconcile(), b.sync.reconcile()]);
    await a.store.change(s => { s.memories.tatulli!.note = "PC 1"; });
    await b.store.change(s => { s.zones = { z: { id: "z", name: "PC 2", streetIds: ["tatulli"], updatedAt: "2026-10-15T12:00:00Z" } }; });
    await Promise.all([a.sync.reconcile(), b.sync.reconcile()]);
    await a.sync.reconcile(); await b.sync.reconcile();
    expect(a.store.read().zones?.z?.name).toBe("PC 2"); expect(b.store.read().memories.tatulli!.note).toBe("PC 1");
    expect((await a.sync.status()).conflicts).toHaveLength(0);
    const revision = (await read(0)).revision;
    expect(JSON.stringify(await read(revision)).length).toBeLessThan(50);
    await a.sync.reconcile(); await b.sync.reconcile(); expect((await read(0)).revision).toBe(revision);
    // Legacy writers remain indexed: this is not a second, disconnected archive.
    const old = a.store.read(); old.memories.tatulli!.note = "Legacy";
    await client.rpc("save_territory_lab_workspace", { p_workspace_id: workspace, p_owner_id: owner, p_profile_kind: "live", p_expected_revision: revision, p_state: old });
    await b.sync.reconcile(); expect(b.store.read().memories.tatulli!.note).toBe("Legacy");
  } finally { await db.close(); await Promise.all(directories.map(dir => rm(dir, { recursive: true, force: true }))); }
}, 30000);
