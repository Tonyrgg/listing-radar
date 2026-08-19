import type { AdapterHealthState } from "@/lib/property-lifecycle/contracts/normalized-listing";
import {
  processListingAssets,
  type AssetProcessingResult,
} from "@/lib/property-lifecycle/assets/pipeline";
import type { NormalizedListingV2 } from "@/lib/property-lifecycle/contracts/normalized-listing";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";
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
}): Promise<SyncResult> {
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

  try {
    const inventory = await input.adapter.fetchInventory();
    counts.discoveredCount = inventory.items.length;
    const observedSourceKeys = new Set(inventory.items.map((item) => item.sourceKey));

    for (const item of inventory.items) {
      try {
        const document = await input.adapter.fetchDetail(item);
        const listing = await input.adapter.normalize(document);
        counts.normalizedCount += 1;

        if (listing.location.scope !== "IN_SCOPE") {
          counts.excludedCount += 1;
          if (listing.location.scope === "REVIEW") {
            await input.repository.recordGeographyReview({
              agencyId: agency.id,
              syncRunId,
              listing,
            });
          }
          continue;
        }

        counts.inScopeCount += 1;
        const assetResult = ["DEEP_SYNC", "BOOTSTRAP"].includes(mode)
          ? await (input.assetProcessor ?? processListingAssets)(listing)
          : { assets: [], warnings: [] };
        assetWarnings.push(...assetResult.warnings);
        const persisted = await input.repository.persistObservation(
          agency.id,
          syncRunId,
          listing,
          assetResult.assets,
        );
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
    const healthState: AdapterHealthState =
      inventory.healthState === "HEALTHY" && detailErrorRatio > 0.1
        ? "DEGRADED"
        : inventory.healthState;
    const inventoryComplete = inventory.complete && healthState === "HEALTHY";
    const absenceEvaluationAllowed =
      healthState === "HEALTHY" && inventoryComplete && mode !== "BOOTSTRAP";
    const observedAt = input.observedAt ?? new Date().toISOString();

    await input.repository.recordAdapterHealth({
      agencyId: agency.id,
      syncRunId,
      state: healthState,
      observedCount: inventory.diagnostics.observedCount,
      expectedCount: inventory.diagnostics.expectedCount,
      parseErrorCount: inventory.diagnostics.parseErrorCount + counts.errorCount,
      structureFingerprint: inventory.structureFingerprint,
      reasons: inventory.diagnostics.reasons,
      diagnostics: { ...inventory.diagnostics },
      responseStatus: inventory.response?.status,
    });

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

    const status = healthState === "FAILED" ? "FAILED" : healthState === "HEALTHY" ? "SUCCEEDED" : "PARTIAL";
    await input.repository.finalizeSyncRun({
      syncRunId,
      status,
      healthState,
      inventoryComplete,
      absenceEvaluationAllowed,
      expectedCount: inventory.diagnostics.expectedCount,
      counts,
      structureFingerprint: inventory.structureFingerprint,
      diagnostics: {
        inventory: inventory.diagnostics,
        detailErrorRatio,
        detailErrors,
        assetWarnings,
      },
    });

    return {
      syncRunId,
      healthState,
      inventoryComplete,
      absenceEvaluationAllowed,
      counts,
    };
  } catch (error) {
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
      },
    });
    throw error;
  }
}
