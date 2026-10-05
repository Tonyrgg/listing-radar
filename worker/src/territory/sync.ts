import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { TerritoryState } from "./model.js";
import type { TerritoryStore } from "./store.js";

export type TerritorySyncConfig = { url: string; key: string; workspaceId: string; ownerId: string; profileKind: "live" | "simulation"; environment?: "online" };
export type SyncBinding = { revision: number; localHash: string; syncedAt: string | null; workspaceId?: string; ownerId?: string; profileKind?: string; url?: string };
type Remote = { id: string; owner_id: string; profile_kind: "live" | "simulation"; revision: number; state: TerritoryState };
export function localSyncConfig(config: TerritorySyncConfig): TerritorySyncConfig {
  const url = new URL(config.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("La sincronizzazione del laboratorio ammette solo Supabase locale; i progetti remoti sono esclusi");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(config.workspaceId) || !uuid.test(config.ownerId) || !config.key || !["simulation", "live"].includes(config.profileKind)) throw new Error("Configurazione della memoria condivisa non valida");
  return config;
}
/** Remote access is allowed only to the project already configured in the desktop main process. */
export function onlineSyncConfig(config: TerritorySyncConfig, approvedUrl: string): TerritorySyncConfig {
  const url = new URL(config.url);
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.origin !== new URL(approvedUrl).origin || config.environment !== "online" || config.profileKind !== "live") throw new Error("La memoria online deve usare il progetto Supabase configurato nell'app e il profilo reale");
  // Reuse identity validation without allowing this URL through the local gate.
  localSyncConfig({ ...config, url: "http://127.0.0.1:54321" });
  return config;
}
export function territoryDigest(value: unknown): string {
  const stable = (data: unknown): unknown => Array.isArray(data) ? data.map(stable) : data && typeof data === "object" ? Object.fromEntries(Object.entries(data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : data;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function validateState(state: TerritoryState, kind: TerritorySyncConfig["profileKind"]) {
  if (state.version !== 1 || !Array.isArray(state.streets) || !Array.isArray(state.runs) || !state.memories || !state.units || !state.checkpoints || !state.virtualCrm || !state.virtualPeople || !Array.isArray(state.events)) throw new Error("Archivio remoto non riconosciuto");
  for (const unit of Object.values(state.units)) {
    if (!Array.isArray(unit.observations) || !unit.observations.length || unit.observations.some(o => (o.origin === "simulation") !== (kind === "simulation") || o.source.municipality.trim().toUpperCase() !== "BITONTO")) throw new Error("Il workspace contiene dati di un altro profilo o Comune");
  }
}
export class TerritorySync {
  private readonly client: SupabaseClient;
  constructor(private readonly store: TerritoryStore, private readonly directory: string, private readonly config: TerritorySyncConfig, client?: SupabaseClient, approvedUrl?: string) {
    if (config.environment === "online") onlineSyncConfig(config, approvedUrl ?? "http://localhost"); else localSyncConfig(config);
    this.client = client ?? createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
  }
  private get bindingFile() { return path.join(this.directory, this.config.environment === "online" ? "sync-state-online.json" : "sync-state.json"); }
  private async binding(): Promise<SyncBinding> {
    try {
      const binding = JSON.parse(await readFile(this.bindingFile, "utf8")) as SyncBinding;
      if (!Number.isSafeInteger(binding.revision) || binding.revision < 0 || typeof binding.localHash !== "string" || !/^[a-f0-9]{64}$/.test(binding.localHash)) throw new Error("Registro di sincronizzazione non valido: conserva gli archivi prima del recupero");
      if (binding.workspaceId !== this.config.workspaceId || binding.ownerId !== this.config.ownerId || binding.profileKind !== this.config.profileKind) throw new Error("La configurazione è cambiata rispetto all'ultima sincronizzazione. Conserva e confronta gli archivi prima di cambiare workspace.");
      if ((this.config.environment === "online" || binding.url) && binding.url !== new URL(this.config.url).origin) throw new Error("Il progetto della memoria è cambiato. Nessun archivio viene sostituito.");
      return binding;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { revision: 0, localHash: "", syncedAt: null }; }
  }
  private async remember(revision: number, state: TerritoryState) {
    const file = this.bindingFile;
    await writeFile(`${file}.tmp`, JSON.stringify({ revision, localHash: territoryDigest(state), syncedAt: new Date().toISOString(), workspaceId: this.config.workspaceId, ownerId: this.config.ownerId, profileKind: this.config.profileKind, url: new URL(this.config.url).origin }), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  private async remote(): Promise<Remote | null> {
    const result = await this.client.from("territory_lab_workspaces").select("*").eq("id", this.config.workspaceId).eq("owner_id", this.config.ownerId).maybeSingle();
    if (result.error) throw new Error("Memoria condivisa non raggiungibile. L'archivio locale resta conservato.");
    const data = result.data as Remote | null;
    if (data) {
      if (data.id !== this.config.workspaceId || data.owner_id !== this.config.ownerId || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error("Identità o revisione della memoria condivisa non valida");
      if (data.profile_kind !== this.config.profileKind) throw new Error("Workspace assegnato a un altro profilo");
      validateState(data.state, this.config.profileKind);
    }
    return data;
  }
  async status() { const binding = await this.binding(); return { configured: true, environment: this.config.environment ?? "locale", revision: binding.revision, syncedAt: binding.syncedAt, pending: territoryDigest(this.store.read()) !== binding.localHash }; }
  async reconcile() {
    const [binding, remote] = await Promise.all([this.binding(), this.remote()]);
    if (remote && remote.revision > binding.revision) {
      const local = this.store.read();
      const hasWork = Object.keys(local.units).length || local.runs.length || local.events.length || Object.values(local.memories).some(m => m.note || m.attention) || local.history?.length || Object.keys(local.networkBindings ?? {}).length;
      if (territoryDigest(local) === territoryDigest(remote.state) || (binding.localHash && territoryDigest(local) === binding.localHash) || (!binding.localHash && !hasWork)) return this.pull();
    }
    return this.push();
  }
  async push() {
    const local = this.store.read(); validateState(local, this.config.profileKind);
    if (local.runs.some(run => run.state === "running")) throw new Error("Metti in pausa prima di sincronizzare");
    const [binding, remote] = await Promise.all([this.binding(), this.remote()]);
    if (remote && territoryDigest(remote.state) === territoryDigest(local)) { await this.remember(remote.revision, local); return { revision: remote.revision, changed: false }; }
    if ((remote?.revision ?? 0) !== binding.revision) throw new Error("La memoria condivisa è cambiata. Confronta gli archivi prima di caricare: nessuna sovrascrittura automatica.");
    const result = await this.client.rpc("save_territory_lab_workspace", { p_workspace_id: this.config.workspaceId, p_owner_id: this.config.ownerId, p_profile_kind: this.config.profileKind, p_expected_revision: binding.revision, p_state: local });
    if (result.error) throw new Error(result.error.code === "40001" ? "Un'altra sessione ha aggiornato la memoria. L'archivio locale resta conservato." : "Caricamento non confermato. Rileggi la memoria condivisa prima di riprovare.");
    const revision = Number(result.data);
    if (!Number.isSafeInteger(revision) || revision !== binding.revision + 1) throw new Error("Risposta della memoria condivisa non confermata; archivio locale conservato");
    await this.remember(revision, local);
    return { revision, changed: true };
  }
  async pull() {
    const local = this.store.read(); const [binding, remote] = await Promise.all([this.binding(), this.remote()]);
    if (!remote) throw new Error("Nessun archivio presente nella memoria condivisa");
    if (remote.revision < binding.revision) throw new Error("La memoria condivisa ha una revisione più vecchia. L'archivio locale resta conservato.");
    if (territoryDigest(local) === territoryDigest(remote.state)) { await this.remember(remote.revision, local); return { revision: remote.revision, changed: false }; }
    const hasWork = Object.keys(local.units).length || local.runs.length || local.events.length || Object.values(local.memories).some(m => m.note || m.attention) || local.history?.length || Object.keys(local.networkBindings ?? {}).length;
    if ((binding.localHash && territoryDigest(local) !== binding.localHash) || (!binding.localHash && hasWork)) throw new Error("Ci sono dati o modifiche locali da conservare. Nessun archivio viene sostituito automaticamente.");
    const incoming = structuredClone(remote.state);
    for (const run of incoming.runs) if (run.state === "running") { run.state = "paused"; run.error = "Operazione recuperata dalla memoria condivisa: verifica la sessione e riprendi dal punto conservato."; }
    const before = territoryDigest(local);
    await this.store.replace(incoming, current => territoryDigest(current) === before);
    await this.remember(remote.revision, this.store.read());
    return { revision: remote.revision, changed: true };
  }
}
