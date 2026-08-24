import { describe, expect, it } from "vitest";

import { selectOwnerLookupCandidate } from "../src/core/owner-link-selection.js";

describe("selezione comproprietario nella modale Tecnocloud", () => {
  it("preferisce l'identificativo della scheda già verificata quando coincide anche il nome", () => {
    expect(selectOwnerLookupCandidate([
      { personId: "P-1", text: "Mario Rossi · 3331111111" },
      { personId: "P-2", text: "Mario Rossi · 3332222222" },
    ], "P-2", ["3332222222"], "Mario Rossi")).toMatchObject({ index: 1, selection: "crm_id", note: null });
  });

  it("non seleziona un omonimo quando esiste un telefono raccolto ma non coincide", () => {
    expect(selectOwnerLookupCandidate([
      { personId: "P-2", text: "Mario Rossi · 333 111 1111" },
    ], "P-2", ["3332222222"], "Mario Rossi")).toBeNull();
  });

  it("non seleziona un record con identificativo giusto ma nome diverso", () => {
    expect(selectOwnerLookupCandidate([
      { personId: "P-2", text: "Luigi Bianchi · 333 222 2222" },
    ], "P-2", ["3332222222"], "Mario Rossi")).toBeNull();
  });

  it("disambigua gli omonimi tramite cellulare anche con prefisso +39", () => {
    expect(selectOwnerLookupCandidate([
      { personId: "", text: "Mario Rossi · +39 333 111 1111" },
      { personId: "", text: "Mario Rossi · 333 222 2222" },
    ], "P-2", ["0039 3332222222"], "Mario Rossi")).toMatchObject({ index: 1, selection: "phone", note: null });
  });

  it("sceglie il primo solo come ultima risorsa e genera una nota auditabile", () => {
    const result = selectOwnerLookupCandidate([
      { personId: "", text: "Mario Rossi" },
      { personId: "", text: "Mario Rossi" },
    ], "P-2", [], "Mario Rossi");
    expect(result).toMatchObject({ index: 0, selection: "first_ambiguous" });
    expect(result?.note).toContain("primo di 2 omonimi");
  });
});
