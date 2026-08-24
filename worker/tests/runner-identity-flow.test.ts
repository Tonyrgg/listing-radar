import { describe, expect, it, vi } from "vitest";

import { PropertyWorkerRunner } from "../src/services/runner.js";
import type { PersonRow, PropertyRow } from "../src/services/repository.js";
import type { WorkerConfig } from "../src/config.js";

const config: WorkerConfig = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-long-enough-for-tests",
  CHROME_CDP_URL: "http://127.0.0.1:9222",
  CONTACTS_EXCEL_PATH: "C:\\test.xlsx",
  WORKER_MODE: "automatic",
  WORKER_DRY_RUN: false,
  ERROR_SCREENSHOT_DIR: "C:\\worker-errors",
  ERROR_SCREENSHOT_RETENTION_DAYS: 14,
  SISTER_TAB_MATCH: "sister",
  CRM_TAB_MATCH: "crm",
  SISTER_KEEPALIVE_ENABLED: false,
  SISTER_KEEPALIVE_MIN_SECONDS: 120,
  SISTER_KEEPALIVE_MAX_SECONDS: 180,
  SISTER_KEEPALIVE_URL: undefined,
};

const job = {
  id: "job-1",
  mode: "automatic",
  municipality: "BITONTO",
  street: "VIA ROMA",
  civic_number: "10",
} as const;

function personRow(): PersonRow {
  return {
    id: "person-row", job_id: job.id, full_name: "ROSSI MARIO", birth_place: "BITONTO",
    birth_province: "BA", birth_date: "1980-01-01", tax_code: "RSSMRA80A01A893X",
    right_type: "Proprietà", share_original: "1/1", share_numerator: 1,
    share_denominator: 1, share_percentage: 100, mobiles: [], landlines: [], emails: [],
    raw_payload: {}, processing_status: "normalized", crm_record_id: null,
  };
}

function propertyRow(): PropertyRow {
  return {
    id: "property-row", job_id: job.id, municipality: "BITONTO", sheet: "50", parcel: "100",
    subaltern: "4", cadastral_key: "BITONTO|50|100|4", address: "VIA ROMA n. 10 Piano 1",
    census_zone: "U", category: "A/3", class: "4", consistency: "5 vani",
    cadastral_income: 500, raw_payload: {}, processing_status: "normalized", crm_record_id: null,
  };
}

function runnerWithRepository() {
  const runner = new PropertyWorkerRunner(config, { keepAlive: false });
  const repository = {
    updatePersonProcessing: vi.fn().mockResolvedValue(undefined),
    updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
    updateContacts: vi.fn().mockResolvedValue(undefined),
    logChange: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(runner, "repository", { value: repository });
  return { runner, repository };
}

describe("flusso identità nominativo e immobile", () => {
  it("non sceglie alla cieca tra due schede con lo stesso CF", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const repository = {
      updatePersonProcessing: vi.fn().mockResolvedValue(undefined),
      logChange: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(runner, "repository", { value: repository });
    const row: PersonRow = {
      ...personRow(),
      processing_status: "duplicate_candidates",
      raw_payload: { crm_matches: [{ id: "CRM-PERSON-1" }, { id: "CRM-PERSON-2" }] },
    };
    const crm = {
      openExistingPerson: vi.fn(async (_input: unknown, expectedId?: string) => ({
        id: expectedId,
        data: { taxCodeVerified: true, nameVerified: true },
      })),
      findPerson: vi.fn().mockResolvedValue({
        matches: [
          { id: "CRM-PERSON-1", label: "Mario Rossi", confidence: "certain", data: { source: "crm-tax-code-search" } },
          { id: "CRM-PERSON-2", label: "Mario Rossi", confidence: "certain", data: { source: "crm-tax-code-search" } },
        ],
      }),
      createPerson: vi.fn(),
    };

    await expect((runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm))
      .rejects.toMatchObject({ status: "needs_review", details: { action: "person-multiple-exact-matches" } });

    expect(crm.findPerson).toHaveBeenCalledOnce();
    expect(crm.openExistingPerson).toHaveBeenCalledTimes(2);
    expect(crm.createPerson).not.toHaveBeenCalled();
    expect(row.crm_record_id).toBeNull();
  });

  it("risolve due schede con lo stesso CF soltanto quando il cellulare identifica un candidato unico", async () => {
    const { runner } = runnerWithRepository();
    const row = { ...personRow(), mobiles: ["3331234567"] };
    const crm = {
      findPerson: vi.fn().mockResolvedValue({
        matches: [
          { id: "CRM-PERSON-1", label: "Mario Rossi", confidence: "certain", data: {} },
          { id: "CRM-PERSON-2", label: "Mario Rossi", confidence: "certain", data: {} },
        ],
      }),
      openExistingPerson: vi.fn(async (_input: unknown, expectedId?: string) => ({
        id: expectedId,
        data: { taxCodeVerified: true, nameVerified: true },
      })),
      findPhoneAssignments: vi.fn().mockResolvedValue([
        { phone: "3331234567", personId: "CRM-PERSON-2", label: "Mario Rossi" },
      ]),
      createPerson: vi.fn(),
    };

    await (runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm);

    expect(row.crm_record_id).toBe("CRM-PERSON-2");
    expect(row.raw_payload?.person_flow).toMatchObject({
      selectionPolicy: "unique-phone-among-exact-tax-code",
      identityVerified: true,
    });
  });

  it("entra nel nominativo verificato e non ne crea uno nuovo", async () => {
    const { runner } = runnerWithRepository();
    const row = personRow();
    const crm = {
      findPerson: vi.fn().mockResolvedValue({
        matches: [{ id: "CRM-PERSON-1", label: "Mario Rossi", confidence: "certain", data: { source: "crm-tax-code-search" } }],
      }),
      openExistingPerson: vi.fn().mockResolvedValue({
        id: "CRM-PERSON-1",
        data: { taxCodeVerified: true, nameVerified: true },
      }),
      createPerson: vi.fn(),
    };

    await (runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm);

    expect(crm.findPerson).toHaveBeenCalledOnce();
    expect(crm.openExistingPerson).toHaveBeenCalledWith(expect.any(Object), "CRM-PERSON-1");
    expect(crm.createPerson).not.toHaveBeenCalled();
    expect(row.crm_record_id).toBe("CRM-PERSON-1");
  });

  it("sostituisce nel checkpoint il vecchio ID eliminato dal merge con quello recuperato", async () => {
    const { runner, repository } = runnerWithRepository();
    const row: PersonRow = {
      ...personRow(),
      crm_record_id: "CRM-PERSON-DELETED",
      raw_payload: {
        person_flow: {
          version: 3,
          complete: true,
          dryRun: false,
          crmPersonId: "CRM-PERSON-DELETED",
        },
      },
    };
    const crm = {
      openExistingPerson: vi.fn().mockResolvedValue({
        id: "CRM-PERSON-MERGED",
        data: { recoveredFromAccessDenied: true },
      }),
      findPerson: vi.fn(),
      createPerson: vi.fn(),
    };

    await (runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm);

    expect(row.crm_record_id).toBe("CRM-PERSON-MERGED");
    expect(crm.findPerson).not.toHaveBeenCalled();
    expect(repository.updatePersonProcessing).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ crm_record_id: "CRM-PERSON-MERGED" }),
    );
  });

  it("con più profili verificati apre tutti i candidati e richiede una disambiguazione", async () => {
    const { runner } = runnerWithRepository();
    const row = personRow();
    const crm = {
      findPerson: vi.fn().mockResolvedValue({
        matches: [
          { id: "CRM-PERSON-FIRST", label: "Mario Rossi", confidence: "certain", data: { source: "crm-tax-code-search" } },
          { id: "CRM-PERSON-SECOND", label: "Mario Rossi", confidence: "certain", data: { source: "crm-tax-code-search" } },
        ],
      }),
      openExistingPerson: vi.fn(async (_input: unknown, expectedId?: string) => ({
        id: expectedId,
        data: { taxCodeVerified: true, nameVerified: true },
      })),
      createPerson: vi.fn(),
    };

    await expect((runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm))
      .rejects.toMatchObject({ status: "needs_review" });

    expect(crm.openExistingPerson).toHaveBeenCalledTimes(2);
    expect(crm.openExistingPerson).toHaveBeenCalledWith(expect.any(Object), "CRM-PERSON-FIRST");
    expect(crm.openExistingPerson).toHaveBeenCalledWith(expect.any(Object), "CRM-PERSON-SECOND");
    expect(crm.createPerson).not.toHaveBeenCalled();
    expect(row.crm_record_id).toBeNull();
    expect(row.raw_payload?.person_search).toMatchObject({
      candidateCount: 2,
      verifiedCount: 2,
      selectionPolicy: "manual-review-multiple-exact-tax-code",
    });
  });

  it("crea il nominativo soltanto dopo una ricerca senza schede verificate", async () => {
    const { runner } = runnerWithRepository();
    const row = personRow();
    const crm = {
      findPerson: vi.fn().mockResolvedValue({ matches: [] }),
      openExistingPerson: vi.fn().mockResolvedValue({
        id: "CRM-PERSON-NEW",
        data: { taxCodeVerified: true, nameVerified: true },
      }),
      createPerson: vi.fn().mockResolvedValue({
        personId: "CRM-PERSON-NEW",
        mergeStatus: "not_required",
        details: {},
      }),
    };

    await (runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm);

    expect(crm.findPerson).toHaveBeenCalledOnce();
    expect(crm.createPerson).toHaveBeenCalledOnce();
    expect(row.crm_record_id).toBe("CRM-PERSON-NEW");
  });

  it("dopo la creazione sincronizza i recapiti senza ricercare nuovamente il nominativo per cellulare", async () => {
    const { runner } = runnerWithRepository();
    const row: PersonRow = {
      ...personRow(),
      crm_record_id: "CRM-PERSON-NEW",
      mobiles: ["3331234567"],
      raw_payload: {
        person_flow: {
          version: 3,
          complete: true,
          existing: false,
          crmPersonId: "CRM-PERSON-NEW",
        },
      },
    };
    const contacts = {
      findByTaxCode: vi.fn().mockReturnValue({
        mobiles: ["3331234567"],
        landlines: [],
        emails: [],
        whatsapp: [],
        matchedRows: 1,
        overflowPhones: [],
        notes: [],
      }),
    };
    const crm = {
      findMissingPersonPhones: vi.fn(),
      findPhoneAssignments: vi.fn(),
      transferPhoneAssignments: vi.fn().mockResolvedValue({
        moved: [],
        alreadyAssigned: ["3331234567"],
        simulated: false,
      }),
    };

    await (runner as unknown as { ensureContacts: Function }).ensureContacts(job, row, crm, contacts, true);

    expect(crm.findMissingPersonPhones).not.toHaveBeenCalled();
    expect(crm.findPhoneAssignments).not.toHaveBeenCalled();
    expect(crm.transferPhoneAssignments).toHaveBeenCalledWith("CRM-PERSON-NEW", expect.any(Object), []);
    expect(row.raw_payload?.contacts_flow).toMatchObject({
      phoneSearchSkippedAfterCreation: true,
      phonesCheckedInGlobalSearch: [],
    });
  });

  it("aggiorna l'immobile trovato sotto il nominativo e non lo duplica", async () => {
    const { runner } = runnerWithRepository();
    const property = propertyRow();
    const primary = { ...personRow(), crm_record_id: "CRM-PERSON-1" };
    const match = { id: "CRM-PROPERTY-1", data: { identityVerified: true } };
    const crm = {
      findPropertyForPerson: vi.fn().mockResolvedValue({ match }),
      updateProperty: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn(),
      verifyProperty: vi.fn().mockResolvedValue({ match }),
    };

    await (runner as unknown as { ensureProperty: Function }).ensureProperty(job, property, primary, crm);

    expect(crm.findPropertyForPerson).toHaveBeenCalledTimes(2);
    expect(crm.updateProperty).toHaveBeenCalledWith("CRM-PROPERTY-1", expect.any(Object));
    expect(crm.createProperty).not.toHaveBeenCalled();
  });

  it("crea l'immobile assente una sola volta e verifica il collegamento prima di proseguire", async () => {
    const { runner } = runnerWithRepository();
    const property = propertyRow();
    const primary = { ...personRow(), crm_record_id: "CRM-PERSON-1" };
    const match = { id: "CRM-PROPERTY-NEW", data: { identityVerified: true } };
    const crm = {
      findPropertyForPerson: vi.fn()
        .mockResolvedValueOnce({ match: null })
        .mockResolvedValueOnce({ match }),
      updateProperty: vi.fn(),
      createProperty: vi.fn().mockResolvedValue("CRM-PROPERTY-NEW"),
      verifyProperty: vi.fn().mockResolvedValue({ match }),
    };

    await (runner as unknown as { ensureProperty: Function }).ensureProperty(job, property, primary, crm);

    expect(crm.createProperty).toHaveBeenCalledOnce();
    expect(crm.updateProperty).not.toHaveBeenCalled();
    expect(crm.verifyProperty).toHaveBeenCalledWith("CRM-PROPERTY-NEW", expect.any(Object));
    expect(property.crm_record_id).toBe("CRM-PROPERTY-NEW");
  });

  it("mette in quarantena un vecchio abbinamento basato soltanto sull'indirizzo", async () => {
    const { runner } = runnerWithRepository();
    const property = {
      ...propertyRow(),
      crm_record_id: "CRM-PROPERTY-WRONG",
      raw_payload: {
        crm_match: {
          id: "CRM-PROPERTY-WRONG",
          data: { matchedBy: "street-and-civic" },
        },
      },
    };
    const primary = { ...personRow(), crm_record_id: "CRM-PERSON-1" };
    const verifiedNew = { id: "CRM-PROPERTY-NEW", data: { identityVerified: true } };
    const crm = {
      findPropertyForPerson: vi.fn()
        .mockResolvedValueOnce({ match: null })
        .mockResolvedValueOnce({ match: verifiedNew }),
      updateProperty: vi.fn(),
      createProperty: vi.fn().mockResolvedValue("CRM-PROPERTY-NEW"),
      verifyProperty: vi.fn().mockResolvedValue({ match: verifiedNew }),
    };

    await (runner as unknown as { ensureProperty: Function }).ensureProperty(job, property, primary, crm);

    expect(crm.findPropertyForPerson).toHaveBeenNthCalledWith(
      1,
      "CRM-PERSON-1",
      expect.any(Object),
      ["CRM-PROPERTY-WRONG"],
    );
    expect(crm.updateProperty).not.toHaveBeenCalled();
    expect(crm.createProperty).toHaveBeenCalledOnce();
    expect(property.crm_record_id).toBe("CRM-PROPERTY-NEW");
  });

  it("dopo un errore sull'immobile riparte dall'immobile senza ricercare nominativo e recapiti", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const person = { ...personRow(), crm_record_id: "CRM-PERSON-1", processing_status: "contacts_matched" };
    const property = {
      ...propertyRow(),
      raw_payload: {
        property_flow: { version: 2, stage: "contacts_synced", dryRun: false },
      },
    };
    const ownership = {
      id: "ownership-1", property_id: property.id, person_id: person.id,
      right_type: "Proprietà", share_percentage: 100, crm_link_id: null,
      processing_status: "normalized",
    };
    const repository = {
      loadGraph: vi.fn().mockResolvedValue({ properties: [property], people: [person], ownerships: [ownership] }),
      updatePersonProcessing: vi.fn().mockResolvedValue(undefined),
      updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
      updateOwnership: vi.fn().mockResolvedValue(undefined),
      updateJob: vi.fn().mockResolvedValue(undefined),
      logChange: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(runner, "repository", { value: repository });
    const match = { id: "CRM-PROPERTY-1", data: { identityVerified: true } };
    const crm = {
      findPerson: vi.fn(),
      findPropertyForPerson: vi.fn().mockResolvedValue({ match }),
      updateProperty: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn(),
      verifyProperty: vi.fn().mockResolvedValue({ match }),
      createPropertyActivity: vi.fn().mockResolvedValue({
        outcome: "created", crmActivityId: "ACTIVITY-1", correlatedProperty: "VIA ROMA 10", attempts: 1,
      }),
    };
    const contacts = { findByTaxCode: vi.fn() };

    await (runner as unknown as { processPropertiesInOrder: Function }).processPropertiesInOrder(
      { ...job, total_properties: 1, processed_properties: 0 },
      crm,
      contacts,
    );

    expect(crm.findPerson).not.toHaveBeenCalled();
    expect(contacts.findByTaxCode).not.toHaveBeenCalled();
    expect(crm.updateProperty).toHaveBeenCalledOnce();
    expect(crm.createPropertyActivity).toHaveBeenCalledOnce();
  });

  it("verifica tutti i proprietari e collega i comproprietari dopo immobile e attività", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const primary = { ...personRow(), id: "primary", crm_record_id: "CRM-PRIMARY", share_percentage: 70 };
    const coowner = {
      ...personRow(),
      id: "coowner",
      full_name: "BIANCHI LUCA",
      tax_code: "BNCLCU80A01A893X",
      crm_record_id: "CRM-COOWNER",
      share_percentage: 30,
      mobiles: ["3331234567"],
    };
    const property = propertyRow();
    const ownerships = [
      { id: "ownership-primary", property_id: property.id, person_id: primary.id, right_type: "Proprietà", share_percentage: 70, crm_link_id: null, processing_status: "normalized" },
      { id: "ownership-coowner", property_id: property.id, person_id: coowner.id, right_type: "Proprietà", share_percentage: 30, crm_link_id: null, processing_status: "normalized" },
    ];
    const repository = {
      loadGraph: vi.fn().mockResolvedValue({ properties: [property], people: [primary, coowner], ownerships }),
      updatePersonProcessing: vi.fn().mockResolvedValue(undefined),
      updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
      updateOwnership: vi.fn().mockResolvedValue(undefined),
      updateJob: vi.fn().mockResolvedValue(undefined),
      logChange: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(runner, "repository", { value: repository });
    const internals = runner as unknown as {
      ensureContacts: ReturnType<typeof vi.fn>;
      ensurePerson: ReturnType<typeof vi.fn>;
      ensureProperty: ReturnType<typeof vi.fn>;
      ensurePropertyActivity: ReturnType<typeof vi.fn>;
      processPropertiesInOrder: Function;
    };
    internals.ensureContacts = vi.fn().mockResolvedValue(undefined);
    internals.ensurePerson = vi.fn().mockResolvedValue(undefined);
    internals.ensureProperty = vi.fn().mockImplementation(async () => { property.crm_record_id = "CRM-PROPERTY"; });
    internals.ensurePropertyActivity = vi.fn().mockResolvedValue(undefined);
    const crm = {
      linkOwner: vi.fn().mockResolvedValue({
        linkId: "owner-link-CRM-COOWNER",
        selection: "phone",
        candidateCount: 2,
        note: null,
      }),
    };

    await internals.processPropertiesInOrder(
      { ...job, total_properties: 1, processed_properties: 0 },
      crm,
      { findByTaxCode: vi.fn() },
    );

    expect(internals.ensurePerson).toHaveBeenCalledTimes(2);
    expect(internals.ensurePropertyActivity).toHaveBeenCalledWith(
      expect.anything(),
      property,
      primary,
      [primary, coowner],
      crm,
    );
    expect(crm.linkOwner).toHaveBeenCalledWith(
      "CRM-PROPERTY",
      expect.objectContaining({ personId: "CRM-COOWNER", phones: ["3331234567"] }),
      30,
    );
    expect(repository.updateOwnership).toHaveBeenCalledWith(
      "ownership-coowner",
      expect.objectContaining({ crm_link_id: "owner-link-CRM-COOWNER", processing_status: "linked" }),
    );
  });
});
