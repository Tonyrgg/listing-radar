export function matchesUnitFilters(unit, filters, now = Date.now()) {
  if (filters.floors.length && !unit.position.floors.some(f => filters.floors.includes(String(f)))) return false;
  if (filters.categories.length && !filters.categories.includes(unit.source.category.trim().toUpperCase())) return false;
  if (filters.owners.length && !unit.source.owners.some(o => filters.owners.includes(o.taxCode.trim().toUpperCase()))) return false;
  const imported = unit.memory.statistics.verifiedImports > 0;
  if (filters.imports === 'never' && imported || filters.imports === 'imported' && !imported) return false;
  const at = unit.memory.statistics.lastImportedAt;
  if (filters.age !== null && (!at || !Number.isFinite(Date.parse(at)) || (now - Date.parse(at)) / 86400000 < filters.age)) return false;
  const civic = /^\d+/.exec(unit.position.civic || '')?.[0];
  if ((filters.minCivic !== null || filters.maxCivic !== null) && (!civic || (filters.minCivic !== null && Number(civic) < filters.minCivic) || (filters.maxCivic !== null && Number(civic) > filters.maxCivic))) return false;
  return true;
}
export const emptyUnitFilters = () => ({ floors: [], categories: [], owners: [], imports: 'any', age: null, minCivic: null, maxCivic: null });
