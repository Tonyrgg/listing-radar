import { describe, expect, it } from "vitest";

import { isManagedCrmOwnership, isManagedOwnershipRight } from "../src/import-v2/ownership-policy.js";

describe("Import V2 ownership scope", () => {
  it.each(["Proprietà", "Piena proprietà per 1/2", "Nuda proprieta'", "Nudo proprietario"])(
    "gestisce il diritto privato %s",
    (right) => expect(isManagedOwnershipRight(right)).toBe(true),
  );

  it.each(["Usufrutto", "Diritto di abitazione", "Enfiteusi", ""])(
    "ignora il diritto %s",
    (right) => expect(isManagedOwnershipRight(right)).toBe(false),
  );

  it("protegge aziende, usufruttuari e collegamenti senza CF", () => {
    expect(isManagedCrmOwnership({ taxCode: "01234567890", rightType: "Proprietà" })).toBe(false);
    expect(isManagedCrmOwnership({ taxCode: "RSSMRA80A01A893P", rightType: "Usufrutto" })).toBe(false);
    expect(isManagedCrmOwnership({ taxCode: null, rightType: "Proprietà" })).toBe(false);
  });

  it("gestisce un proprietario privato dal ruolo anche senza usare il diritto", () => {
    expect(isManagedCrmOwnership({
      taxCode: "RSSMRA80A01A893P",
      rightType: null,
      role: "Comproprietario",
    })).toBe(true);
  });
});
