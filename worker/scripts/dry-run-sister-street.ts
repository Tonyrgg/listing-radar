import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { SisterStreetRun, type SisterStreetRunCheckpoint } from "../src/services/sister-street-run.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = argument(name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} deve essere un intero positivo`);
  return value;
}

const street = argument("street")?.trim();
if (!street) throw new Error("Usa --street seguito dalla via esatta");

const checkpointPath = path.resolve(
  argument("checkpoint") ?? path.join(process.env.LOCALAPPDATA ?? process.cwd(), "PropertyDataWorker", "sister-street-dry-run.json"),
);
const shouldResume = process.argv.includes("--resume");
let resume: SisterStreetRunCheckpoint | undefined;
if (shouldResume) {
  resume = JSON.parse(await readFile(checkpointPath, "utf8")) as SisterStreetRunCheckpoint;
}

await mkdir(path.dirname(checkpointPath), { recursive: true });
const browser = await chromium.connectOverCDP(argument("cdp") ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((context) => context.pages())
  .find((candidate) => candidate.url().includes("sister3.agenziaentrate.gov.it"));
if (!page) throw new Error("Scheda SISTER non trovata nel Chrome di lavoro");

let lastPrintedResultCount = resume?.results.length ?? 0;
try {
  const run = new SisterStreetRun(page, {
    startCivic: positiveInteger("start", 1),
    emptyWindow: positiveInteger("empty-window", 50),
    maximumCivic: positiveInteger("max", 5_000),
    acquireOwners: !process.argv.includes("--no-owners"),
    prepareSearchAutomatically: process.argv.includes("--auto-prepare-search"),
    onCheckpoint: async (checkpoint) => {
      const temporaryPath = `${checkpointPath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(checkpoint, null, 2), "utf8");
      await rename(temporaryPath, checkpointPath);
      if (checkpoint.results.length > lastPrintedResultCount) {
        const result = checkpoint.results.at(-1)!;
        lastPrintedResultCount = checkpoint.results.length;
        process.stdout.write(
          `civico=${result.civicNumber} variante=${result.variantSourceId} esito=${result.outcome} `
          + `righe=${result.rawRecords} immobili=${result.acceptedProperties} proprietari=${result.ownersRead} `
          + `escluse=${result.skippedPropertyRows}\n`,
        );
      }
    },
  });
  const result = await run.run(street, resume);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    requestedStreet: result.requestedStreet,
    variants: result.variants.map((variant) => variant.sourceId),
    nextCivicNumber: result.nextCivicNumber,
    inferredLastUsefulCivic: result.inferredLastUsefulCivic,
    totalRawRecords: result.totalRawRecords,
    totalAcceptedOccurrences: result.totalAcceptedOccurrences,
    totalAcceptedProperties: result.totalAcceptedProperties,
    totalOwnersRead: result.totalOwnersRead,
    totalSkippedPropertyRows: result.totalSkippedPropertyRows,
    failedQueries: result.results.filter((item) => item.outcome === "failed").length,
    checkpointPath,
  }, null, 2)}\n`);
} finally {
  await browser.close().catch(() => undefined);
}
