import { describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import { PropertyWorkerRunner } from "../src/services/runner.js";
import type { PropertyRow } from "../src/services/repository.js";

const config: WorkerConfig = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-long-enough-for-tests",
  CHROME_CDP_URL: "http://127.0.0.1:9222",
  CONTACTS_EXCEL_PATH: "C:\\test.xlsx",
  WORKER_MODE: "automatic",
  WORKER_DRY_RUN: true,
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

function property(id: string, rowIndex: number): PropertyRow {
  return {
    id,
    job_id: job.id,
    municipality: "BITONTO",
    sheet: "50",
    parcel: String(100 + rowIndex),
    subaltern: "1",
    cadastral_key: `BITONTO|50|${100 + rowIndex}|1`,
    address: `VIA ROMA n. 10 Piano ${rowIndex + 1}`,
    census_zone: "U",
    category: "A/3",
    class: "4",
    consistency: "5 vani",
    cadastral_income: 500,
    raw_payload: { rowIndex, sourceOrder: rowIndex },
    processing_status: "extracted",
    crm_record_id: null,
  };
}

function owner() {
  return {
    fullName: "ROSSI MARIO",
    birthPlace: "BITONTO",
    birthProvince: "BA",
    birthDate: "1980-01-01",
    taxCode: "RSSMRA80A01A893X",
    rightType: "Proprietà",
    shareOriginal: "1/1",
    shareNumerator: 1,
    shareDenominator: 1,
    sharePercentage: 100,
    rawPayload: {},
  };
}

function repositoryFor(properties: PropertyRow[]) {
  return {
    loadGraph: vi.fn().mockResolvedValue({ properties, people: [], ownerships: [] }),
    updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
    updatePersonProcessing: vi.fn().mockResolvedValue(undefined),
    updateOwnership: vi.fn().mockResolvedValue(undefined),
    insertOwner: vi.fn().mockResolvedValue(undefined),
    updateJob: vi.fn().mockResolvedValue(undefined),
  };
}

function sisterWith(extractOwners: ReturnType<typeof vi.fn>) {
  return {
    extractSearchContext: vi.fn().mockResolvedValue({
      municipality: "BITONTO",
      street: "VIA ROMA",
      civicNumber: "10",
      sourceUrl: "https://sister.test/results",
    }),
    extractOwners,
    ensureResultsPage: vi.fn().mockResolvedValue(undefined),
    hasIgnoredBusinessOnRow: vi.fn().mockReturnValue(false),
    getIgnoredRights: vi.fn().mockReturnValue([]),
    getIgnoredBusinesses: vi.fn().mockReturnValue([]),
  };
}

describe("paracadute acquisizione SISTER", () => {
  it("recepisce la pausa cooperativa prima di iniziare una nuova operazione browser", async () => {
    const rows = [property("current", 0)];
    const runner = new PropertyWorkerRunner(config, {
      keepAlive: false,
      isPauseRequested: () => true,
    });
    Object.defineProperty(runner, "repository", { value: repositoryFor(rows) });
    const sister = sisterWith(vi.fn().mockResolvedValue([owner()]));

    await expect((runner as unknown as { executeStep: Function }).executeStep(
      "owners_extracted",
      job,
      sister,
      {},
      {},
    )).rejects.toMatchObject({ status: "paused", details: { pauseRequested: true } });
    expect(sister.extractOwners).not.toHaveBeenCalled();
  });

  it("isola la riga che fallisce due volte e acquisisce la successiva", async () => {
    const rows = [property("broken", 0), property("next", 1)];
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const repository = repositoryFor(rows);
    Object.defineProperty(runner, "repository", { value: repository });
    const sister = sisterWith(vi.fn()
      .mockRejectedValueOnce(new Error("stringa inattesa"))
      .mockRejectedValueOnce(new Error("stringa inattesa"))
      .mockResolvedValueOnce([owner()]));

    const output = await (runner as unknown as { executeStep: Function }).executeStep(
      "owners_extracted",
      job,
      sister,
      {},
      {},
    );

    expect(sister.extractOwners).toHaveBeenCalledTimes(3);
    expect(repository.updatePropertyProcessing).toHaveBeenCalledWith(
      "broken",
      expect.objectContaining({ processing_status: "acquisition_failed" }),
    );
    expect(repository.insertOwner).toHaveBeenCalledWith(job.id, "next", expect.objectContaining({ taxCode: "RSSMRA80A01A893X" }));
    expect(output.skippedRows).toEqual([
      expect.objectContaining({ propertyId: "broken", source: "parachute" }),
    ]);
  });

  it("salta la riga corrente su richiesta e prosegue con quella successiva", async () => {
    const rows = [property("skip", 0), property("next", 1)];
    const runner = new PropertyWorkerRunner(config, {
      keepAlive: false,
      isPropertySkipRequested: (_jobId, propertyId) => propertyId === "skip",
    });
    const repository = repositoryFor(rows);
    Object.defineProperty(runner, "repository", { value: repository });
    const sister = sisterWith(vi.fn().mockResolvedValue([owner()]));

    const output = await (runner as unknown as { executeStep: Function }).executeStep(
      "owners_extracted",
      job,
      sister,
      {},
      {},
    );

    expect(sister.extractOwners).toHaveBeenCalledOnce();
    expect(repository.updatePropertyProcessing).toHaveBeenCalledWith(
      "skip",
      expect.objectContaining({ processing_status: "acquisition_skipped" }),
    );
    expect(repository.insertOwner).toHaveBeenCalledWith(job.id, "next", expect.anything());
    expect(output.skippedRows).toEqual([
      expect.objectContaining({ propertyId: "skip", source: "manual" }),
    ]);
  });
});
