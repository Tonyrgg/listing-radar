import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../src/desktop/renderer/index.html", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");

describe("filtri via completa nel desktop", () => {
  it("espone piano, intervallo civici e Solo abitazioni", () => {
    for (const id of ["streetFloorMode", "streetFloorValue", "streetMinCivic", "streetMaxCivic", "streetResidentialOnly"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="streetResidentialOnly" type="checkbox" checked');
  });

  it("inoltra i valori al processo principale e al servizio SISTER", () => {
    expect(renderer).toContain('residentialOnly: $("streetResidentialOnly").checked');
    expect(renderer).toContain('floorMode: $("streetFloorMode").value');
    expect(renderer).toContain('minCivicNumber: nullableNumber($("streetMinCivic").value)');
    expect(main).toContain("filters: values.filters");
    expect(main).toContain("filters,");
  });
});
