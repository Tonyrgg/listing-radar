import { z } from "zod";
import { effectiveSource, type TerritoryState } from "./model.js";
import { extractPropertyFloors } from "../core/network-exploration.js";
import { unitMemory } from "./unit-memory.js";

const ids = z.array(z.string().min(1).max(150)).max(10000).default([]);
export const unitQuerySchema = z.object({
  zoneIds: ids, streetIds: ids, ownerTaxCodes: z.array(z.string().regex(/^[A-Z0-9]{16}$/)).max(10000).default([]),
  localities: z.array(z.enum(["Bitonto", "Palombaio", "Mariotto"])).max(3).default([]),
  categories: z.array(z.string().regex(/^[A-C]\/\d{1,2}$/)).max(50).default([]),
  floors: z.array(z.number().int().min(-10).max(100)).max(110).default([]),
  imports: z.enum(["any", "never", "imported"]).default("any"), olderThanDays: z.number().int().min(0).max(36500).nullable().default(null),
}).strict();
export type UnitQuery = z.infer<typeof unitQuerySchema>;
export type WorkerZone = { id: string; name: string; streetIds: string[]; updatedAt: string };
export type SavedUnitQuery = { id: string; name: string; query: UnitQuery; updatedAt: string };

/** Current people are indexed once by CF; original observation snapshots remain evidence. */
export function queryCatalog(state: TerritoryState) {
  const owners = new Map<string, { taxCode: string; names: Set<string>; propertyKeys: Set<string>; streetIds: Set<string> }>();
  const categories = new Set<string>(), floors = new Set<number>();
  for (const unit of Object.values(state.units)) {
    const source = effectiveSource(unit); categories.add(source.category.trim().toUpperCase());
    extractPropertyFloors(source.fullAddress).forEach(f => floors.add(f));
    for (const owner of source.owners) {
      const cf = owner.taxCode.trim().toUpperCase(); if (!/^[A-Z0-9]{16}$/.test(cf)) continue;
      const person = owners.get(cf) ?? { taxCode: cf, names: new Set<string>(), propertyKeys: new Set<string>(), streetIds: new Set<string>() };
      person.names.add(owner.fullName); person.propertyKeys.add(unit.key); unit.streetIds.forEach(id => person.streetIds.add(id)); owners.set(cf, person);
    }
  }
  return { zones: Object.values(state.zones ?? {}).sort((a, b) => a.name.localeCompare(b.name, "it")), saved: Object.values(state.savedQueries ?? {}),
    owners: [...owners.values()].map(o => ({ taxCode: o.taxCode, name: [...o.names].sort().join(" / "), names: [...o.names], properties: o.propertyKeys.size, propertyKeys: [...o.propertyKeys], streetIds: [...o.streetIds] })).sort((a, b) => a.name.localeCompare(b.name, "it")),
    categories: [...categories].filter(c => /^[A-C]\/\d{1,2}$/.test(c)).sort(), floors: [...floors].sort((a, b) => a - b),
  };
}
/** OR within a field, AND across fields. Missing floors/locations never satisfy a filter. */
export function queryUnitKeys(state: TerritoryState, input: unknown, now = Date.now()) {
  const query = unitQuerySchema.parse(input);
  const zoneStreets = new Set(query.zoneIds.flatMap(id => {
    const zone = state.zones?.[id]; if (!zone) throw new Error("Una zona della query non è più disponibile"); return zone.streetIds;
  }));
  const streets = new Map(state.streets.map(s => [s.id, s]));
  for (const id of query.streetIds) if (!streets.has(id)) throw new Error("Una via della query non è più disponibile");
  return Object.values(state.units).filter(unit => {
    const source = effectiveSource(unit);
    if (source.municipality.trim().toUpperCase() !== "BITONTO") return false;
    const streetIds = unit.streetIds.map(id => streets.get(id)?.linkedOfficialId ?? id);
    if (query.zoneIds.length && !streetIds.some(id => zoneStreets.has(id))) return false;
    if (query.streetIds.length && !streetIds.some(id => query.streetIds.includes(id))) return false;
    if (query.localities.length && !streetIds.some(id => query.localities.includes(streets.get(id)?.locality as typeof query.localities[number]))) return false;
    if (query.ownerTaxCodes.length && !source.owners.some(o => query.ownerTaxCodes.includes(o.taxCode.trim().toUpperCase()))) return false;
    if (query.categories.length && !query.categories.includes(source.category.trim().toUpperCase())) return false;
    if (query.floors.length && !extractPropertyFloors(source.fullAddress).some(f => query.floors.includes(f))) return false;
    if (query.imports !== "any" || query.olderThanDays !== null) {
      const memory = unitMemory(unit), imported = memory.statistics.verifiedImports > 0;
      if (query.imports === "never" && imported || query.imports === "imported" && !imported) return false;
      const at = memory.statistics.lastImportedAt;
      if (query.olderThanDays !== null && (!at || (now - Date.parse(at)) / 86400000 < query.olderThanDays)) return false;
    }
    return true;
  }).map(u => u.key).sort();
}
