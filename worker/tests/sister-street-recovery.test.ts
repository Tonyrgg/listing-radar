import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { SisterStreetRun, restoreStreetAcquisitionEvidence, type SisterStreetQueryResult } from "../src/services/sister-street-run.js";
import { summarizeStreetAcquisition } from "../src/desktop/state-projection.js";

const page = () => ({ url: () => "https://example.test/addresses", title: async () => "Elenco indirizzi", locator: (selector: string) => ({ count: async () => selector.includes("SceltaIndirizzoForm") ? 1 : 0, locator: () => ({ evaluateAll: async () => [{ text: "VIA TEST", value: "test##VIA TEST" }] }) }) }) as unknown as Page;
const partial = (): SisterStreetQueryResult => ({ civicNumber: null, variantKey: "test:1", variantSourceId: "test", outcome: "paused", rawRecords: 10, acceptedProperties: 1, propertyKeys: ["BITONTO|41|10|1"], ownersRead: 2, skippedPropertyRows: 0, warnings: [], elapsedMs: 10, cursor: { position: 2, total: 10, key: "BITONTO|41|20|2", label: "Via Test 2", ownerNames: [] }, recordLedger: [{ index: 1, key: "BITONTO|41|10|1", label: "Via Test 1", ownerNames: [], status: "completed", anomaly: null, completedAt: "2026-10-06T10:00:00Z" }] });
describe("acquisizione SISTER interrotta", () => {
  it("conserva la lettura conclusa se fallisce soltanto il ritorno alla ricerca", async () => {
    const option = { evaluateAll: async () => [{ text: "VIA TEST", value: "test##VIA TEST" }] };
    const input: any = { count: async () => 1, fill: async () => {}, selectOption: async () => {}, click: async () => {}, locator: () => option };
    const fake = { url: () => "https://example.test/results", title: async () => "Risultati", waitForNavigation: async () => null, getByText: () => ({ count: async () => 0 }), locator: (selector: string) => selector.includes("password") ? { count: async () => 0 } : { ...input, locator: (nested: string) => nested === "option" ? option : input } } as unknown as Page;
    const run = new SisterStreetRun(fake, { maxQueryAttempts: 1 });
    const adapter = (run as any).adapter;
    vi.spyOn(adapter, "extractProperties").mockResolvedValue([{ municipality: "BITONTO", sheet: "41", parcel: "10", subaltern: "1", address: "VIA TEST n. 1", category: "A/3", rawPayload: {} }]);
    vi.spyOn(adapter, "extractOwners").mockResolvedValue([{ fullName: "Proprietario di prova" }]);
    vi.spyOn(adapter, "ensureResultsPage").mockRejectedValue(new Error("Navigazione finale interrotta"));
    const result = await run.run("VIA TEST");
    expect(result).toMatchObject({ status: "completed", totalAcceptedProperties: 1, totalOwnersRead: 1 });
    expect(result.results[0]?.recordLedger).toHaveLength(1);
    expect(result.results[0]?.inventoryProperties).toHaveLength(1);
    expect(result.results[0]?.warnings.at(-1)).toContain("Lettura conclusa");
  });
  it("mantiene righe, proprietari e cursore dopo un errore e riprende dalla stessa evidenza", async () => {
    const run = new SisterStreetRun(page(), { maxQueryAttempts: 1 });
    const engine = run as unknown as { queryOnce: (...args: any[]) => Promise<SisterStreetQueryResult>; recoverToAddressList: () => Promise<void> };
    vi.spyOn(engine, "recoverToAddressList").mockResolvedValue();
    vi.spyOn(engine, "queryOnce").mockImplementation(async (...args) => { await args[6](partial()); throw new Error("Risposta non riconosciuta"); });
    const stopped = await run.run("VIA TEST");
    expect(stopped).toMatchObject({ status: "paused", totalRawRecords: 10, totalAcceptedProperties: 1, totalOwnersRead: 2 });
    expect(stopped.results[0]?.cursor?.position).toBe(2);
    expect(stopped.results[0]?.recordLedger).toHaveLength(1);
    expect(summarizeStreetAcquisition(stopped)).toMatchObject({ total: 10, completed: 1 });
    engine.queryOnce = vi.fn(async (...args) => { expect(args[5]).toMatchObject({ rawRecords: 10, propertyKeys: ["BITONTO|41|10|1"] }); return { ...args[5], outcome: "found", cursor: null }; });
    const resumed = await run.run("VIA TEST", stopped);
    expect(resumed.status).toBe("completed");
    expect(resumed.totalAcceptedProperties).toBe(1);
  });
  it("espone il totale originale anche nei checkpoint vecchi azzerati", () => {
    const result = { ...partial(), outcome: "failed" as const, rawRecords: 0, acceptedProperties: 0, ownersRead: 0 };
    expect(summarizeStreetAcquisition({ results: [result], status: "paused", variants: [{}], currentVariantIndex: 0 } as never)).toMatchObject({ total: 10, state: "paused", totalIsFinal: false });
    const restored = restoreStreetAcquisitionEvidence({ results: [{ ...result, propertyKeys: [] }], uniquePropertyKeys: [] } as never);
    expect(restored).toMatchObject({ totalRawRecords: 10, totalAcceptedProperties: 1 });
    expect(restored.results[0]?.propertyKeys).toEqual(["BITONTO|41|10|1"]);
    expect(restored.results[0]?.outcome).toBe("failed");
  });
});
