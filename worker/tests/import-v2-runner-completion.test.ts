import { describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import type { ImportV2BatchResult } from "../src/import-v2/queue.js";
import { assertImportV2BatchComplete } from "../src/services/runner.js";
import { PropertyWorkerRunner } from "../src/services/runner.js";

const coordinatorRunJob = vi.hoisted(() => vi.fn());

vi.mock("../src/import-v2/coordinator.js", () => ({
  ImportV2Coordinator: class {
    runJob(...args: unknown[]) {
      return coordinatorRunJob(...args);
    }
  },
}));

const config = {
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
} satisfies WorkerConfig;

function quarantinedResult(): ImportV2BatchResult {
  const failure = {
    message: "Luogo di nascita digitato ma non selezionato dal lookup",
    kind: "transient_portal" as const,
    stage: "people_resolved" as const,
    retryable: true,
    global: false,
    details: {},
    occurredAt: "2026-09-02T14:40:25.529Z",
  };
  return {
    completed: [],
    paused: null,
    quarantined: [{
      itemId: "item-1",
      propertyId: "property-1",
      crmPropertyId: null,
      syncedPeople: [],
      state: "quarantined",
      stage: "people_resolved",
      failure,
    }],
  };
}

function pausedByOperatorResult(): ImportV2BatchResult {
  return {
    completed: [],
    quarantined: [],
    paused: {
      itemId: "item-1",
      propertyId: "property-1",
      crmPropertyId: null,
      syncedPeople: [],
      state: "paused",
      stage: "people_resolved",
      failure: {
        message: "Import V2 messo in pausa dall'operatore",
        kind: "operator_pause",
        stage: "people_resolved",
        retryable: false,
        global: true,
        details: { pauseRequested: true },
        occurredAt: "2026-09-03T19:30:00.000Z",
      },
    },
  };
}

describe("esito finale Import V2", () => {
  it("la verifica finale esclude i casi da rifinire ma controlla ancora i casi eseguiti", async () => {
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    const graph = { properties: [{ id: "p", processing_status: "quarantined", raw_payload: {} }], people: [{ id: "person", processing_status: "quarantined" }], ownerships: [{ id: "link", property_id: "p", person_id: "person", processing_status: "quarantined" }] };
    Object.defineProperty(runner, "repository", { value: { loadGraph: vi.fn().mockResolvedValue(graph) } });
    await expect((runner as unknown as { executeStep: Function }).executeStep("verified", { id: "job" }, {}, {}, {}, {})).resolves.toMatchObject({ verified: true });
    graph.properties[0]!.processing_status = "normalized";
    await expect((runner as unknown as { executeStep: Function }).executeStep("verified", { id: "job" }, {}, {}, {}, {})).rejects.toMatchObject({ status: "needs_review" });
  });
  it("chiude il batch con immobili accantonati da rifinire", () => {
    const result = quarantinedResult();

    expect(() => assertImportV2BatchComplete(result)).not.toThrow();
  });

  it("accetta soltanto un batch senza elementi accantonati", () => {
    expect(() => assertImportV2BatchComplete({ completed: [], quarantined: [], paused: null })).not.toThrow();
  });

  it("conserva i casi accantonati e conclude anche quando nessun immobile è importabile", async () => {
    coordinatorRunJob.mockResolvedValueOnce(quarantinedResult());
    const graph = {
      properties: [{
        id: "property-1", job_id: "job-1", municipality: "BITONTO", sheet: "38", parcel: "215", subaltern: "17",
        cadastral_key: "BITONTO|38|215|17", address: "VIA FRANCIA 10", census_zone: "U", category: "A/2",
        class: "3", consistency: "6 vani", cadastral_income: null, raw_payload: {}, processing_status: "normalized", crm_record_id: null,
      }],
      people: [],
      ownerships: [],
    };
    const repository = {
      client: {},
      loadGraph: vi.fn().mockResolvedValue(graph),
      updateContacts: vi.fn().mockResolvedValue(undefined),
      updatePropertyProcessing: vi.fn().mockResolvedValue(undefined),
      updatePersonProcessing: vi.fn().mockResolvedValue(undefined),
      updateOwnership: vi.fn().mockResolvedValue(undefined),
      updateJob: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    Object.defineProperty(runner, "repository", { value: repository });

    await expect((runner as unknown as { executeStep: Function }).executeStep(
      "properties_processed",
      { id: "job-1", mode: "automatic" },
      {},
      {},
      {},
      { findByTaxCode: vi.fn() },
    )).resolves.toMatchObject({ completed: 0, quarantined: 1 });

    expect(repository.updatePropertyProcessing).toHaveBeenCalledWith(
      "property-1",
      expect.objectContaining({ processing_status: "quarantined" }),
    );
    expect(repository.updateJob).toHaveBeenCalledWith("job-1", { processed_properties: 0 });
  });

  it("propaga la pausa operatore al runner senza convertirla in errore portale", async () => {
    coordinatorRunJob.mockResolvedValueOnce(pausedByOperatorResult());
    const repository = {
      client: {},
      loadGraph: vi.fn().mockResolvedValue({ properties: [], people: [], ownerships: [] }),
      updateContacts: vi.fn(), updatePropertyProcessing: vi.fn(), updatePersonProcessing: vi.fn(),
      updateOwnership: vi.fn(), updateJob: vi.fn(),
    };
    const runner = new PropertyWorkerRunner(config, { keepAlive: false });
    Object.defineProperty(runner, "repository", { value: repository });

    await expect((runner as unknown as { executeStep: Function }).executeStep(
      "properties_processed",
      { id: "job-1", mode: "automatic" }, {}, {}, {}, { findByTaxCode: vi.fn() },
    )).rejects.toMatchObject({ status: "paused", details: { pauseRequested: true, importV2: true } });
  });
});
