import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  projectStreetCheckpointForRenderer,
  summarizeCompletedGraph,
  summarizeStreetAcquisition,
} from "../src/desktop/state-projection.js";
import type { SisterStreetRunCheckpoint } from "../src/services/sister-street-run.js";
import {
  hasRetryableAcquisitionRecords,
  prepareStreetAcquisitionRetry,
  selectRicherStreetCheckpoint,
  skipStreetAcquisitionRecord,
} from "../src/services/sister-street-run.js";

describe("proiezione leggera dello stato desktop", () => {
  it("usa i riepiloghi e le proiezioni leggere nei due canali IPC desktop", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");

    expect(main).toContain("summarizeCompletedGraph(await repo.loadGraph(job.id))");
    expect(main).toContain('ipcMain.handle("desktop:skip-acquisition-record"');
    expect(main).toContain("repo.listSavedJobImportCounts([...savedJobs, ...refinementJobs].map((job) => job.id))");
    expect(main).toContain("const savedPartitions = partitionPropertyJobs([...createdRefinementSeeds, ...allSavedJobs])");
    expect(main).toContain("repo.ensureCompletedWorkRefinement(job)");
    expect(main).toContain("active: workImportActive");
    expect(main).toContain("jobs: refinementJobs");
    expect(renderer).toContain("job.import_progress?.handled");
    expect(main).toContain("checkpoint: projectStreetCheckpointForRenderer(streetRunCheckpoint)");
    expect(main).toContain("checkpoint: projectStreetCheckpointForRenderer(refinementRunCheckpoint)");
    expect(main).toContain("streetRunCheckpoint: projectStreetCheckpointForRenderer(checkpoint)");
    expect(renderer).toContain("item.peopleCount ?? item.people?.length ?? 0");
    expect(renderer).toContain("if (renderKey === jobsRenderKey) return");
    expect(renderer).toContain("if (renderKey === completedImportsRenderKey)");
  });

  it("non limita il numero di acquisizioni conservate pronte da importare", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../src/desktop/renderer/index.html", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../src/desktop/renderer/styles.css", import.meta.url), "utf8");

    expect(main).not.toContain("MAX_ACQUISIZIONI_CONSERVATE");
    expect(main).not.toContain("assertSpazioPerConservare");
    expect(renderer).toContain('$("jobCount").textContent = String(conservate)');
    expect(renderer).toContain("Pronta per l'import");
    expect(renderer).toContain("Continua acquisizione");
    expect(renderer).toContain("data-resume-acquisition");
    expect(renderer).toContain("detail-workspace-columns");
    expect(renderer).toContain("jobDetailEditMarkup");
    expect(renderer).toContain("Inizia import");
    expect(renderer).toContain("data-skip-sister-record");
    expect(main).toContain('ipcMain.handle("desktop:resume-acquisition"');
    expect(main).toContain("acquisitionCheckpoint: checkpoint");
    expect(main).toContain('status: "paused"');
    expect(renderer).toContain("Prima riga aperta");
    expect(renderer).toContain("ancora aperte");
    expect(renderer).toContain("non sono consecutive");
    expect(renderer).not.toContain("${conservate}/3");
    expect(html).not.toContain("Al massimo tre");
    expect(html).toContain('id="expandAllOwnersToggle"');
    expect(renderer).toContain("Espansione a un livello di tutti i proprietari attiva");
    expect(main).toContain("expandAllOwners,");
    expect(styles).toContain("#jobDetailContent { display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }");
    expect(styles).toContain(".detail-workspace-columns .detail-accordion:last-child .detail-accordion-body { grid-template-rows: auto minmax(0, 1fr); }");
    expect(styles).toMatch(/\.detail-property-list\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(styles).toMatch(/\.acquisition-record-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  });

  it("riassume un grafo grande senza inviare immobili, persone e quote al renderer", () => {
    const properties = Array.from({ length: 2_000 }, (_, index) => ({
      id: `property-${index}`,
      processing_status: index < 3 ? "skipped" : "completed",
      raw_payload: null,
    }));
    const people = Array.from({ length: 2_500 }, (_, index) => ({ id: `person-${index}` }));
    const ownerships = Array.from({ length: 2_500 }, (_, index) => ({
      property_id: `property-${index % properties.length}`,
      person_id: `person-${index}`,
    }));

    expect(summarizeCompletedGraph({ properties, people, ownerships })).toEqual({
      propertyCount: 2_000,
      peopleCount: 2_500,
      ownershipCount: 2_500,
      completedProperties: 1_997,
      skippedProperties: 3,
      skippedPeople: 6,
    });
  });

  it("toglie dal solo payload UI le chiavi catastali pesanti del checkpoint", () => {
    const checkpoint: SisterStreetRunCheckpoint = {
      version: 3,
      strategy: "bulk_exact_variants",
      mode: "dry_run",
      importJobId: null,
      requestedStreet: "VIA TEST",
      municipality: "BITONTO",
      status: "running",
      startedAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:01.000Z",
      completedAt: null,
      nextCivicNumber: 1,
      currentVariantIndex: 1,
      emptyWindow: 0,
      consecutiveEmptyByVariant: {},
      variants: [],
      results: [{
        civicNumber: null,
        variantKey: "test",
        variantSourceId: "1",
        outcome: "found",
        rawRecords: 2_000,
        acceptedProperties: 2_000,
        propertyKeys: ["BITONTO|1|1|1", "BITONTO|1|1|2"],
        ownersRead: 2_500,
        skippedPropertyRows: 0,
        warnings: [],
        elapsedMs: 1_000,
      }],
      totalRawRecords: 2_000,
      totalAcceptedOccurrences: 2_000,
      totalAcceptedProperties: 2_000,
      uniquePropertyKeys: ["BITONTO|1|1|1", "BITONTO|1|1|2"],
      totalOwnersRead: 2_500,
      totalSkippedPropertyRows: 0,
      lastError: null,
      inferredLastUsefulCivic: null,
    };

    const projected = projectStreetCheckpointForRenderer(checkpoint);

    expect(projected?.uniquePropertyKeys).toEqual([]);
    expect(projected?.results[0]?.propertyKeys).toEqual([]);
    expect(projected?.results[0]?.expandedPropertyKeys).toEqual([]);
    expect(projected?.results[0]?.expandedOwnerKeys).toEqual([]);
    expect(projected?.totalAcceptedProperties).toBe(2_000);
    expect(checkpoint.uniquePropertyKeys).toHaveLength(2);
    expect(checkpoint.results[0]?.propertyKeys).toHaveLength(2);
  });

  it("separa posizione corrente e righe concluse nell'acquisizione", () => {
    const checkpoint: SisterStreetRunCheckpoint = {
      version: 4,
      strategy: "bulk_exact_variants",
      mode: "live",
      importJobId: "job-1",
      requestedStreet: "VIA TEST",
      municipality: "BITONTO",
      status: "paused",
      startedAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:01:00.000Z",
      completedAt: null,
      nextCivicNumber: 1,
      currentVariantIndex: 0,
      emptyWindow: 0,
      consecutiveEmptyByVariant: {},
      variants: [{ key: "test", sourceId: "1", value: "1", text: "VIA TEST", occurrence: 0 }],
      results: [{
        civicNumber: null,
        variantKey: "test",
        variantSourceId: "1",
        outcome: "paused",
        rawRecords: 150,
        acceptedProperties: 2,
        propertyKeys: ["p1", "p2"],
        ownersRead: 2,
        skippedPropertyRows: 0,
        warnings: [],
        elapsedMs: 1000,
        recordLedger: [
          { index: 1, key: "p1", label: "Via Test 1", ownerNames: ["LUIGI VERDI"], status: "completed", anomaly: null, completedAt: "2026-09-16T10:00:10.000Z" },
          { index: 2, key: "p2", label: "Via Test 2", ownerNames: ["ANNA BIANCHI"], status: "completed", anomaly: null, completedAt: "2026-09-16T10:00:20.000Z" },
        ],
        cursor: { position: 3, total: 150, key: "p3", label: "Via Test 3", ownerNames: ["MARIO ROSSI"] },
      }],
      totalRawRecords: 150,
      totalAcceptedOccurrences: 2,
      totalAcceptedProperties: 2,
      uniquePropertyKeys: ["p1", "p2"],
      totalOwnersRead: 2,
      totalSkippedPropertyRows: 0,
      lastError: null,
      inferredLastUsefulCivic: null,
    };

    expect(summarizeStreetAcquisition(checkpoint)).toEqual(expect.objectContaining({
      state: "paused",
      position: 3,
      total: 150,
      completed: 2,
      remaining: 148,
      currentLabel: "Via Test 3",
      currentOwnerNames: ["MARIO ROSSI"],
    }));
  });

  it("recupera solo le anomalie dal checkpoint locale piu completo", () => {
    const base: SisterStreetRunCheckpoint = {
      version: 4,
      strategy: "bulk_exact_variants",
      mode: "live",
      importJobId: "job-recovery",
      requestedStreet: "VIA TEST",
      municipality: "BITONTO",
      status: "completed",
      startedAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:02:00.000Z",
      completedAt: "2026-09-16T10:02:00.000Z",
      nextCivicNumber: 1,
      currentVariantIndex: 1,
      emptyWindow: 0,
      consecutiveEmptyByVariant: {},
      variants: [{ key: "test", sourceId: "1", value: "1", text: "VIA TEST", occurrence: 0 }],
      results: [{
        civicNumber: null,
        variantKey: "test",
        variantSourceId: "1",
        outcome: "found",
        rawRecords: 3,
        acceptedProperties: 1,
        propertyKeys: ["p1"],
        filteredPropertyKeys: ["p3"],
        ownersRead: 1,
        skippedPropertyRows: 2,
        warnings: ["Riga 2 ignorata: selettore non valido"],
        elapsedMs: 1_000,
        recordLedger: [
          { index: 1, key: "p1", label: "Via Test 1", ownerNames: ["MARIO ROSSI"], status: "completed", anomaly: null, completedAt: "2026-09-16T10:00:10.000Z" },
          { index: 2, key: "p2", label: "Via Test 2", ownerNames: [], status: "completed_with_anomalies", anomaly: "selettore non valido", completedAt: "2026-09-16T10:00:20.000Z" },
          { index: 3, key: "p3", label: "Via Test 3", ownerNames: [], status: "skipped", anomaly: "non_strategic_category", completedAt: "2026-09-16T10:00:30.000Z" },
        ],
        cursor: null,
      }],
      totalRawRecords: 3,
      totalAcceptedOccurrences: 1,
      totalAcceptedProperties: 1,
      uniquePropertyKeys: ["p1"],
      totalOwnersRead: 1,
      totalSkippedPropertyRows: 2,
      lastError: null,
      inferredLastUsefulCivic: null,
    };
    const stale = { ...base, updatedAt: "2026-09-16T10:01:00.000Z", results: [{ ...base.results[0]!, recordLedger: base.results[0]!.recordLedger?.slice(0, 1) }] };

    expect(selectRicherStreetCheckpoint(stale, base)).toBe(base);
    expect(hasRetryableAcquisitionRecords(base)).toBe(true);
    const retry = prepareStreetAcquisitionRetry(base);
    expect(retry).toMatchObject({ status: "paused", completedAt: null, currentVariantIndex: 0, totalSkippedPropertyRows: 1 });
    expect(retry.results[0]?.recordLedger?.map((record) => [record.key, record.status])).toEqual([
      ["p1", "completed"],
      ["p3", "skipped"],
    ]);
    expect(retry.results[0]?.cursor).toMatchObject({ position: 2, total: 3, key: "p2" });

    const skipped = skipStreetAcquisitionRecord(base, "p2");
    expect(skipped.results[0]?.recordLedger?.map((record) => [record.key, record.status])).toEqual([
      ["p1", "completed"],
      ["p2", "skipped"],
      ["p3", "skipped"],
    ]);
    expect(skipped.results[0]?.recordLedger?.[1]?.anomaly).toContain("Esclusa manualmente");
    expect(hasRetryableAcquisitionRecords(skipped)).toBe(false);
  });
});
