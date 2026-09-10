import { describe, expect, it } from "vitest";

import type { ImportV2Engine } from "../src/import-v2/engine.js";
import type { ImportV2Outcome, SourceProperty } from "../src/import-v2/model.js";
import { partitionImportV2Work, runImportV2ParallelBatch } from "../src/import-v2/queue.js";

function property(id: string, ownerTaxCodes: string[]): SourceProperty {
  return {
    sourcePropertyId: id,
    jobId: "job-parallel",
    municipality: "BITONTO",
    fullAddress: `VIA TEST ${id}`,
    cadastral: { urbanSection: null, sheet: "1", parcel: id, parcelDenomination: null, subaltern: "1", income: null },
    category: "A/3",
    propertyClass: null,
    consistency: null,
    activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" },
    owners: ownerTaxCodes.map((taxCode, index) => ({
      sourcePersonId: `${id}-${index}`,
      taxCode,
      fullName: `Proprietario ${index}`,
      birthDate: null,
      birthPlace: null,
      birthProvince: null,
      rightType: "Proprietà",
      sharePercentage: 100 / ownerTaxCodes.length,
      contacts: { phones: [], emails: [] },
    })),
  };
}

function completed(propertyId: string): ImportV2Outcome {
  return {
    itemId: propertyId,
    propertyId,
    crmPropertyId: `crm-${propertyId}`,
    syncedPeople: [],
    state: "completed",
    stage: "completed",
    failure: null,
  };
}

describe("coda Import V2 su due finestre", () => {
  it("tiene sulla stessa finestra tutti gli immobili con proprietari condivisi", () => {
    const work = partitionImportV2Work([
      property("p1", ["RSSMRA80A01A893P"]),
      property("p2", ["VRDLGI81A01A893Q"]),
      property("p3", ["rssmra80a01a893p"]),
      property("p4", ["BNCLCU82A01A893R"]),
    ], 2);

    expect(work).toHaveLength(2);
    const laneByProperty = new Map(work.flatMap((lane, laneIndex) => lane.map((item) => [item.propertyId, laneIndex] as const)));
    expect(laneByProperty.get("p1")).toBe(laneByProperty.get("p3"));
    expect(new Set(laneByProperty.values()).size).toBe(2);
  });

  it("lavora davvero in parallelo e conserva gli indici globali", async () => {
    const active = new Set<number>();
    let maximumActive = 0;
    const visits: Array<{ worker: number; propertyId: string }> = [];
    const engine = (worker: number) => ({
      run: async (source: SourceProperty, onStage?: (stage: "queued") => void) => {
        active.add(worker);
        maximumActive = Math.max(maximumActive, active.size);
        visits.push({ worker, propertyId: source.sourcePropertyId });
        onStage?.("queued");
        await new Promise((resolve) => setTimeout(resolve, 15));
        active.delete(worker);
        return completed(source.sourcePropertyId);
      },
    }) as unknown as ImportV2Engine;
    const progress: Array<{ propertyId: string; index: number; workerIndex?: number; workerCount?: number }> = [];

    const result = await runImportV2ParallelBatch(
      [engine(1), engine(2)],
      [property("p1", ["A"]), property("p2", ["B"]), property("p3", ["A"])],
      (item) => progress.push(item),
    );

    expect(maximumActive).toBe(2);
    expect(result.completed.map((item) => item.propertyId)).toEqual(["p1", "p2", "p3"]);
    expect(visits.filter((item) => ["p1", "p3"].includes(item.propertyId)).map((item) => item.worker)).toEqual([1, 1]);
    expect(progress.map(({ propertyId, index, workerCount }) => ({ propertyId, index, workerCount }))).toEqual([
      { propertyId: "p1", index: 1, workerCount: 2 },
      { propertyId: "p2", index: 2, workerCount: 2 },
      { propertyId: "p3", index: 3, workerCount: 2 },
    ]);
  });
});
