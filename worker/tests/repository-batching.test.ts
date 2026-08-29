import { describe, expect, it } from "vitest";

import { WorkerRepository, type PersonRow, type PropertyRow } from "../src/services/repository.js";

describe("persistenza alleggerita del grafo worker", () => {
  it("salva un inventario grande in blocchi e restituisce l'ordine SISTER originale", async () => {
    const batchSizes: number[] = [];
    const client = {
      from: () => ({
        upsert: (payload: Array<Record<string, unknown>>) => ({
          select: async () => {
            batchSizes.push(payload.length);
            return {
              error: null,
              data: [...payload].reverse().map((row) => ({ ...row, id: `id-${row.subaltern}`, crm_record_id: null })),
            };
          },
        }),
      }),
    };
    const repository = Object.create(WorkerRepository.prototype) as WorkerRepository;
    Object.defineProperty(repository, "client", { value: client });
    const properties = Array.from({ length: 205 }, (_, index) => ({
      municipality: "BITONTO",
      sheet: "1",
      parcel: String(1_000 + index),
      subaltern: String(index + 1),
      address: `Via Test ${index + 1}`,
      censusZone: null,
      category: "A/3",
      class: null,
      consistency: null,
      cadastralIncome: null,
      sourceRef: String(index),
      rawPayload: { sourceOrder: index },
    }));

    const saved = await repository.insertProperties("job", properties, { updateJobTotal: false });

    expect(batchSizes).toEqual([100, 100, 5]);
    expect(saved.map((row) => row.subaltern)).toEqual(properties.map((row) => row.subaltern));
    expect(saved.every((row) => row.job_id === "job")).toBe(true);
  });

  it("normalizza le righe già pulite in batch conservando gli aggiornamenti diversi", async () => {
    const calls: Array<{ table: string; values: Record<string, unknown>; ids: string[]; mode: "in" | "eq" }> = [];
    const client = {
      from: (table: string) => ({
        update: (values: Record<string, unknown>) => ({
          in: async (_column: string, ids: string[]) => {
            calls.push({ table, values, ids, mode: "in" });
            return { error: null };
          },
          eq: async (_column: string, id: string) => {
            calls.push({ table, values, ids: [id], mode: "eq" });
            return { error: null };
          },
        }),
      }),
    };
    const repository = Object.create(WorkerRepository.prototype) as WorkerRepository;
    Object.defineProperty(repository, "client", { value: client });

    const properties = Array.from({ length: 205 }, (_, index) => ({ id: `property-${index}` })) as PropertyRow[];
    const people = Array.from({ length: 205 }, (_, index) => ({
      id: `person-${index}`,
      tax_code: `RSSMRA80A01A${String(index).padStart(3, "0")}X`,
    })) as PersonRow[];
    people[204]!.tax_code = " rssmra80a01a893x ";

    await repository.markGraphNormalized(properties, people);

    const propertyBatches = calls.filter((call) => call.table === "property_worker_properties" && call.mode === "in");
    const unchangedPeopleBatches = calls.filter((call) => call.table === "property_worker_people" && call.mode === "in");
    const changedPeople = calls.filter((call) => call.table === "property_worker_people" && call.mode === "eq");
    expect(propertyBatches.map((call) => call.ids.length)).toEqual([100, 100, 5]);
    expect(unchangedPeopleBatches.map((call) => call.ids.length)).toEqual([100, 100, 4]);
    expect(changedPeople).toEqual([
      expect.objectContaining({
        ids: ["person-204"],
        values: { tax_code: "RSSMRA80A01A893X", processing_status: "normalized" },
      }),
    ]);
  });
});
