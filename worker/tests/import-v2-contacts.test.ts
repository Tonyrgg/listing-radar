import { describe, expect, it } from "vitest";

import { personWriteModel } from "../src/import-v2/contacts.js";
import type { CrmPersonSnapshot, SourceOwner } from "../src/import-v2/model.js";

const owner: SourceOwner = {
  sourcePersonId: "source-person",
  taxCode: "RSSMRA80A01A893P",
  fullName: "Rossi Mario",
  birthDate: null,
  birthPlace: "Bitonto",
  birthProvince: null,
  rightType: "Proprietà",
  sharePercentage: 100,
  contacts: { phones: ["+39 333 3333333"], emails: ["nuova@example.it"] },
};

const existing: CrmPersonSnapshot = {
  id: "crm-person",
  taxCode: owner.taxCode,
  fullName: "Nome precedente",
  birthDate: "1980-01-01",
  birthPlace: "Bari",
  birthProvince: "BA",
  phones: ["080 1111111", "3333333333"],
  emails: ["prima@example.it", "seconda@example.it"],
};

describe("Import V2 contact and overwrite policy", () => {
  it("non cancella valori esistenti quando SISTER non li fornisce", () => {
    expect(personWriteModel(owner, existing)).toMatchObject({
      fullName: "Rossi Mario",
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "1980-01-01",
      birthPlace: "Bitonto",
      birthProvince: "BA",
    });
  });

  it("separa nome e cognome soltanto quando sono provati dal codice fiscale", () => {
    const desired = personWriteModel({
      ...owner,
      taxCode: "RSSMRA80A01A893P",
      fullName: "ROSSI MARIO",
    }, null);
    expect({ firstName: desired.firstName, lastName: desired.lastName }).toEqual({
      firstName: "Mario",
      lastName: "Rossi",
    });
    expect(desired.fullName).toBe("Rossi Mario");
  });

  it.each(["DE LUCA MARIA ANNA", "de luca maria anna", "De LuCa mArIa AnNa"])("scrive le iniziali maiuscole per %s", (fullName) => {
    expect(personWriteModel({ ...owner, taxCode: "DLCMNN80A41A893P", fullName }, null))
      .toMatchObject({ firstName: "Maria Anna", lastName: "De Luca", fullName: "De Luca Maria Anna" });
  });

  it("conserva apostrofi e accenti nei nomi", () => {
    expect(personWriteModel({ ...owner, taxCode: "DNGNCL80A01A893P", fullName: "D'ANGELO NICOLÒ" }, null))
      .toMatchObject({ firstName: "Nicolò", lastName: "D'Angelo" });
  });

  it("conserva tutti i telefoni normalizzati senza duplicati", () => {
    expect(personWriteModel(owner, existing).phones).toEqual(["0801111111", "3333333333"]);
  });

  it("non cancella i quattro numeri già presenti quando il CRM non ha altri campi", () => {
    const crowded = { ...existing, phones: ["0801", "0802", "3331", "3332"] };
    expect(personWriteModel(owner, crowded).phones).toEqual(["0801", "0802", "3331", "3332"]);
  });

  it("usa al massimo due email dando priorità a quelle importate", () => {
    expect(personWriteModel(owner, existing).emails).toEqual(["nuova@example.it", "prima@example.it"]);
  });
});
