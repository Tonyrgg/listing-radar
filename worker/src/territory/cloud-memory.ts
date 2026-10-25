import { canonicalTaxCode, sameCadastralIdentity } from "../import-v2/identity.js";
import { ImportV2Error } from "../import-v2/errors.js";
import type { CrmPersonSnapshot, CrmPropertySummary, ImportV2Checkpoint, SourceProperty } from "../import-v2/model.js";
import type { TecnocloudV2Port } from "../import-v2/ports.js";
import { unitKey, type TerritoryState } from "./model.js";

export type CloudEvidence = { crmIds: string[]; status: "found" | "not_found" | "unconfirmed"; lastCheckedAt: string; lastVerifiedAt: string | null };
export type CloudMemory = { properties: Record<string, CloudEvidence>; people: Record<string, CloudEvidence> };
const stamp = () => new Date().toISOString();
const valid = (at: string | null | undefined): at is string => Boolean(at && Number.isFinite(Date.parse(at)));
const matches = (source: SourceProperty, row: CrmPropertySummary) => Boolean(row.cadastral?.sheet && row.cadastral.parcel && sameCadastralIdentity({ ...source.cadastral, income: null }, { ...row.cadastral, income: null }));
const unique = (ids: string[]) => [...new Map(ids.filter(Boolean).map(id => [id.slice(0, 15), id])).values()];
const readFailed = (error: unknown) => error instanceof ImportV2Error && error.kind === "transient_portal" && error.options.retryable && !error.options.global;
export function validateCloudMemory(memory: CloudMemory | undefined) {
  if (memory === undefined) return;
  for (const kind of ["properties", "people"] as const) {
    const table = memory?.[kind];
    if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("Memoria delle identità Cloud non riconosciuta");
    for (const row of Object.values(table)) if (!row || !Array.isArray(row.crmIds) || row.crmIds.some(id => typeof id !== "string" || !id.trim())
      || !["found", "not_found", "unconfirmed"].includes(row.status) || !valid(row.lastCheckedAt)
      || row.lastVerifiedAt !== null && !valid(row.lastVerifiedAt) || row.status === "found" && !row.crmIds.length) throw new Error("Verifiche Cloud non riconosciute: archivio conservato");
  }
}
function put(table: Record<string, CloudEvidence>, key: string, ids: string[], at: string, status: CloudEvidence["status"] = ids.length ? "found" : "not_found") {
  if (!valid(at) || table[key] && Date.parse(table[key]!.lastCheckedAt) > Date.parse(at)) return;
  const prior = table[key];
  table[key] = { crmIds: status === "found" ? unique(ids) : prior?.crmIds ?? [], status, lastCheckedAt: at, lastVerifiedAt: status === "found" ? at : prior?.lastVerifiedAt ?? null };
}
/** Positive identities are hints for a direct reread, never cached absence or write authority. */
export class CloudIdentityMemory {
  private data: CloudMemory;
  private pending: CloudMemory = { properties: {}, people: {} };
  constructor(state: TerritoryState) { validateCloudMemory(state.cloudMemory); this.data = structuredClone(state.cloudMemory ?? { properties: {}, people: {} }); }
  flush(state: TerritoryState) {
    const target = state.cloudMemory ??= { properties: {}, people: {} };
    for (const kind of ["properties", "people"] as const) for (const [key, evidence] of Object.entries(this.pending[kind])) put(target[kind], key, evidence.crmIds, evidence.lastCheckedAt, evidence.status);
    // Keep pending until commit is known; replay is idempotent and cannot lose a hint on a failed write.
  }
  private record(kind: keyof CloudMemory, key: string, ids: string[], status?: CloudEvidence["status"]) {
    const at = stamp(); put(this.data[kind], key, ids, at, status); this.pending[kind][key] = structuredClone(this.data[kind][key]!);
  }
  port(base: TecnocloudV2Port): TecnocloudV2Port {
    const sources = new Map<string, SourceProperty>();
    const property = (source: SourceProperty, rows: CrmPropertySummary[]) => {
      const key = unitKey(source); sources.set(key, source); this.record("properties", key, rows.filter(row => matches(source, row)).map(row => row.id));
    };
    const person = (row: CrmPersonSnapshot) => { const cf = canonicalTaxCode(row.taxCode); if (cf) this.record("people", cf, [row.id]); };
    const refreshProperty = (row: CrmPropertySummary) => {
      for (const [key, known] of Object.entries(this.data.properties)) if (known.crmIds.some(id => id.slice(0, 15) === row.id.slice(0, 15))) {
        const source = sources.get(key);
        if (source && matches(source, row)) this.record("properties", key, known.crmIds);
      }
    };
    const override: Partial<TecnocloudV2Port> = {
      searchPeopleByExactTaxCode: async taxCode => {
        const cf = canonicalTaxCode(taxCode), known = this.data.people[cf];
        let unreadable = known?.status === "unconfirmed" && Boolean(known.crmIds.length && known.lastVerifiedAt);
        if (known?.status === "found" && known.crmIds.length) {
          const rows: CrmPersonSnapshot[] = [];
          for (const id of known.crmIds) {
            let row: CrmPersonSnapshot;
            try { row = await base.readPerson(id, cf); }
            catch (error) { if (!readFailed(error)) throw error; unreadable = true; this.record("people", cf, [], "unconfirmed"); break; }
            if (canonicalTaxCode(row.taxCode) !== cf) { unreadable ||= !canonicalTaxCode(row.taxCode); this.record("people", cf, [], "unconfirmed"); break; }
            rows.push(row);
          }
          if (rows.length === known.crmIds.length) { this.record("people", cf, rows.map(r => r.id)); return rows; }
        }
        const rows = await base.searchPeopleByExactTaxCode(cf);
        const exact = rows.filter(row => canonicalTaxCode(row.taxCode) === cf);
        if (exact.length !== rows.length) throw new ImportV2Error("Ricerca CF non coerente: nessuna creazione automatica", "verification_failed");
        if (unreadable && !exact.length) { this.record("people", cf, [], "unconfirmed"); throw new ImportV2Error("Nominativo trovato in precedenza ma non leggibile: nessuna nuova anagrafica finché la presenza non è confermata", "transient_portal", { retryable: true }); }
        this.record("people", cf, exact.map(row => row.id)); return exact;
      },
      findPropertiesByCadastralIdentity: async plan => {
        const key = unitKey(plan.source), known = this.data.properties[key]; sources.set(key, plan.source);
        let unreadable = known?.status === "unconfirmed" && Boolean(known.crmIds.length && known.lastVerifiedAt);
        if (known?.status === "found" && known.crmIds.length) {
          const rows: CrmPropertySummary[] = [];
          for (const id of known.crmIds) {
            let row: CrmPropertySummary;
            try { row = await (base.readPropertyIdentity ? base.readPropertyIdentity(id) : base.readProperty(id)); }
            catch (error) { if (!readFailed(error)) throw error; unreadable = true; this.record("properties", key, [], "unconfirmed"); break; }
            if (!matches(plan.source, row)) {
              unreadable ||= !row.cadastral?.sheet || !row.cadastral.parcel || Boolean(plan.source.cadastral.urbanSection && !row.cadastral.urbanSection);
              this.record("properties", key, [], "unconfirmed"); break;
            }
            rows.push(row);
          }
          if (rows.length === known.crmIds.length) { property(plan.source, rows); return rows; }
        }
        const rows = await base.findPropertiesByCadastralIdentity(plan);
        if (unreadable && !rows.some(row => matches(plan.source, row))) { this.record("properties", key, [], "unconfirmed"); throw new ImportV2Error("Immobile trovato in precedenza ma non leggibile: nessuna creazione automatica da un caricamento fallito", "transient_portal", { retryable: true }); }
        property(plan.source, rows); return rows;
      },
      readPerson: async (id, cf) => { const row = await base.readPerson(id, cf); person(row); return row; },
      createPerson: async desired => { const row = await base.createPerson(desired); person(row); return row; },
      overwritePerson: async (id, desired) => { const row = await base.overwritePerson(id, desired); person(row); return row; },
      mergePeople: async request => { const row = await base.mergePeople(request); person(row); return row; },
      createProperty: async (plan, id) => { const row = await base.createProperty(plan, id); property(plan.source, [row]); return row; },
      updateProperty: async (id, plan) => { const row = await base.updateProperty(id, plan); property(plan.source, [row]); return row; },
      readProperty: async id => { const row = await base.readProperty(id); refreshProperty(row); return row; },
    };
    return new Proxy(base, { get: (target, name) => {
      const fn = override[name as keyof TecnocloudV2Port] ?? Reflect.get(target, name);
      return typeof fn === "function" ? fn.bind(name in override ? override : target) : fn;
    } });
  }
}
/** Ordinary desktop imports also feed the same evidence, without an extra ledger write. */
export function rememberCloudCheckpoint(state: TerritoryState, source: SourceProperty, cp: ImportV2Checkpoint | null, at: string) {
  if (!cp || !valid(at) || source.municipality.trim().toUpperCase() !== "BITONTO") return;
  const memory = state.cloudMemory ??= { properties: {}, people: {} };
  if (["people_resolved", "people_synced"].includes(cp.stage)) {
    for (const person of cp.people) put(memory.people, canonicalTaxCode(person.taxCode), person.matches.map(p => p.id), at);
    if (cp.stage === "people_synced") for (const p of cp.syncedPeople) put(memory.people, canonicalTaxCode(p.taxCode), [p.crmPersonId], at);
  }
  if (cp.crmPropertyId && ["property_synced", "ownerships_synced", "verified", "activity_synced", "completed"].includes(cp.stage)) put(memory.properties, unitKey(source), [cp.crmPropertyId], at);
}
export function hydrateCloudMemory(state: TerritoryState) {
  validateCloudMemory(state.cloudMemory);
  for (const unit of Object.values(state.units)) {
    const memory = state.cloudMemory ??= { properties: {}, people: {} };
    for (const e of unit.journal ?? []) if (e.kind === "import_completed" && e.crmId && valid(e.at)) {
      put(memory.properties, unit.key, [e.crmId], e.at);
      for (const p of e.syncedPeople ?? []) put(memory.people, canonicalTaxCode(p.taxCode), [p.crmPersonId], e.at);
    }
    if (unit.assessment?.candidateId && ["update", "synced"].includes(unit.assessment.kind)) put(memory.properties, unit.key, [unit.assessment.candidateId], unit.assessment.checkedAt);
  }
}
