import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
import path from "node:path";
import os from "node:os";
import { TerritoryStore } from "../src/territory/store.js";
import { simulationSource } from "../src/territory/providers.js";
import { unitKey, type Street } from "../src/territory/model.js";

const args = process.argv.slice(2);
if (args.some(arg => !/^--(?:units|reads|output)=.+$/.test(arg))) throw new Error("Opzioni: --units=1000 --reads=100 [--output=report.json]");
const option = (name: string, fallback: number, max: number) => {
  const value = Number(args.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`--${name} non valido`);
  return value;
};
const units = option("units", 1000, 10000), reads = option("reads", 100, 1000);
const output = args.find(arg => arg.startsWith("--output="))?.slice("--output=".length);
const directory = await mkdtemp(path.join(os.tmpdir(), "v2-local-benchmark-"));
const street: Street = { id: "benchmark", name: "Via Sintetica", sisterName: "VIA SINTETICA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
try {
  const store = await TerritoryStore.open(directory, [street]);
  let target = "";
  await store.change(state => {
    for (let index = 1; index <= units; index++) {
      const source = simulationSource(street, index, "synthetic-benchmark"), key = unitKey(source), at = "2026-10-25T10:00:00Z";
      target = source.sourcePropertyId;
      state.units[key] = { key, streetIds: [street.id], observations: [{ at, runId: "synthetic", source, origin: "simulation" }], corrections: {}, note: "Fixture sintetica", assessment: null, importedAt: null, crmId: null };
      state.checkpoints[target] = { itemId: target, jobId: "synthetic-benchmark", propertyId: target, stage: "queued", plan: null, people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: null, attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: at };
    }
  });
  const full = () => store.read().checkpoints[target];
  const selected = () => store.readSelected(state => state.checkpoints[target]);
  deepStrictEqual(selected(), full());
  const measure = (read: typeof full) => {
    const startedAt = performance.now();
    for (let index = 0; index < reads; index++) if (read()?.propertyId !== target) throw new Error("Lettura non coerente");
    return Number((performance.now() - startedAt).toFixed(3));
  };
  const wholeArchiveMs: number[] = [], selectedMs: number[] = [];
  for (let round = 0; round < 3; round++) {
    // Alternate order to reduce a systematic warm-up advantage.
    if (round % 2) { selectedMs.push(measure(selected)); wholeArchiveMs.push(measure(full)); }
    else { wholeArchiveMs.push(measure(full)); selectedMs.push(measure(selected)); }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1]!;
  const report = {
    scope: "synthetic local checkpoint reads only; not CRM or end-to-end throughput", units, readsPerRound: reads, rounds: 3,
    equivalentResults: true, wholeArchiveMs, selectedMs,
    medianWholeArchiveMs: median(wholeArchiveMs), medianSelectedMs: median(selectedMs),
    medianSavedMs: Number((median(wholeArchiveMs) - median(selectedMs)).toFixed(3)),
    recordedAt: new Date().toISOString(),
  };
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("v2-local-benchmark-")) throw new Error("Directory benchmark inattesa");
  await rm(target, { recursive: true, force: true });
}
