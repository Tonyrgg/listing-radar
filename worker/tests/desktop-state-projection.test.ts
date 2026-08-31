import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  projectStreetCheckpointForRenderer,
  summarizeCompletedGraph,
} from "../src/desktop/state-projection.js";
import type { SisterStreetRunCheckpoint } from "../src/services/sister-street-run.js";

describe("proiezione leggera dello stato desktop", () => {
  it("usa i riepiloghi e le proiezioni leggere nei due canali IPC desktop", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");

    expect(main).toContain("summarizeCompletedGraph(await repo.loadGraph(job.id))");
    expect(main).toContain("checkpoint: streetRunActive ? projectStreetCheckpointForRenderer(streetRunCheckpoint) : null");
    expect(main).toContain("streetRunCheckpoint: projectStreetCheckpointForRenderer(checkpoint)");
    expect(renderer).toContain("item.peopleCount ?? item.people?.length ?? 0");
    expect(renderer).toContain("if (renderKey === jobsRenderKey) return");
    expect(renderer).toContain("if (renderKey === completedImportsRenderKey)");
  });

  it("non limita il numero di acquisizioni conservate pronte da importare", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../src/desktop/renderer/index.html", import.meta.url), "utf8");

    expect(main).not.toContain("MAX_ACQUISIZIONI_CONSERVATE");
    expect(main).not.toContain("assertSpazioPerConservare");
    expect(renderer).toContain('$("jobCount").textContent = String(conservate)');
    expect(renderer).not.toContain("${conservate}/3");
    expect(html).not.toContain("Al massimo tre");
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
    expect(projected?.totalAcceptedProperties).toBe(2_000);
    expect(checkpoint.uniquePropertyKeys).toHaveLength(2);
    expect(checkpoint.results[0]?.propertyKeys).toHaveLength(2);
  });
});
