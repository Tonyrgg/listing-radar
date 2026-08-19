import type { AdapterHealthState } from "@/lib/property-lifecycle/contracts/normalized-listing";

export const HEALTH_BASELINE_WINDOW = 12;
export const HEALTH_BASELINE_MIN_SAMPLES = 3;
export const HEALTH_SCHEMA_CONFIRMATION_RUNS = 2;

export interface AdapterHealthBaseline {
  successfulRunCount: number;
  recentInventoryCounts: number[];
  rollingMedian: number | null;
  variability: number | null;
  schemaFingerprint: string | null;
  schemaVersion: number;
  pendingSchemaFingerprint: string | null;
  pendingSchemaRunCount: number;
  consecutiveFailures: number;
  consecutiveHealthyRuns: number;
}

export interface HealthBaselineEvaluation {
  effectiveState: AdapterHealthState;
  inventoryComplete: boolean;
  absenceEvaluationAllowed: boolean;
  baselineReady: boolean;
  anomalyRatio: number | null;
  reasons: string[];
  next: AdapterHealthBaseline;
}

export function emptyHealthBaseline(): AdapterHealthBaseline {
  return {
    successfulRunCount: 0,
    recentInventoryCounts: [],
    rollingMedian: null,
    variability: null,
    schemaFingerprint: null,
    schemaVersion: 0,
    pendingSchemaFingerprint: null,
    pendingSchemaRunCount: 0,
    consecutiveFailures: 0,
    consecutiveHealthyRuns: 0,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function relativeMedianAbsoluteDeviation(values: number[], center: number | null): number | null {
  if (center == null || center <= 0 || values.length < 2) {
    return null;
  }
  const deviation = median(values.map((value) => Math.abs(value - center)));
  return deviation == null ? null : Number((deviation / center).toFixed(4));
}

function failedBaseline(
  baseline: AdapterHealthBaseline,
  input: { pendingSchemaFingerprint?: string | null; pendingSchemaRunCount?: number },
): AdapterHealthBaseline {
  return {
    ...baseline,
    pendingSchemaFingerprint:
      input.pendingSchemaFingerprint === undefined
        ? baseline.pendingSchemaFingerprint
        : input.pendingSchemaFingerprint,
    pendingSchemaRunCount:
      input.pendingSchemaRunCount === undefined
        ? baseline.pendingSchemaRunCount
        : input.pendingSchemaRunCount,
    consecutiveFailures: baseline.consecutiveFailures + 1,
    consecutiveHealthyRuns: 0,
  };
}

export function evaluateHealthBaseline(input: {
  baseline?: AdapterHealthBaseline | null;
  sourceState: AdapterHealthState;
  sourceComplete: boolean;
  observedCount: number;
  structureFingerprint: string;
}): HealthBaselineEvaluation {
  const baseline = input.baseline ?? emptyHealthBaseline();
  const sourceUsable = input.sourceState === "HEALTHY" && input.sourceComplete;

  if (!sourceUsable || input.observedCount === 0) {
    const effectiveState =
      input.observedCount === 0 && input.sourceState === "HEALTHY"
        ? "FAILED"
        : input.sourceState;
    return {
      effectiveState,
      inventoryComplete: false,
      absenceEvaluationAllowed: false,
      baselineReady: false,
      anomalyRatio: null,
      reasons: [
        input.observedCount === 0
          ? "inventory_zero"
          : `source_health_${input.sourceState.toLocaleLowerCase("en")}`,
      ],
      next: failedBaseline(baseline, {}),
    };
  }

  if (
    baseline.schemaFingerprint &&
    input.structureFingerprint !== baseline.schemaFingerprint
  ) {
    const samePending =
      baseline.pendingSchemaFingerprint === input.structureFingerprint;
    const pendingCount = samePending ? baseline.pendingSchemaRunCount + 1 : 1;
    if (pendingCount < HEALTH_SCHEMA_CONFIRMATION_RUNS) {
      return {
        effectiveState: "STRUCTURE_CHANGED",
        inventoryComplete: false,
        absenceEvaluationAllowed: false,
        baselineReady: false,
        anomalyRatio: null,
        reasons: ["schema_fingerprint_changed", "schema_confirmation_pending"],
        next: failedBaseline(baseline, {
          pendingSchemaFingerprint: input.structureFingerprint,
          pendingSchemaRunCount: pendingCount,
        }),
      };
    }

    const resetCounts = [input.observedCount];
    return {
      effectiveState: "HEALTHY",
      inventoryComplete: true,
      absenceEvaluationAllowed: false,
      baselineReady: false,
      anomalyRatio: null,
      reasons: ["schema_version_advanced", "baseline_warmup"],
      next: {
        ...baseline,
        successfulRunCount: baseline.successfulRunCount + 1,
        recentInventoryCounts: resetCounts,
        rollingMedian: input.observedCount,
        variability: null,
        schemaFingerprint: input.structureFingerprint,
        schemaVersion: Math.max(1, baseline.schemaVersion + 1),
        pendingSchemaFingerprint: null,
        pendingSchemaRunCount: 0,
        consecutiveFailures: 0,
        consecutiveHealthyRuns: 1,
      },
    };
  }

  const anomalyRatio =
    baseline.rollingMedian && baseline.rollingMedian > 0
      ? Number((input.observedCount / baseline.rollingMedian).toFixed(4))
      : null;
  const variabilityAllowance = Math.min(0.15, (baseline.variability ?? 0) * 3);
  const minimumPlausibleRatio = 0.7 - variabilityAllowance;
  if (
    baseline.recentInventoryCounts.length >= HEALTH_BASELINE_MIN_SAMPLES &&
    anomalyRatio != null &&
    anomalyRatio < minimumPlausibleRatio
  ) {
    return {
      effectiveState: "DEGRADED",
      inventoryComplete: false,
      absenceEvaluationAllowed: false,
      baselineReady: true,
      anomalyRatio,
      reasons: ["inventory_below_progressive_baseline"],
      next: failedBaseline(baseline, {}),
    };
  }

  const recentInventoryCounts = [
    ...baseline.recentInventoryCounts,
    input.observedCount,
  ].slice(-HEALTH_BASELINE_WINDOW);
  const rollingMedian = median(recentInventoryCounts);
  const variability = relativeMedianAbsoluteDeviation(
    recentInventoryCounts,
    rollingMedian,
  );
  const consecutiveHealthyRuns = baseline.consecutiveHealthyRuns + 1;
  const baselineReady =
    recentInventoryCounts.length >= HEALTH_BASELINE_MIN_SAMPLES &&
    consecutiveHealthyRuns >= HEALTH_BASELINE_MIN_SAMPLES;

  return {
    effectiveState: "HEALTHY",
    inventoryComplete: true,
    absenceEvaluationAllowed: baselineReady,
    baselineReady,
    anomalyRatio,
    reasons: baselineReady ? [] : ["baseline_warmup"],
    next: {
      ...baseline,
      successfulRunCount: baseline.successfulRunCount + 1,
      recentInventoryCounts,
      rollingMedian,
      variability,
      schemaFingerprint: baseline.schemaFingerprint ?? input.structureFingerprint,
      schemaVersion: Math.max(1, baseline.schemaVersion),
      pendingSchemaFingerprint: null,
      pendingSchemaRunCount: 0,
      consecutiveFailures: 0,
      consecutiveHealthyRuns,
    },
  };
}
