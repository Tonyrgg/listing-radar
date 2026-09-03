import { describe, expect, it, vi } from "vitest";

import { HybridTecnocloudV2Port } from "../src/import-v2/hybrid-port.js";
import type { TecnocloudV2Port } from "../src/import-v2/ports.js";

function port(label: string): TecnocloudV2Port {
  return {
    assertSession: vi.fn(async () => undefined),
    searchPeopleByExactTaxCode: vi.fn(async () => [{
      id: label, taxCode: "RSSMRA80A01A893P", fullName: label, birthDate: null, birthPlace: null, birthProvince: null, phones: [], emails: [],
    }]),
    readPerson: vi.fn(async (id, expectedTaxCode) => ({
      id, taxCode: expectedTaxCode ?? "RSSMRA80A01A893P", fullName: label, birthDate: null, birthPlace: null, birthProvince: null, phones: [], emails: [],
    })),
    createPerson: vi.fn(async (desired) => ({ id: label, ...desired })),
    overwritePerson: vi.fn(async (id, desired) => ({ id, ...desired })),
    mergePeople: vi.fn(async (request) => ({ id: request.canonicalPersonId, ...request.desired })),
    listAllPropertiesForPeople: vi.fn(async () => []),
    findPropertiesByCadastralIdentity: vi.fn(async () => []),
    createProperty: vi.fn(async () => { throw new Error("unused"); }),
    updateProperty: vi.fn(async () => { throw new Error("unused"); }),
    replaceManagedOwnerships: vi.fn(async (propertyId) => ({ propertyId, owners: [], removedPersonIds: [] })),
    readProperty: vi.fn(async () => { throw new Error("unused"); }),
    ensureActivity: vi.fn(async () => ({ activityId: null, outcome: "disabled" as const })),
    recover: vi.fn(async () => undefined),
  };
}

describe("Import V2 hybrid port", () => {
  it("usa HTTP per letture osservate e verificate", async () => {
    const http = port("http");
    const ui = port("ui");
    const hybrid = new HybridTecnocloudV2Port(http, ui, {
      supportsRead: (operation) => operation === "search_people",
      supportsVerifiedWrite: () => false,
    });

    expect((await hybrid.searchPeopleByExactTaxCode("RSSMRA80A01A893P"))[0]?.id).toBe("http");
    expect(http.searchPeopleByExactTaxCode).toHaveBeenCalledOnce();
    expect(ui.searchPeopleByExactTaxCode).not.toHaveBeenCalled();
  });

  it("mantiene le scritture sulla UI finché il contratto HTTP non è verificato", async () => {
    const http = port("http");
    const ui = port("ui");
    const hybrid = new HybridTecnocloudV2Port(http, ui, {
      supportsRead: () => false,
      supportsVerifiedWrite: () => false,
    });
    const desired = {
      taxCode: "RSSMRA80A01A893P", fullName: "Rossi Mario", firstName: "Mario", lastName: "Rossi", birthDate: null, birthPlace: null, birthProvince: null, phones: [], emails: [], privateNotes: null,
    };

    expect((await hybrid.createPerson(desired)).id).toBe("ui");
    expect(ui.createPerson).toHaveBeenCalledOnce();
    expect(http.createPerson).not.toHaveBeenCalled();
  });
});
