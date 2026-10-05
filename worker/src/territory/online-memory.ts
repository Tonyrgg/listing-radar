import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { onlineSyncConfig, TerritorySync, type TerritorySyncConfig } from "./sync.js";
import type { TerritoryStore } from "./store.js";

export type OnlineCredentials = { url: string; key: string };
type OnlineIdentity = Omit<TerritorySyncConfig, "key">;

/** Uses the encrypted desktop credentials in memory; never writes a key to this profile. */
export async function openOnlineMemory(store: TerritoryStore, directory: string, credentials: OnlineCredentials) {
  const filename = path.join(directory, "online-config.json");
  let identity: OnlineIdentity;
  try { identity = JSON.parse(await readFile(filename, "utf8")) as OnlineIdentity; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Configurazione della memoria online non leggibile; archivio locale conservato");
    const url = new URL(credentials.url).origin;
    // Validate the destination before sending any credential.
    onlineSyncConfig({ ...credentials, workspaceId: "00000000-0000-4000-8000-000000000000", ownerId: "00000000-0000-4000-8000-000000000000", profileKind: "live", environment: "online" }, credentials.url);
    const client = createClient(url, credentials.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
    const users = await client.auth.admin.listUsers({ page: 1, perPage: 2 });
    if (users.error || users.data.users.length !== 1) throw new Error("Impossibile assegnare la memoria online a un unico proprietario. L'archivio locale resta conservato.");
    const ownerId = users.data.users[0]!.id;
    const existing = await client.from("territory_lab_workspaces").select("id").eq("owner_id", ownerId).eq("profile_kind", "live").limit(2);
    if (existing.error) throw new Error("Memoria online non raggiungibile o schema non aggiornato; archivio locale conservato");
    if (existing.data.length > 1) throw new Error("Ci sono più archivi online: serve scegliere quello da collegare");
    // All fresh installations for this owner compute the same ID, including a concurrent setup.
    const hash = createHash("sha256").update(`listing-radar-worker-v2:${url}:${ownerId}`).digest("hex");
    const workspaceId = existing.data[0]?.id as string | undefined ?? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    identity = { url, ownerId, workspaceId, profileKind: "live", environment: "online" };
    try { await writeFile(filename, JSON.stringify(identity, null, 2), { flag: "wx", mode: 0o600 }); }
    catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError; identity = JSON.parse(await readFile(filename, "utf8")) as OnlineIdentity; }
  }
  // Never accept a stored key or a stored project as an override of the main-process settings.
  const config = onlineSyncConfig({ ...identity, key: credentials.key }, credentials.url);
  return new TerritorySync(store, directory, config, undefined, credentials.url);
}
