import { describe, expect, it } from "vitest";

import {
  canCreateCompletedWorkRefinement,
  completedWorkRefinementPayload,
  isCompletedWorkRefinementSeed,
  refinementSourceJobId,
} from "../src/services/refinement-seed.js";
import { propertyRunEngine } from "../src/services/run-ledger.js";
import type { JobRow } from "../src/services/repository.js";

const completedStreet = (values: Partial<JobRow> = {}): JobRow => ({
  id: "work-1",
  mode: "automatic",
  status: "completed",
  current_step: "completed",
  last_completed_step: "completed",
  municipality: "BITONTO",
  street: "VIA CESARE CANTU",
  civic_number: null,
  sister_source_url: "",
  total_properties: 12,
  total_people: 9,
  completed_at: "2026-09-17T08:00:00.000Z",
  acquisition: { engine: "lavorazione", strategy: "bulk_exact_variants" },
  ...values,
});

describe("rifiniture derivate dalle lavorazioni concluse", () => {
  it("crea una scheda separata, vuota e pronta per una nuova acquisizione SISTER", () => {
    const payload = completedWorkRefinementPayload(completedStreet(), "2026-09-17T09:00:00.000Z");
    const seed = { id: "refinement-1", ...payload } as JobRow;

    expect(payload).toMatchObject({
      status: "saved",
      street: "VIA CESARE CANTU",
      total_properties: 0,
      total_people: 0,
      acquisition: {
        engine: "rifinitura",
        strategy: "street_refinement",
        refinementOrigin: "completed_lavorazione",
        refinementSourceJobId: "work-1",
        refinementCloudStreet: "VIA CESARE CANTU",
      },
    });
    expect(propertyRunEngine(seed)).toBe("rifinitura");
    expect(isCompletedWorkRefinementSeed(seed)).toBe(true);
    expect(refinementSourceJobId(seed)).toBe("work-1");
  });

  it("non promuove civici singoli, run incomplete o rifiniture già concluse", () => {
    expect(canCreateCompletedWorkRefinement(completedStreet({ civic_number: "1" }))).toBe(false);
    expect(canCreateCompletedWorkRefinement(completedStreet({ status: "paused" }))).toBe(false);
    expect(canCreateCompletedWorkRefinement(completedStreet({
      acquisition: { engine: "rifinitura", strategy: "street_refinement" },
    }))).toBe(false);
  });
});
