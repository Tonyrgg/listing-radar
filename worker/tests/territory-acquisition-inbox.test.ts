import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { queueAcquisition, consumeAcquisitions } from "../src/territory/acquisition-inbox.js";
import type { HistorySnapshot } from "../src/territory/history-source.js";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const snapshot = (status = "saved"): HistorySnapshot => ({ version: 1, readOnly: true, source: "https://example.test", exportedAt: "2026-10-06T10:00:00Z", skippedJobIds: [], jobs: [{ job: { id: "job", status } as never, graph: { properties: [], people: [], ownerships: [] }, items: [], ignoredBusinessRows: [] }] });
describe("passaggio durevole dalle acquisizioni ordinarie alla memoria V2", () => {
  it("conserva la raccolta se V2 è occupato e la consuma una volta al successivo avvio", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "territory-inbox-")); directories.push(directory);
    await queueAcquisition(directory, snapshot());
    await expect(consumeAcquisitions(directory, async () => { throw new Error("V2 occupato"); })).rejects.toThrow("V2 occupato");
    const collected: HistorySnapshot[] = [];
    expect(await consumeAcquisitions(directory, async snapshot => { collected.push(snapshot); })).toBe(1);
    expect(collected).toEqual([snapshot()]);
    expect(await consumeAcquisitions(directory, async () => { throw new Error("non deve essere richiamato"); })).toBe(0);
  });
  it("non elimina una versione nuova arrivata durante l'adozione", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "territory-inbox-")); directories.push(directory);
    await queueAcquisition(directory, snapshot());
    await consumeAcquisitions(directory, async () => { await queueAcquisition(directory, snapshot("completed")); });
    expect(await readdir(path.join(directory, "acquisition-inbox"))).toHaveLength(1);
    await consumeAcquisitions(directory, async next => { expect(next.jobs[0]?.job.status).toBe("completed"); });
  });
});
