import type { TerritoryState } from "./model.js";
import { normalizeSisterStreet } from "../core/street-scan.js";
import { stripSisterMunicipalityPrefix } from "../core/normalize.js";
import { addressIdentity } from "../import-v2/identity.js";

const valid = (at: string | null | undefined): at is string => Boolean(at && Number.isFinite(Date.parse(at)));
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
  const candidates = [
    ...state.runs.filter(r => r.operation === "scan" && streetIds.includes(r.streetId)).reverse().map(r => ({ id: r.id, at: r.startedAt, complete: r.state === "completed", keys: [...new Set(r.itemKeys)] })),
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
  return { acquisitionRunId: cohort?.id ?? null, acquiredAt: cohort?.at ?? null, complete: Boolean(cohort?.complete), observed, total, imported: imported.size, percent: total ? Math.round(imported.size / total * 100) : null, lastImportedAt, ...importAge(lastImportedAt, now) };
}
