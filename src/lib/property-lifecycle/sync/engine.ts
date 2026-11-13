import type { AdapterHealthState } from "@/lib/property-lifecycle/contracts/normalized-listing";
import {
  processListingAssets,
  type AssetProcessingResult,
} from "@/lib/property-lifecycle/assets/pipeline";
import type { NormalizedListingV2 } from "@/lib/property-lifecycle/contracts/normalized-listing";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";
import {enrichHistoricalPresence,historicalCandidates} from '../adapters/historical-presence';
import {
  PropertyLifecycleRepository,
  type SyncRunCounts,
} from "@/lib/property-lifecycle/persistence/repository";

export type SyncMode = "SYNC" | "DEEP_SYNC" | "BOOTSTRAP" | "FIXTURE";

export interface SyncResult {
  syncRunId: string;
  healthState: AdapterHealthState;
  inventoryComplete: boolean;
  absenceEvaluationAllowed: boolean;
  counts: SyncRunCounts;
  sourceReasons?: string[];
  responseStatus?: number;
}

function numericSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function runAgencySync(input: {
  adapter: PropertyLifecycleAdapter;
  repository: PropertyLifecycleRepository;
  mode?: SyncMode;
  jobId?: string | null;
  observedAt?: string;
  assetProcessor?: (listing: NormalizedListingV2) => Promise<AssetProcessingResult>;
  assertOwnership?: () => void;
}): Promise<SyncResult> {
  const startedAt = Date.now();
  const mode = input.mode ?? "SYNC";
  const agency = await input.repository.getAgencyBySlug(input.adapter.agencySlug);
  if (agency.adapter_key !== input.adapter.key) {
    throw new Error(
      `Agency ${agency.slug} expects adapter ${agency.adapter_key}, received ${input.adapter.key}.`,
    );
  }

  const syncRunId = await input.repository.createSyncRun({
    agencyId: agency.id,
    adapterKey: input.adapter.key,
    mode,
    jobId: input.jobId,
  });
  const counts: SyncRunCounts = {
    discoveredCount: 0,
    normalizedCount: 0,
    inScopeCount: 0,
    excludedCount: 0,
    errorCount: 0,
    missingCount: 0,
    transitionedCount: 0,
  };
  const detailErrors: Array<{ sourceKey: string; message: string }> = [];
  const assetWarnings: string[] = [];
  let deferredIdentityCount=0;
  let persistedCount = 0;

  try {
    const inventory = await input.adapter.fetchInventory();
    counts.discoveredCount = inventory.items.length;
    counts.errorCount = inventory.diagnostics.parseErrorCount;
    const observedSourceKeys = new Set(inventory.items.map((item) => item.sourceKey));
    const historical=mode==='DEEP_SYNC'&&process.env.LIFECYCLE_HISTORICAL_DATES==='true'
      ?historicalCandidates(inventory.items,new Date().toISOString().slice(0,10)):new Set<string>();

    for (const item of inventory.items) {
      input.assertOwnership?.();
      try {
        const document = await input.adapter.fetchDetail(item);
        let listing = await input.adapter.normalize(document);
        if(historical.has(item.sourceKey)&&listing.location.scope==='IN_SCOPE')listing=await enrichHistoricalPresence(input.adapter,document,listing);
        counts.normalizedCount += 1;

        /* Un dubbio già sciolto da una persona non si ripropone: quando
         * qualcuno ha detto dove sta questo annuncio, la sua risposta vale più
         * del risolutore, entra nella posizione salvata e la coda non lo
         * rivede. */
        if (listing.location.scope !== "REVIEW") {
          /* Il risolutore ha imparato a leggere questo indirizzo: il caso che
           * ne era nato non ha più niente da chiedere. */
          await input.repository.closeSettledGeographyReview({
            agencyId: agency.id,
            sourceKey: listing.source.sourceKey,
            scope: listing.location.scope,
            reasons: listing.location.reasons,
          });
        }

        const deciso =
          listing.location.scope === "REVIEW"
            ? await input.repository.resolvedGeographyScope({
                agencyId: agency.id,
                sourceKey: listing.source.sourceKey,
              })
            : null;
        const situato: NormalizedListingV2 = deciso
          ? {
              ...listing,
              location: {
                ...listing.location,
                scope: deciso,
                municipality:
                  deciso === "IN_SCOPE"
                    ? listing.location.municipality ?? "Bitonto"
                    : listing.location.municipality,
                resolutionMethod: "HUMAN_DECISION_V1",
                resolutionConfidence: 1,
                reasons: [...listing.location.reasons, "human_geography_decision"],
              },
            }
          : listing;

        if (situato.location.scope !== "IN_SCOPE") {
          counts.excludedCount += 1;
          if (situato.location.scope === "REVIEW") {
            await input.repository.recordGeographyReview({
              agencyId: agency.id,
              syncRunId,
              listing,
            });
          }
          continue;
        }

        counts.inScopeCount += 1;
        const fallback=situato.provenance.accessFallback===true;
        const inspectCover = mode === "SYNC" && process.env.LIFECYCLE_SOLD_OCR === "true";
        const assetResult = ["DEEP_SYNC", "BOOTSTRAP"].includes(mode)||fallback||inspectCover
          ? await (input.assetProcessor ?? processListingAssets)(inspectCover?{...situato,assets:situato.assets.filter(a=>a.kind==='IMAGE').slice(0,1)}:fallback?{...situato,assets:situato.assets.filter(a=>a.kind==='IMAGE').slice(0,2)}:situato)
          : { assets: [], warnings: [] };
        assetWarnings.push(...assetResult.warnings);
        input.assertOwnership?.();
        const persisted = await input.repository.persistObservation(
          agency.id,
          syncRunId,
          situato,
          assetResult.assets,
        );
        if('deferred'in persisted&&persisted.deferred){deferredIdentityCount+=1;continue;}
        persistedCount += 1;
        if (persisted.createdPublication) {
          counts.transitionedCount += 1;
        }
      } catch (error) {
        counts.errorCount += 1;
        detailErrors.push({
          sourceKey: item.sourceKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const detailErrorRatio =
      counts.discoveredCount === 0 ? 0 : counts.errorCount / counts.discoveredCount;
    const soldTextUnverified = assetWarnings.some(warning => warning.startsWith('sold_text_inspection_failed:'));
    const sourceHealthState: AdapterHealthState =
      inventory.healthState === "HEALTHY" && (counts.errorCount > 0 || soldTextUnverified)
        ? "DEGRADED"
        : inventory.healthState;
    const observedAt = input.observedAt ?? new Date().toISOString();
    input.assertOwnership?.();

    const healthEvaluation = await input.repository.recordAdapterHealth({
      agencyId: agency.id,
      syncRunId,
      state: sourceHealthState,
      sourceComplete: inventory.complete,
      observedCount: inventory.diagnostics.observedCount,
      expectedCount: inventory.diagnostics.expectedCount,
      parseErrorCount: counts.errorCount,
      structureFingerprint: inventory.structureFingerprint,
      reasons: [...inventory.diagnostics.reasons, ...(soldTextUnverified ? ['sold_text_verification_unavailable'] : [])],
      diagnostics: { ...inventory.diagnostics },
      responseStatus: inventory.response?.status,
    });
    const healthState = healthEvaluation.effectiveState;
    const inventoryComplete = healthEvaluation.inventoryComplete;
    const absenceEvaluationAllowed =
      healthEvaluation.absenceEvaluationAllowed && counts.errorCount === 0 && !soldTextUnverified &&
      inventory.complete && mode !== "BOOTSTRAP" && inventory.absenceAuthoritative!==false;


    const status: "SUCCEEDED" | "FAILED" | "PARTIAL" = healthState === "FAILED" ? "FAILED" : healthState === "HEALTHY" ? "SUCCEEDED" : "PARTIAL";
    const completion = {
      syncRunId,
      status,
      observedSourceKeys: [...observedSourceKeys],
      finishedAt: observedAt,
      healthState,
      inventoryComplete,
      absenceEvaluationAllowed,
      expectedCount: inventory.diagnostics.expectedCount,
      counts,
      structureFingerprint: inventory.structureFingerprint,
      diagnostics: {
        inventory: inventory.diagnostics,
        deferredIdentityCount,
        absenceAuthoritative:inventory.absenceAuthoritative!==false,
        detailErrorRatio,
        detailErrors,
        assetWarnings,
        durationMs: Date.now() - startedAt,
        processedCount: counts.normalizedCount,
        persistedCount,
        successPercentage: counts.discoveredCount > 0
          ? Math.round(100 * persistedCount / counts.discoveredCount) : 0,
        timeoutCount: detailErrors.filter((issue) => /timeout|timed out|abort/i.test(issue.message)).length,
      },
    };
    // Absence is committed only after the source inventory and its health are durably complete.
    await input.repository.finalizeSyncRun(completion);
    if (absenceEvaluationAllowed) {
      const missing = await input.repository.applyMissingObservations({
        agencyId: agency.id,
        syncRunId,
        observedSourceKeys,
        observedAt,
        healthState,
        inventoryComplete,
        missingHealthyRunThreshold: numericSetting(
          agency.settings,
          "missingHealthyRunThreshold",
          2,
        ),
      });
      counts.missingCount = missing.missingCount;
      counts.transitionedCount += missing.transitionedCount;
    }

    if (counts.missingCount || counts.transitionedCount) await input.repository.finalizeSyncRun({...completion,counts});

    return {
      syncRunId,
      healthState,
      inventoryComplete,
      absenceEvaluationAllowed,
      counts,
      sourceReasons: inventory.diagnostics.reasons,
      responseStatus: inventory.response?.status,
    };
  } catch (error) {
    await input.repository.recordAdapterHealth({
      agencyId: agency.id, syncRunId, state: "FAILED", sourceComplete: false,
      observedCount: counts.discoveredCount, expectedCount: null, parseErrorCount: counts.errorCount + 1,
      structureFingerprint: "unavailable", reasons: ["sync_failed"],
      diagnostics: { durationMs: Date.now() - startedAt },
    });
    await input.repository.finalizeSyncRun({
      syncRunId,
      status: "FAILED",
      healthState: "FAILED",
      inventoryComplete: false,
      absenceEvaluationAllowed: false,
      expectedCount: null,
      counts: { ...counts, errorCount: counts.errorCount + 1 },
      structureFingerprint: "unavailable",
      diagnostics: {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        processedCount: counts.normalizedCount,
      },
    });
    throw error;
  }
}
