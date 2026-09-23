import { describe, expect, it } from "vitest";

import { buildPropertyRunLedger, partitionPropertyJobs, partitionPropertyRuns } from "../src/services/run-ledger.js";
import type { JobRow, PropertyRow } from "../src/services/repository.js";

const job = (values: Partial<JobRow> = {}): JobRow => ({
  id: "job-1", mode: "automatic", status: "paused", current_step: "properties_processed",
  last_completed_step: "acquisition_reviewed", municipality: "BITONTO", street: "VIA TEST",
  civic_number: null, sister_source_url: null, import_started_at: "2026-09-15T08:00:00.000Z",
  acquisition: { engine: "lavorazione" }, ...values,
});

const property = (id: string, status: string, rawPayload: PropertyRow["raw_payload"] = null): PropertyRow => ({
  id, job_id: "job-1", municipality: "BITONTO", sheet: "1", parcel: id, subaltern: "1",
  cadastral_key: `BITONTO|1|${id}|1`, address: `Via Test ${id}`, census_zone: null,
  category: "A/3", class: null, consistency: null, cadastral_income: null,
  raw_payload: rawPayload, processing_status: status, crm_record_id: null,
});

describe("registro atomico delle run", () => {
  it("chiude la run con casi saltati da rifinire conservando il motivo", () => {
    const ledger = buildPropertyRunLedger({ job: job(), properties: [property("1", "synced"), property("2", "quarantined", { import_v2: { state: "quarantined", failure: { message: "Lookup non verificato" } } })] });
    expect(ledger.state).toBe("completed");
    expect(ledger.counts).toMatchObject({ terminal: 2, skipped: 1, pending: 0 });
    expect(ledger.rows[1]?.anomalies[0]?.message).toBe("Lookup non verificato");
  });
  it("deriva contatore e cursore dalla stessa sequenza anche con righe concluse non consecutive", () => {
    const ledger = buildPropertyRunLedger({
      job: job(),
      properties: [
        property("1", "synced"),
        property("2", "normalized"),
        property("3", "completed"),
        property("4", "skipped", { skip_details: { reason: "Saltato dall'operatore" } }),
      ],
    });

    expect(ledger.counts).toEqual({ total: 4, terminal: 3, completed: 2, completedWithAnomalies: 0, skipped: 1, pending: 1 });
    expect(ledger.cursor).toMatchObject({ nextRow: 2, nextRecordId: "2", nextLabel: "Via Test 2" });
    expect(ledger.rows.map((row) => row.state)).toEqual(["completed", "pending", "completed", "skipped"]);
    expect(ledger.rows[3]?.anomalies[0]?.message).toBe("Saltato dall'operatore");
  });

  it("separa Rifinitura e segnala le anomalie soltanto sulle righe davvero eseguite", () => {
    const ledger = buildPropertyRunLedger({
      job: job({ acquisition: { engine: "rifinitura", strategy: "street_refinement" } }),
      properties: [property("1", "synced"), property("2", "normalized")],
      anomalies: [
        { propertyId: "1", code: "owner", message: "Quota da verificare" },
        { propertyId: "2", code: "cloud", message: "Cloud non raggiungibile" },
      ],
      activePropertyId: "2",
    });

    expect(ledger.engine).toBe("rifinitura");
    expect(ledger.rows[0]?.state).toBe("completed_with_anomalies");
    expect(ledger.rows[1]?.state).toBe("running");
    expect(ledger.counts.completedWithAnomalies).toBe(1);
    expect(ledger.cursor.nextRecordId).toBe("2");
  });

  it("non lascia mai entrare una rifinitura nelle code o negli archivi delle lavorazioni", () => {
    const ordinary = job({ id: "ordinary", acquisition: { engine: "lavorazione" } });
    const refinement = job({ id: "refinement", acquisition: { engine: "rifinitura", strategy: "street_refinement" } });

    expect(partitionPropertyJobs([ordinary, refinement])).toEqual({
      lavorazione: [ordinary],
      rifinitura: [refinement],
    });
    expect(partitionPropertyRuns([{ job: ordinary, result: 1 }, { job: refinement, result: 2 }])).toEqual({
      lavorazione: [{ job: ordinary, result: 1 }],
      rifinitura: [{ job: refinement, result: 2 }],
    });
  });
});
