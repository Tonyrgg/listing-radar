import { describe, expect, it } from "vitest";
// @ts-expect-error Renderer module is deliberately shared with the actual UI.
import { matchesUnitFilters, emptyUnitFilters } from "../src/territory/renderer/unit-filters.js";

// @ts-expect-error Actual renderer fact used by street and queue cards.
import { unitImportTone, unitImportHtml } from "../src/territory/renderer/unit-card.js";
const unit = (floors = [0, 1], civic = "12/A", date: string | null = "2026-10-10T00:00:00Z") => ({
  source: { category: "A/3", owners: [{ taxCode: "RSSMRA80A01A662A" }] },
  position: { floors, civic }, memory: { statistics: { verifiedImports: date ? 1 : 0, lastImportedAt: date } },
});
describe("Filtri delle schede via", () => {
  it("combina piani, intestatari, categorie e civici senza includere valori ignoti", () => {
    const filters = { ...emptyUnitFilters(), floors: ["1", "2"], categories: ["A/3"], owners: ["RSSMRA80A01A662A"], minCivic: 10, maxCivic: 12 };
    expect(matchesUnitFilters(unit(), filters)).toBe(true);
    expect(matchesUnitFilters(unit([], "12"), filters)).toBe(false);
    expect(matchesUnitFilters(unit([1], "."), filters)).toBe(false);
    expect(matchesUnitFilters(unit([1], "14"), filters)).toBe(false);
    expect(matchesUnitFilters(unit([1], "12"), { ...filters, categories: ["C/6"] })).toBe(false);
  });
  it("usa solo import verificati con data valida per il filtro di anzianità", () => {
    const now = Date.parse("2026-10-11T00:00:00Z");
    expect(matchesUnitFilters(unit(), { ...emptyUnitFilters(), imports: "never" }, now)).toBe(false);
    expect(matchesUnitFilters(unit([1], "12", null), { ...emptyUnitFilters(), imports: "never" }, now)).toBe(true);
    expect(matchesUnitFilters(unit(), { ...emptyUnitFilters(), imports: "imported", age: 1 }, now)).toBe(true);
    expect(matchesUnitFilters(unit(), { ...emptyUnitFilters(), age: 2 }, now)).toBe(false);
    expect(matchesUnitFilters(unit([1], "12", "data assente"), { ...emptyUnitFilters(), age: 0 }, now)).toBe(false);
    expect(matchesUnitFilters(unit([1], "12", null), { ...emptyUnitFilters(), age: 0 }, now)).toBe(false);
  });
});

describe("Fatto d’import del singolo immobile", () => {
  it("mostra età e colori dai successi verificati, indipendenti dalle run", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    for (const [days, expected] of [[0, "recent"], [30, "recent"], [31, "aging"], [90, "aging"], [91, "stale"]] as const) {
      expect(unitImportTone(unit([1], "12", new Date(now - days * 86400000).toISOString()), now)).toBe(expected);
    }
    expect(unitImportTone(unit([1], "12", null), now)).toBe("acquired");
    expect(unitImportHtml(unit([1], "12", null), (s: string) => s, (s: string) => s)).toContain("Mai importato in Cloud");
    const undated = unit([1], "12", null); undated.memory.statistics.verifiedImports = 1;
    expect(unitImportTone(undated, now)).toBe("never");
    expect(unitImportHtml(undated, (s: string) => s, (s: string) => s)).toContain("Data non disponibile");
  });
});
