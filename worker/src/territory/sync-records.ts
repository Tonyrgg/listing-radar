import { createHash } from "node:crypto";
import type { TerritoryState, SyncConflict } from "./model.js";

export type SyncRecord = { collection: string; key: string; value: unknown; deleted?: boolean };
const maps = new Set(["memories", "units", "checkpoints", "virtualCrm", "virtualPeople", "virtualActivities", "historicalStreetMappings", "networkBindings", "zones", "savedQueries", "importQueue", "quarantine", "syncConflicts"]);
const lists = new Set(["streets", "runs", "events", "history"]);
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, data) => data && typeof data === "object" && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).sort(([a], [b]) => compareText(a,b))) : data) ?? "undefined";
const equal = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const stamp = (v: unknown) => object(v) ? String(v.lastCheckedAt ?? v.checkedAt ?? v.updatedAt ?? v.at ?? v.startedAt ?? v.addedAt ?? v.endedAt ?? "") : "";
const order = (a: unknown, b: unknown) => compareText(stamp(a), stamp(b)) || compareText(stableJson(a), stableJson(b));

/** Stable record addresses shared with migration 0027; no owner data enters logs. */
export function syncRecords(state: TerritoryState): Map<string, SyncRecord> {
  const records: SyncRecord[] = [];
  for (const [collection, value] of Object.entries(state)) {
    if (lists.has(collection)) for (const row of value as { id: string }[]) records.push({ collection, key: row.id, value: row });
    else if (maps.has(collection)) for (const [key, row] of Object.entries(value)) records.push({ collection, key, value: row });
    else if (collection === "cloudMemory") for (const kind of ["properties", "people"] as const) for (const [key, row] of Object.entries((value as NonNullable<TerritoryState["cloudMemory"]>)[kind])) records.push({ collection: `cloud:${kind}`, key, value: row });
    else records.push({ collection: "meta", key: collection, value });
  }
  return new Map(records.map(r => [JSON.stringify([r.collection, r.key]), structuredClone(r)]));
}
export function recordsState(records: Map<string, SyncRecord>): TerritoryState {
  const state: Record<string, unknown> = { version: 1, cloudMemory: { properties: {}, people: {} }, ...Object.fromEntries([...maps].map(key => [key, Object.create(null)])), ...Object.fromEntries([...lists].map(key => [key, []])) };
  for (const row of records.values()) {
    if (row.deleted) continue;
    if (!maps.has(row.collection) && !lists.has(row.collection) && !["cloud:people", "cloud:properties", "meta"].includes(row.collection) || row.collection === "meta" && (row.key !== "version" || row.value !== 1)) throw new Error("Collezione online non riconosciuta: aggiorna il worker");
    if (lists.has(row.collection) && (!object(row.value) || row.value.id !== row.key)) throw new Error("Identità del record online non valida");
    if (row.collection === "meta") state[row.key] = structuredClone(row.value);
    else if (lists.has(row.collection)) { const list = state[row.collection] ??= []; (list as unknown[]).push(structuredClone(row.value)); }
    else if (row.collection.startsWith("cloud:")) {
      const cloud = state.cloudMemory ??= { properties: {}, people: {} };
      ((cloud as Record<string, Record<string, unknown>>)[row.collection.slice(6)]!)[row.key] = structuredClone(row.value);
    } else {
      const table = state[row.collection] ??= Object.create(null);
      Object.defineProperty(table, row.key, { value: structuredClone(row.value), enumerable: true, writable: true, configurable: true });
    }
  }
  for (const name of lists) (state[name] as unknown[] | undefined)?.sort(order);
  return state as TerritoryState;
}
export function diffRecords(before: TerritoryState, after: TerritoryState): SyncRecord[] {
  const base = syncRecords(before), next = syncRecords(after), result: SyncRecord[] = [];
  for (const [id, row] of next) if (!equal(base.get(id)?.value, row.value)) result.push(row);
  for (const [id, row] of base) if (!next.has(id)) result.push({ ...row, value: null, deleted: true });
  return result;
}

/** Three-way field merge. Facts accumulate; conflicting manual edits are retained
 * as shared review records instead of blocking unrelated work or discarding a value. */
export function mergeTerritory(base: TerritoryState | undefined, local: TerritoryState, remote: TerritoryState): TerritoryState {
  const conflicts: Record<string, SyncConflict> = { ...remote.syncConflicts };
  for (const [id, row] of Object.entries(local.syncConflicts ?? {})) if (!conflicts[id] || (row.resolvedAt ?? "") > (conflicts[id]!.resolvedAt ?? "")) conflicts[id] = structuredClone(row);
  const conflict = (path: string[], a: unknown, b: unknown) => {
    const values = [a ?? null, b ?? null];
    const id = createHash("sha256").update(stableJson([path, [...values].sort((x, y) => compareText(stableJson(x), stableJson(y)))])).digest("hex");
    conflicts[id] ??= { id, path, values, detectedAt: new Date().toISOString(), resolvedAt: null };
    return b; // The shared value remains in place; both proposals remain reviewable.
  };
  const merge = (prior: unknown, a: unknown, b: unknown, path: string[]): unknown => {
    const runCopies = path[0] === "runs" && path.length === 2 && object(a) && object(b);
    if (!runCopies && (equal(a, b) || equal(prior, b))) return structuredClone(a);
    if (!runCopies && equal(prior, a)) return structuredClone(b);
    const field = path.at(-1)!;
    if ((field === "geometry" || field === "geometryEvidence") && path[0] !== "networkBindings") return structuredClone(b ?? a);
    if (field === "geometry" && path[0] === "networkBindings") return conflict(path, a, b);
    if (["registeredAt", "recordedAt"].includes(field)) return [a, b].filter(Boolean).sort()[0];
    if (["updatedAt", "importedAt", "resolvedAt", "lastVerifiedAt"].includes(field)) return [a, b].filter(Boolean).sort().at(-1) ?? null;
    if (field === "owners") return conflict(path, a, b);
    if (Array.isArray(a) && Array.isArray(b)) {
      const identity = (v: unknown) => object(v) && typeof v.id === "string" ? v.id : stableJson(v);
      const rows = new Map(b.map(v => [identity(v), v]));
      const old = new Map((Array.isArray(prior) ? prior : []).map(v => [identity(v), v]));
      for (const v of a) { const id = identity(v); rows.set(id, rows.has(id) ? merge(old.get(id), v, rows.get(id), [...path, id]) : v); }
      if (!["observations", "journal", "issues"].includes(field)) {
        const presentA = new Set(a.map(identity)), presentB = new Set(b.map(identity));
        for (const id of old.keys()) if (!presentA.has(id) || !presentB.has(id)) rows.delete(id);
      }
      return [...rows.values()].sort(order);
    }
    if (object(a) && object(b)) {
      if (path[0] === "memories" && path.length === 2 && prior === undefined) {
        const blank = (v: Record<string, unknown>) => !v.note && !v.attention && !v.sisterSearch;
        // Opening a fresh PC creates empty dossiers with today's timestamps. They
        // are not operator edits and must not rewrite the whole shared catalogue.
        if (blank(a) || blank(b)) return structuredClone(blank(a) && blank(b) ? order(a, b) < 0 ? a : b : blank(a) ? b : a);
      }
      if (path[0] === "history" && path.length === 2) {
        const latest = order(a, b) > 0 ? a : b;
        return { ...structuredClone(latest), streetIds: [...new Set([...(a.streetIds as string[]), ...(b.streetIds as string[])])].sort(),
          imported: Math.max(Number(a.imported ?? 0), Number(b.imported ?? 0)),
          issues: merge(object(prior) ? prior.issues : undefined, a.issues, b.issues, [...path, "issues"]) };
      }
      // A checkpoint / assessment / identity verification is one coherent proof.
      if (path[0] === "checkpoints" && path.length === 2) return structuredClone(a.stage === "completed" ? a : b.stage === "completed" ? b : order(a, b) > 0 ? a : b);
      if (path[0] === "cloudMemory" && path.length === 3) {
        const latest = order(a, b) > 0 ? a : b;
        const verified = String(a.lastVerifiedAt ?? "") > String(b.lastVerifiedAt ?? "") ? a : b;
        return { ...structuredClone(latest), ...(verified.lastVerifiedAt ? { crmIds: structuredClone(verified.crmIds), lastVerifiedAt: verified.lastVerifiedAt } : {}) };
      }
      if (path[0] === "importQueue" && path.length === 2 || field === "assessment") return structuredClone(order(a, b) > 0 ? a : b);
      if (path[0] === "runs" && path.length === 2) {
        const score = (v: Record<string, unknown>) => `${v.endedAt ? "2" : "1"}:${String(v.handled ?? 0).padStart(10, "0")}:${stamp(v)}`;
        const selected = structuredClone(score(a) > score(b) ? a : b);
        // Completion facts are atomic and append-only, independently of the run cursor.
        const old = object(prior) && object(prior.imports) ? prior.imports : {};
        const left = object(a.imports) ? a.imports : {}, right = object(b.imports) ? b.imports : {};
        const imports: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(old), ...Object.keys(left), ...Object.keys(right)])) {
          const before = old[key], x = left[key], y = right[key];
          if (before !== undefined) {
            imports[key] = structuredClone(before);
            for (const value of [x, y]) if (value !== undefined && !equal(value, before)) conflict([...path, "imports", key], before, value);
          } else if (x === undefined || y === undefined || equal(x, y)) imports[key] = structuredClone(x ?? y);
          else {
            conflict([...path, "imports", key], x, y);
            imports[key] = structuredClone(order(x, y) < 0 ? x : y);
          }
        }
        if (Object.keys(imports).length) selected.imports = imports;
        return selected;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(object(prior) ? prior : {})])) {
        const value = merge(object(prior) ? prior[key] : undefined, a[key], b[key], [...path, key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (prior === undefined) {
      if (a === undefined || a === null || a === "" || a === false) return structuredClone(b);
      if (b === undefined || b === null || b === "" || b === false) return structuredClone(a);
    }
    if (path[0] === "importQueue" && path.length === 2 && object(prior)) {
      const enrollment = a ?? b;
      if (object(enrollment) && enrollment.id !== prior.id) return structuredClone(enrollment);
    }
    // Import identity belongs to the most recent verified import, not a loose ID merge.
    if (["crmId", "sourceVersionId"].includes(field) && path[0] === "units") {
      const key = path[1]!;
      return structuredClone((local.units[key]?.importedAt ?? "") > (remote.units[key]?.importedAt ?? "") ? a : b);
    }
    return conflict(path, a, b);
  };
  // Keyed collections must merge by identity, including runs and street catalogues.
  const a = syncRecords(local), b = syncRecords(remote), p = base ? syncRecords(base) : new Map<string, SyncRecord>();
  const next = new Map<string, SyncRecord>();
  for (const id of new Set([...a.keys(), ...b.keys(), ...p.keys()])) {
    const row = a.get(id) ?? b.get(id) ?? p.get(id)!;
    const address = row.collection.startsWith("cloud:") ? ["cloudMemory", row.collection.slice(6), row.key] : [row.collection, row.key];
    const value = merge(p.get(id)?.value, a.get(id)?.value, b.get(id)?.value, address);
    if (value !== undefined) next.set(id, { ...row, value });
  }
  const merged = recordsState(next);
  if (Object.keys(conflicts).length) merged.syncConflicts = conflicts;
  // An old offline enrollment cannot resurrect a confirmed removal or a success.
  for (const [key, entry] of Object.entries(merged.importQueue ?? {})) {
    const removedId = createHash("sha256").update(JSON.stringify([entry.id, "removed"])).digest("hex");
    if (merged.units[key]?.journal?.some(e => e.id === removedId) || merged.runs.some(r => r.queueEntryIds?.[key] === entry.id && r.imports?.[key]?.crmId)) delete merged.importQueue![key];
  }
  return merged;
}

export function resolveSyncConflict(state: TerritoryState, id: string, choice: number) {
  const conflict = state.syncConflicts?.[id];
  if (!conflict || conflict.resolvedAt || ![0, 1].includes(choice)) throw new Error("Confronto già risolto o non disponibile: aggiorna la memoria");
  const [collection, key, ...fields] = conflict.path;
  let target: any = collection === "cloudMemory" ? state.cloudMemory : lists.has(collection!) ? (state as any)[collection!]?.find((r: { id: string }) => r.id === key) : (state as any)[collection!]?.[key!];
  if (collection === "cloudMemory") fields.unshift(key!);
  if (!fields.length) {
    if (!conflict.values.some(v => equal(v, target ?? null))) throw new Error("Il dato è cambiato: aggiorna il confronto");
    const records = syncRecords(state), recordId = JSON.stringify([collection, key]);
    const value = conflict.values[choice];
    if (value === null) records.delete(recordId); else records.set(recordId, { collection: collection!, key: key!, value });
    const next = recordsState(records); Object.assign(state, next);
    state.syncConflicts![id]!.resolvedAt = new Date().toISOString(); return;
  }
  for (const field of fields.slice(0, -1)) { if (["__proto__", "prototype", "constructor"].includes(field)) throw new Error("Percorso non valido"); target = target?.[field]; }
  const field = fields.at(-1)!;
  if (!target || ["__proto__", "prototype", "constructor"].includes(field) || !conflict.values.some(v => equal(v, target[field]))) throw new Error("Il dato è cambiato dopo il confronto: aggiorna prima di scegliere");
  target[field] = structuredClone(conflict.values[choice]);
  conflict.resolvedAt = new Date().toISOString();
}
