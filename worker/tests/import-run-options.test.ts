import { describe, expect, it } from "vitest";

import { importRunOptions, withImportRunOptions } from "../src/desktop/import-run-options.js";
import { summarizeJobImportProgress } from "../src/desktop/state-projection.js";
import type { JobRow, PropertyRow } from "../src/services/repository.js";

const fallback = {
  activityMode: "direct_contact" as const,
  importCoOwners: true,
  parallelCrmWindows: false,
};

const job = (values: Partial<JobRow> = {}): JobRow => ({
  id: "job-1",
  mode: "automatic",
  status: "saved",
  current_step: "properties_processed",
  last_completed_step: "acquisition_reviewed",
  municipality: "BITONTO",
  street: "VIA TEST",
  civic_number: null,
  sister_source_url: null,
  ...values,
});

const property = (id: string, processing_status: string, stage?: string): PropertyRow => ({
  id,
  job_id: "job-1",
  municipality: "BITONTO",
  sheet: "1",
  parcel: id,
  subaltern: "1",
  cadastral_key: `BITONTO|1|${id}|1`,
  address: `Via Test ${id}`,
  census_zone: null,
  category: "A/3",
  class: null,
  consistency: null,
  cadastral_income: null,
  raw_payload: stage ? { property_flow: { version: 4, stage } } : null,
  processing_status,
  crm_record_id: null,
});

describe("opzioni e avanzamento degli import conservati", () => {
  it("rilegge tutte le scelte della singola run dopo una pausa", () => {
    const acquisition = withImportRunOptions({}, {
      activityMode: "none",
      importCoOwners: false,
      parallelCrmWindows: true,
    }, "2026-09-11T10:00:00.000Z");

    expect(importRunOptions(acquisition, fallback)).toEqual({
      activityMode: "none",
      importCoOwners: false,
      parallelCrmWindows: true,
    });
    expect(acquisition.importOptions).toEqual({
      activityMode: "none",
      importCoOwners: false,
      parallelCrmWindows: true,
      selectedAt: "2026-09-11T10:00:00.000Z",
    });
  });

  it("mantiene i default compatibili per un'acquisizione precedente", () => {
    expect(importRunOptions({ activityMode: "plain" }, fallback)).toEqual({
      ...fallback,
      activityMode: "plain",
    });
  });

  it("distingue una run mai avviata da una interrotta e trova la riga di ripartenza", () => {
    const properties = [
      property("1", "completed", "completed"),
      property("2", "normalized", "property_ready"),
      property("3", "normalized"),
    ];

    expect(summarizeJobImportProgress(job(), properties)).toEqual({
      state: "not_started",
      handled: 1,
      total: 3,
      nextRow: 2,
    });
    expect(summarizeJobImportProgress(job({ import_started_at: "2026-09-11T10:00:00.000Z", status: "paused" }), properties)).toEqual({
      state: "stopped",
      handled: 1,
      total: 3,
      nextRow: 2,
    });
  });
});
