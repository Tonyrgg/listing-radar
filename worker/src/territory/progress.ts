import type { TerritoryState } from "./model.js";
import { normalizeSisterStreet } from "../core/street-scan.js";
import { stripSisterMunicipalityPrefix } from "../core/normalize.js";
import { addressIdentity } from "../import-v2/identity.js";
import type { Run } from "./model.js";
import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";

const valid = (at: string | null | undefined): at is string => Boolean(at && Number.isFinite(Date.parse(at)));
export type ImportDistribution = {
  total: number | null; imported: number; percent: number | null;
  recent: number; aging: number; stale: number; never: number; undated: number;
  lastImportedAt: string | null; ageDays: number | null; tone: ReturnType<typeof importAge>["tone"];
};

/** Last verified import per cadastral unit, across acquisitions, within the newest inventory. */
function importDistribution(state: TerritoryState, keys: string[], total: number | null, now: number): ImportDistribution {
  const inventory = new Set(keys), proofs = new Map<string, string | null>();
  const add = (key: string, at: string | null | undefined) => {
    if (!inventory.has(key)) return;
    const date = valid(at) && Date.parse(at) <= now ? at : null;
    if (!proofs.has(key) || (date && (!proofs.get(key) || Date.parse(date) > Date.parse(proofs.get(key)!)))) proofs.set(key, date);
  };
  for (const key of inventory) for (const observation of state.units[key]?.observations ?? []) {
    if (observation.importVerified && observation.crmId) add(key, observation.importedAt);
  }
  for (const key of inventory) for (const event of state.units[key]?.journal ?? []) if (event.kind === "import_completed" && event.crmId) add(key, event.at);
  for (const run of state.runs) if (run.operation === "apply") {
    for (const [key, proof] of Object.entries(run.imports ?? {})) if (proof.crmId) add(key, proof.at);
  }
  const lastImportedAt = [...proofs.values()].filter(valid).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const distribution: ImportDistribution = { total, imported: proofs.size, percent: total ? Math.round(proofs.size / total * 100) : null, recent: 0, aging: 0, stale: 0, never: inventory.size - proofs.size, undated: 0, lastImportedAt, ...importAge(lastImportedAt, now) };
  for (const at of proofs.values()) {
    const tone = importAge(at, now).tone;
    if (tone === "never") distribution.undated++;
    else distribution[tone]++;
  }
  return distribution;
}
export function importAge(at: string | null, now = Date.now()) {
  const days = valid(at) ? Math.floor((now - Date.parse(at)) / 86400000) : null;
  if (days === null || days < 0) return { ageDays: null, tone: "never" as const };
  return { ageDays: days, tone: days <= 30 ? "recent" as const : days <= 90 ? "aging" as const : "stale" as const };
}

/** Coverage belongs to the latest acquisition cohort, never the selected apply subset. */
export function importProgress(state: TerritoryState, streetIds: string[], now = Date.now()) {
  const units = Object.values(state.units).filter(u => u.streetIds.some(id => streetIds.includes(id)));
  const observations = (runId: string) => units.flatMap(u => u.observations.filter(o => o.runId === runId && (!o.streetId || streetIds.includes(o.streetId))).map(o => ({ unit: u, observation: o })));
  const names = new Set(state.streets.filter(s => streetIds.includes(s.id)).flatMap(s => [s.name, s.sisterName].map(normalizeSisterStreet)));
  const scanInventory = (run: Run) => {
    const checkpoint = run.checkpoint as SisterStreetRunCheckpoint | undefined;
    if (!checkpoint?.results?.some(result => result.inventoryProperties)) return { keys: [...new Set(run.itemKeys)], complete: run.state === "completed" };
    const keys = new Set<string>();
    let complete = run.state === "completed";
    for (const result of checkpoint.results) {
      if (!result.inventoryProperties) { if (result.outcome !== "empty") complete = false; continue; }
      for (const property of result.inventoryProperties) {
        const address = property.address && stripSisterMunicipalityPrefix(property.address, "BITONTO");
        const identity = address && addressIdentity(address);
        const name = address && normalizeSisterStreet(identity ? identity.street : address);
        if (!name) { complete = false; continue; }
        if (!names.has(name)) {
          // An unrecognised address cannot prove that this row belongs elsewhere.
          if (!state.streets.some(s => [s.name, s.sisterName].some(value => normalizeSisterStreet(value) === name))) complete = false;
          continue;
        }
        if (property.municipality.toUpperCase() !== "BITONTO" || !property.sheet || !property.parcel) { complete = false; continue; }
        const matches = units.filter(unit => unit.observations.some(o => o.source.cadastral.sheet === property.sheet && o.source.cadastral.parcel === property.parcel && o.source.cadastral.subaltern === property.subaltern));
        if (matches.length > 1) { complete = false; continue; }
        keys.add(matches[0]?.key ?? ["BITONTO", "", property.sheet, property.parcel, property.subaltern].map(value => value.trim().toUpperCase()).join("|"));
      }
    }
    return { keys: [...keys], complete };
  };
  const candidates = [
    ...state.runs.filter(r => r.operation === "scan" && streetIds.includes(r.streetId)).reverse().map(r => ({ id: r.id, at: r.startedAt, ...scanInventory(r) })),
    ...(state.history ?? []).filter(h => h.streetIds.some(id => streetIds.includes(id))).map(h => {
      const rows = observations(`history:${h.id}`);
      if (h.inventoryByStreet) {
        const keys = streetIds.flatMap(id => h.inventoryByStreet?.[id] ?? []);
        // Expanded owner portfolios on other streets are useful observations,
        // but do not become complete street inventories by association.
        return { id: `history:${h.id}`, at: h.acquiredAt ?? h.at, complete: Boolean(h.inventoryComplete) && keys.length > 0, keys: [...new Set(keys.length ? keys : rows.map(r => r.unit.key))] };
      }
      const unresolved = h.issues.some(issue => {
        const address = issue.source?.fullAddress ?? issue.address;
        const identity = address && addressIdentity(stripSisterMunicipalityPrefix(address, "BITONTO"));
        // An issue on another identifiable street cannot change this street's denominator.
        return !identity || names.has(normalizeSisterStreet(identity.street));
      });
      return { id: `history:${h.id}`, at: h.acquiredAt ?? rows.map(r => r.observation.at).filter(valid).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? h.at, complete: Boolean(h.acquisitionComplete) && !unresolved, keys: [...new Set(rows.map(r => r.unit.key))] };
    })
  ].filter(r => valid(r.at)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const cohort = candidates[0];
  const imported = new Map<string, string | null>();
  const add = (key: string, at: string | null | undefined) => {
    if (!cohort?.keys.includes(key)) return;
    const date = valid(at) && Date.parse(at) <= now && Date.parse(at) >= Date.parse(cohort.at) ? at : null;
    if (!imported.has(key) || (date && (!imported.get(key) || Date.parse(date) > Date.parse(imported.get(key)!)))) imported.set(key, date);
  };
  if (cohort) {
    const currentObservations = new Map(observations(cohort.id).map(row => [row.unit.key, row]));
    for (const { unit, observation } of currentObservations.values()) if (observation.crmId && observation.importVerified) add(unit.key, observation.importedAt);
    for (const run of state.runs) if (run.operation === "apply" && run.acquisitionRunId === cohort.id) for (const [key, proof] of Object.entries(run.imports ?? {})) if (proof.crmId) add(key, proof.at);
  }
  const lastImportedAt = [...imported.values()].filter(valid).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const observed = cohort?.keys.length ?? 0, total = cohort?.complete ? observed : null;
  return { acquisitionRunId: cohort?.id ?? null, acquiredAt: cohort?.at ?? null, complete: Boolean(cohort?.complete), observed, total, imported: imported.size, percent: total ? Math.round(imported.size / total * 100) : null, lastImportedAt, ...importAge(lastImportedAt, now), distribution: importDistribution(state, cohort?.keys ?? [], total, now) };
}
