import { describe, expect, it, vi } from "vitest";

import { WorkerError } from "../src/core/errors.js";
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
  WORKER_KEEP_ACQUISITION: false,
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
  it("non ritenta un errore di identita' che richiede revisione", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const operation = vi.fn().mockRejectedValue(
      new WorkerError("Lookup non disponibile", "needs_review"),
    );

    await expect(
      (runner as unknown as { withAutomaticRecovery: Function }).withAutomaticRecovery(
        { ...job, mode: "assisted" },
        propertyRow(),
        1,
        1,
        "Ricerca immobile",
        operation,
      ),
    ).rejects.toMatchObject({
      details: { automaticAttempts: 1, automaticRecoveryExhausted: false },
    });
    expect(operation).toHaveBeenCalledOnce();
  }, 8_000);

  it("rianalizza automaticamente senza perdere gli ID CRM gia verificati", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const repository = { updatePropertyProcessing: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(runner, "repository", { value: repository });
    const property = { ...propertyRow(), crm_record_id: "CRM-PROPERTY-1" };
    const crm = { resetToCrmHome: vi.fn().mockResolvedValue(undefined) };

    await (runner as unknown as { reanalyzePropertyAutomatically: Function }).reanalyzePropertyAutomatically(
      { ...job, total_properties: 1 },
      property,
      1,
      1,
      2,
      new WorkerError("Salvataggio non confermato", "portal_error", { automaticAttempts: 3 }),
      crm,
    );

    expect(property.crm_record_id).toBe("CRM-PROPERTY-1");
    expect(property.raw_payload).toMatchObject({
      property_flow: { stage: "ready", reanalysisSource: "automatic", reanalysisAttempt: 2 },
      automatic_retry: { normalAttempts: 3, reanalysisAttempts: 2 },
    });
    expect(repository.updatePropertyProcessing).toHaveBeenCalledWith(
      property.id,
      expect.objectContaining({ processing_status: "normalized" }),
    );
    expect(crm.resetToCrmHome).toHaveBeenCalledOnce();
  });

  it("sceglie una scheda tra due candidati con lo stesso CF e non crea un duplicato", async () => {
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

    await (runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm);

    expect(crm.findPerson).toHaveBeenCalledOnce();
    expect(crm.openExistingPerson).toHaveBeenCalledTimes(2);
    expect(crm.createPerson).not.toHaveBeenCalled();
    expect(["CRM-PERSON-1", "CRM-PERSON-2"]).toContain(row.crm_record_id);
    expect(row.raw_payload?.person_flow).toMatchObject({ selectionPolicy: "random-exact-tax-code-candidate", identityVerified: true });
  });

  it("non usa il cellulare per bloccare la scelta casuale tra schede con lo stesso CF", async () => {
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

    expect(["CRM-PERSON-1", "CRM-PERSON-2"]).toContain(row.crm_record_id);
    expect(row.raw_payload?.person_flow).toMatchObject({
      selectionPolicy: "random-exact-tax-code-candidate",
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

    await (runner as unknown as { ensurePerson: Function }).ensurePerson(job, row, crm);

    expect(crm.openExistingPerson).toHaveBeenCalledTimes(2);
    expect(crm.openExistingPerson).toHaveBeenCalledWith(expect.any(Object), "CRM-PERSON-FIRST");
    expect(crm.openExistingPerson).toHaveBeenCalledWith(expect.any(Object), "CRM-PERSON-SECOND");
    expect(crm.createPerson).not.toHaveBeenCalled();
    expect(["CRM-PERSON-FIRST", "CRM-PERSON-SECOND"]).toContain(row.crm_record_id);
    expect(row.raw_payload?.person_search).toMatchObject({
      candidateCount: 2,
      verifiedCount: 2,
      selectionPolicy: "random-exact-tax-code-candidate",
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
      syncPersonContacts: vi.fn().mockResolvedValue(undefined),
    };

    await (runner as unknown as { ensureContacts: Function }).ensureContacts(job, row, crm, contacts, true);

    expect(crm.findMissingPersonPhones).not.toHaveBeenCalled();
    expect(crm.findPhoneAssignments).not.toHaveBeenCalled();
    expect(crm.syncPersonContacts).toHaveBeenCalledWith("CRM-PERSON-NEW", expect.any(Object));
    expect(row.raw_payload?.contacts_flow).toMatchObject({
      phoneSearchSkippedAfterCreation: true,
      phonesCheckedInGlobalSearch: [],
    });
  });

  it("mantiene sul nominativo Excel i recapiti già assegnati ad altre schede", async () => {
    const { runner, repository } = runnerWithRepository();
    const row = { ...personRow(), crm_record_id: "CRM-PERSON-NEW" };
    const contacts = {
      findByTaxCode: vi.fn().mockReturnValue({
        mobiles: ["3331234567"], landlines: [], emails: [], whatsapp: [], matchedRows: 1, overflowPhones: [], notes: [],
      }),
    };
    const crm = {
      findMissingPersonPhones: vi.fn().mockResolvedValue(["3331234567"]),
      findPhoneAssignments: vi.fn().mockResolvedValue([
        { phone: "3331234567", personId: "CRM-OTHER", label: "Altro nominativo" },
      ]),
      syncPersonContacts: vi.fn().mockResolvedValue(undefined),
      transferPhoneAssignments: vi.fn(),
    };

    await (runner as unknown as { ensureContacts: Function }).ensureContacts(job, row, crm, contacts, true);

    expect(crm.syncPersonContacts).toHaveBeenCalledWith("CRM-PERSON-NEW", expect.any(Object));
    expect(crm.transferPhoneAssignments).not.toHaveBeenCalled();
    expect(row.raw_payload?.contacts_flow).toMatchObject({
      phoneAssignmentPolicy: "excel-authoritative-retain-duplicates",
      duplicatePhoneAssignments: [{ phone: "3331234567", personId: "CRM-OTHER" }],
    });
    expect(repository.logChange).toHaveBeenCalledWith(
      job.id, "person", row.tax_code, "phone_assignment_duplicate_retained", "Nominativo CRM CRM-OTHER",
      "Recapito mantenuto anche sul nominativo Excel", "EXCEL",
    );
  });

  it("riutilizza in sola lettura l'immobile trovato sotto il nominativo", async () => {
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

    expect(crm.findPropertyForPerson).toHaveBeenCalledOnce();
    expect(crm.updateProperty).not.toHaveBeenCalled();
    expect(crm.createProperty).not.toHaveBeenCalled();
    expect(property.raw_payload?.existing_property_reused).toMatchObject({
      crmPropertyId: "CRM-PROPERTY-1", mode: "read_only",
    });
  });

  it("riutilizza in sola lettura l'immobile trovato globalmente sotto un altro proprietario", async () => {
    const { runner } = runnerWithRepository();
    const property = propertyRow();
    const primary = { ...personRow(), crm_record_id: "CRM-PERSON-NOT-LINKED" };
    const globalMatch = { id: "CRM-PROPERTY-OTHER-OWNER", data: { identityVerified: true, matchedBy: "cadastral-global" } };
    const crm = {
      findPropertyForPerson: vi.fn().mockResolvedValue({ match: null }),
      findPropertyByCadastralIdentity: vi.fn().mockResolvedValue({ match: globalMatch }),
      verifyProperty: vi.fn().mockResolvedValue({ match: globalMatch }),
      updateProperty: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn(),
    };

    await (runner as unknown as { ensureProperty: Function }).ensureProperty(job, property, primary, crm);

    expect(crm.findPropertyByCadastralIdentity).toHaveBeenCalledWith(expect.objectContaining({
      sheet: "50", parcel: "100", subaltern: "4",
    }));
    expect(crm.updateProperty).not.toHaveBeenCalled();
    expect(crm.createProperty).not.toHaveBeenCalled();
    expect(property.raw_payload?.property_search).toMatchObject({
      strategy: "global-cadastral",
      linkedToVerifiedPerson: false,
    });
  });

  it("crea l'immobile assente, ne verifica l'identità e passa direttamente all'attività", async () => {
    const { runner } = runnerWithRepository();
    const property = propertyRow();
    const primary = { ...personRow(), crm_record_id: "CRM-PERSON-1" };
    const match = { id: "CRM-PROPERTY-NEW", data: { identityVerified: true } };
    const crm = {
      findPropertyForPerson: vi.fn()
        .mockResolvedValueOnce({ match: null })
        .mockResolvedValueOnce({ match }),
      findPropertyByCadastralIdentity: vi.fn().mockResolvedValue({ match: null }),
      updateProperty: vi.fn(),
      createProperty: vi.fn().mockResolvedValue("CRM-PROPERTY-NEW"),
      verifyProperty: vi.fn().mockResolvedValue({ match }),
    };

    await (runner as unknown as { ensureProperty: Function }).ensureProperty(job, property, primary, crm);

    expect(crm.createProperty).toHaveBeenCalledOnce();
    expect(crm.updateProperty).not.toHaveBeenCalled();
    expect(crm.verifyProperty).toHaveBeenCalledWith("CRM-PROPERTY-NEW", expect.any(Object));
    expect(crm.findPropertyForPerson).toHaveBeenCalledOnce();
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
      findPropertyByCadastralIdentity: vi.fn().mockResolvedValue({ match: null }),
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
      findPropertyByCadastralIdentity: vi.fn().mockResolvedValue({ match: null }),
      updateProperty: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn(),
      verifyProperty: vi.fn().mockResolvedValue({ match }),
      createPropertyActivity: vi.fn().mockResolvedValue({
        outcome: "created", crmActivityId: "ACTIVITY-1", correlatedProperty: "VIA ROMA 10", attempts: 1,
      }),
      findLinkedOwnerIds: vi.fn().mockResolvedValue(["CRM-PERSON-1"]),
    };
    const contacts = { findByTaxCode: vi.fn() };

    await (runner as unknown as { processPropertiesInOrder: Function }).processPropertiesInOrder(
      { ...job, total_properties: 1, processed_properties: 0 },
      crm,
      contacts,
    );

    expect(crm.findPerson).not.toHaveBeenCalled();
    expect(contacts.findByTaxCode).not.toHaveBeenCalled();
    expect(crm.updateProperty).not.toHaveBeenCalled();
    expect(crm.createPropertyActivity).toHaveBeenCalledOnce();
  });

  it("applica il cambio Autocompila al successivo immobile della run", async () => {
    let activityMode: "direct_contact" | "plain" | "none" = "plain";
    const runner = new PropertyWorkerRunner(config, {
      keepAlive: false,
      propertyActivityMode: () => activityMode,
    });
    const repository = { updatePropertyProcessing: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(runner, "repository", { value: repository });
    const owner = { ...personRow(), crm_record_id: "CRM-PERSON-1", mobiles: [], landlines: [] };
    const first = { ...propertyRow(), id: "property-1", crm_record_id: "CRM-PROPERTY-1" };
    const second = { ...propertyRow(), id: "property-2", crm_record_id: "CRM-PROPERTY-2", raw_payload: {} };
    const third = { ...propertyRow(), id: "property-3", crm_record_id: "CRM-PROPERTY-3", raw_payload: {} };
    const crm = {
      createPropertyActivity: vi.fn(async (input) => ({
        outcome: "created", crmActivityId: null, correlatedProperty: input.propertyId, attempts: 1,
      })),
    };
    const ensureActivity = (runner as unknown as { ensurePropertyActivity: Function }).ensurePropertyActivity;

    await ensureActivity.call(runner, job, first, owner, [owner], crm, 1);
    activityMode = "direct_contact";
    await ensureActivity.call(runner, job, second, owner, [owner], crm, 1);
    activityMode = "plain";
    await ensureActivity.call(runner, job, third, owner, [owner], crm, 1);

    expect(crm.createPropertyActivity).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contactMode: "Telefonata", status: "Da eseguire", description: "Inserire attività",
    }));
    expect(crm.createPropertyActivity).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contactMode: "Contatto diretto", status: "Eseguito", description: "Non sa nulla",
    }));
    expect(crm.createPropertyActivity).toHaveBeenNthCalledWith(3, expect.objectContaining({
      contactMode: "Telefonata", status: "Da eseguire", description: "Inserire attività",
    }));
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
      findLinkedOwnerIds: vi.fn().mockResolvedValue([]),
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
      1,
      "direct_contact",
    );
    expect(crm.linkOwner).toHaveBeenCalledWith(
      "CRM-PROPERTY",
      expect.objectContaining({ personId: "CRM-COOWNER", phones: ["3331234567"] }),
      30,
    );
    expect(crm.linkOwner).toHaveBeenCalledTimes(1);
    expect(repository.updateOwnership).toHaveBeenCalledWith(
      "ownership-coowner",
      expect.objectContaining({ crm_link_id: "owner-link-CRM-COOWNER", processing_status: "linked" }),
    );
  });

  it("ignora il socio con codice fiscale rifiutato e usa l'altro socio per l'immobile", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const rejected = { ...personRow(), id: "rejected", crm_record_id: null, share_percentage: 70 };
    const usable = { ...personRow(), id: "usable", full_name: "BIANCHI LUCA", tax_code: "BNCLCU80A01A893X", crm_record_id: "CRM-USABLE", share_percentage: 30 };
    const property = { ...propertyRow(), raw_payload: { property_flow: { version: 3, stage: "owner_contacts_ready", dryRun: false } } };
    const ownerships = [
      { id: "ownership-rejected", property_id: property.id, person_id: rejected.id, right_type: "Proprieta", share_percentage: 70, crm_link_id: null, processing_status: "normalized" },
      { id: "ownership-usable", property_id: property.id, person_id: usable.id, right_type: "Proprieta", share_percentage: 30, crm_link_id: null, processing_status: "normalized" },
    ];
    const repository = {
      loadGraph: vi.fn().mockResolvedValue({ properties: [property], people: [rejected, usable], ownerships }),
      updatePersonProcessing: vi.fn().mockResolvedValue(undefined), updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
      updateOwnership: vi.fn().mockResolvedValue(undefined), updateJob: vi.fn().mockResolvedValue(undefined), logChange: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(runner, "repository", { value: repository });
    const internals = runner as unknown as { ensurePerson: ReturnType<typeof vi.fn>; ensureContacts: ReturnType<typeof vi.fn>; ensureProperty: ReturnType<typeof vi.fn>; ensurePropertyActivity: ReturnType<typeof vi.fn>; processPropertiesInOrder: Function };
    internals.ensurePerson = vi.fn(async (_job, row) => {
      if (row.id === rejected.id) throw new WorkerError("CF non coerente", "data_incomplete", { action: "person-tax-code-invalid" });
    });
    internals.ensureContacts = vi.fn().mockResolvedValue(undefined);
    internals.ensureProperty = vi.fn(async (_job, row) => { row.crm_record_id = "CRM-PROPERTY"; });
    internals.ensurePropertyActivity = vi.fn().mockResolvedValue(undefined);

    await internals.processPropertiesInOrder(
      { ...job, total_properties: 1, processed_properties: 0 },
      { findLinkedOwnerIds: vi.fn().mockResolvedValue(["CRM-USABLE"]), linkOwner: vi.fn(), resetToCrmHome: vi.fn().mockResolvedValue(undefined) },
      { findByTaxCode: vi.fn() },
    );

    expect(internals.ensureProperty).toHaveBeenCalledWith(expect.anything(), property, usable, expect.anything());
    expect(rejected.raw_payload?.tax_code_rejection).toMatchObject({ action: "person-tax-code-invalid" });
    expect((property.raw_payload as Record<string, unknown>)?.effective_primary_owner_id).toBe(usable.id);
    expect((property.raw_payload?.property_flow as Record<string, unknown>)?.stage).toBe("completed");
  });

  it("annota e salta l'immobile se l'unico proprietario ha il codice fiscale rifiutato", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const rejected = { ...personRow(), id: "rejected", crm_record_id: null };
    const property = { ...propertyRow(), raw_payload: { property_flow: { version: 3, stage: "owner_contacts_ready", dryRun: false } } };
    const ownerships = [{ id: "ownership-rejected", property_id: property.id, person_id: rejected.id, right_type: "Proprieta", share_percentage: 100, crm_link_id: null, processing_status: "normalized" }];
    const repository = {
      loadGraph: vi.fn().mockResolvedValue({ properties: [property], people: [rejected], ownerships }),
      updatePersonProcessing: vi.fn().mockResolvedValue(undefined), updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
      updateOwnership: vi.fn().mockResolvedValue(undefined), updateJob: vi.fn().mockResolvedValue(undefined), logChange: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(runner, "repository", { value: repository });
    const internals = runner as unknown as { ensurePerson: ReturnType<typeof vi.fn>; ensureProperty: ReturnType<typeof vi.fn>; processPropertiesInOrder: Function };
    internals.ensurePerson = vi.fn().mockRejectedValue(new WorkerError("CF non coerente", "data_incomplete", { action: "person-tax-code-invalid" }));
    internals.ensureProperty = vi.fn();
    const crm = { resetToCrmHome: vi.fn().mockResolvedValue(undefined) };

    await internals.processPropertiesInOrder({ ...job, total_properties: 1, processed_properties: 0 }, crm, { findByTaxCode: vi.fn() });

    expect(internals.ensureProperty).not.toHaveBeenCalled();
    expect(repository.updatePropertyProcessing).toHaveBeenCalledWith(
      property.id,
      expect.objectContaining({ processing_status: "skipped" }),
    );
    expect((property.raw_payload as Record<string, unknown>)?.skip_details).toMatchObject({ source: "tax_code_rejected_no_alternative_owner" });
  });
});
