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
    logChange: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(runner, "repository", { value: repository });
  return { runner, repository };
}

describe("flusso identità nominativo e immobile", () => {
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
});
