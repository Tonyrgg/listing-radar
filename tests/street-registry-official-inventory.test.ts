import { describe, expect, it } from "vitest";

import { normalizeStreetName, parseOfficialStreetInventory } from "@/lib/street-registry/official-inventory";

const header = "Codvia,Specie,Descrizione,Cap,Comune\n";

describe("official Bitonto street inventory", () => {
  it("preserves municipal codes even when display names are duplicated", () => {
    const rows = parseOfficialStreetInventory(header
      + "001,VIA,ROMA,70032,BITONTO\n"
      + "002,VIA,ROMA,70032,BITONTO\n"
      + '003,VICO,"D\'ARAGONA, PALOMBAIO",70032,BITONTO\n');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ official_code: "001", canonical_name: "VIA ROMA", record_status: "active" });
    expect(rows[1]).toMatchObject({ official_code: "002", canonical_name: "VIA ROMA" });
    expect(rows[2]).toMatchObject({ locality: "PALOMBAIO", canonical_name: "VICO D'ARAGONA, PALOMBAIO" });
  });

  it("normalizes accents and typographic apostrophes for deterministic matching", () => {
    expect(normalizeStreetName("  via  Nicolò d’Angiò ")).toBe("VIA NICOLO D'ANGIO");
  });

  it("flags legacy or generic records for review", () => {
    const rows = parseOfficialStreetInventory(header
      + "010,ALTRO,AREA TEST,70032,BITONTO\n"
      + "011,VIA,SOPPRESSA,70032,BITONTO\n");

    expect(rows.map((row) => row.record_status)).toEqual(["needs_review", "needs_review"]);
  });

  it("rejects duplicate codes and unexpected municipalities", () => {
    expect(() => parseOfficialStreetInventory(header
      + "001,VIA,ROMA,70032,BITONTO\n"
      + "001,VIA,MILANO,70032,BITONTO\n"))
      .toThrow("Codvia duplicato");
    expect(() => parseOfficialStreetInventory(header + "002,VIA,ROMA,70032,BARI\n"))
      .toThrow("Comune inatteso");
  });
});
