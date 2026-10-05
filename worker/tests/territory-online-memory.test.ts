import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { openOnlineMemory } from "../src/territory/online-memory.js";

const directories: string[] = [];
const credentials = { url: "https://approved.supabase.co", key: "dummy-secret-for-test-only" };
const ownerId = "be0e3d14-4b90-41b9-83b5-43a683fc2523";
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() { const directory = await mkdtemp(path.join(os.tmpdir(), "territory-online-test-")); directories.push(directory); return { directory, store: await TerritoryStore.open(directory, []) }; }
it("discovers only one owner, binds the existing online archive and persists no credential", async () => {
  const t = await setup(); const calls: string[] = [];
  const workspaceId = "fd2503de-cf17-4ed5-bac1-65a5c6d269ce";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    return Response.json(url.includes("/auth/v1/admin/users") ? { users: [{ id: ownerId }] } : [{ id: workspaceId }]);
  });
  const sync = await openOnlineMemory(t.store, t.directory, credentials);
  expect((await sync.status()).environment).toBe("online");
  const saved = await readFile(path.join(t.directory, "online-config.json"), "utf8");
  expect(saved).not.toContain(credentials.key); expect(JSON.parse(saved)).toMatchObject({ ownerId, workspaceId });
  expect(calls).toHaveLength(2);
  await openOnlineMemory(t.store, t.directory, credentials); expect(calls).toHaveLength(2);
  await expect(openOnlineMemory(t.store, t.directory, { ...credentials, url: "https://other.supabase.co" })).rejects.toThrow();
  expect(calls).toHaveLength(2);
});
it("assigns the same workspace to fresh devices and rejects ambiguous ownership", async () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => Response.json(String(input).includes("/auth/") ? { users: [{ id: ownerId }] } : []));
  const a = await setup(), b = await setup();
  await openOnlineMemory(a.store, a.directory, credentials); await openOnlineMemory(b.store, b.directory, credentials);
  expect(JSON.parse(await readFile(path.join(a.directory, "online-config.json"), "utf8"))).toEqual(JSON.parse(await readFile(path.join(b.directory, "online-config.json"), "utf8")));
  const c = await setup();
  vi.stubGlobal("fetch", async () => Response.json({ users: [{ id: ownerId }, { id: "another-user" }] }));
  await expect(openOnlineMemory(c.store, c.directory, credentials)).rejects.toThrow("unico proprietario");
  await expect(readFile(path.join(c.directory, "online-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("rejects a stored key and malicious endpoint before any network call", async () => {
  const t = await setup(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await writeFile(path.join(t.directory, "online-config.json"), JSON.stringify({ ...credentials, url: "https://attacker.example", ownerId, workspaceId: ownerId, profileKind: "live", environment: "online" }));
  await expect(openOnlineMemory(t.store, t.directory, credentials)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
