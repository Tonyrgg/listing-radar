import { hashValue, type EvidenceClaim } from "@/lib/property-lifecycle/contracts/normalized-listing";

export const EXTERNAL_POLICY = {
  version: "external_market_evidence_v1",
  confidence: { explicitDate: 0.95, explicitStatus: 0.95, currentPrice: 0.95, previousPrice: 0.9,
    identity: 0.9, agent: 0.9, primaryCapture: 0.9, indexCapture: 0.65, invalidClaim: 0.45, contradictionPenalty: 0.2 },
  http: { concurrency: 1, delayMs: 1500, timeoutMs: 20_000, retries: 2, maxPages: 100, maxBodyBytes: 5_000_000 },
  deepRotationHours: 168,
  configRefreshMs: 30_000,
} as const;
export const EXTERNAL_SOURCES = ["WIKICASA", "IMMOBILIARE", "CASA", "REMAX", "IDEALISTA", "SEARCH_INDEX"] as const;
export type ExternalSource = typeof EXTERNAL_SOURCES[number];
export type AgencyRole = "OUR_AGENCY" | "COMPETITOR" | "PRIVATE" | "UNKNOWN";
export type RetrievalMethod = "PRIMARY_HTTP" | "PRIMARY_CAPTURE" | "INDEX_CAPTURE";

// A calendar date is a day, not a guessed instant of publication. Preserve precision in metadata.
export function explicitDate(raw: string | null, observedAt: string): string | null {
  if (!raw) return null;
  if (raw.includes("T") && !Number.isFinite(Date.parse(raw))) return null;
  const months = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  let parts = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  let year: number, month: number, day: number;
  if (parts) [, year, month, day] = parts.map(Number);
  else {
    parts = raw.trim().match(/^(\d{1,2})[/.\s-](\d{1,2}|[a-zà]+)[/.\s-](\d{4})$/i);
    if (!parts) return null;
    day = Number(parts[1]); year = Number(parts[3]);
    month = /^\d+$/.test(parts[2]) ? Number(parts[2]) : months.indexOf(parts[2].toLowerCase().slice(0, 3)) + 1;
  }
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = new Date(Date.UTC(year, month - 1, day)).toISOString();
  return value.slice(0, 10) === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` &&
    value.slice(0, 10) <= observedAt.slice(0, 10) ? value : null;
}

export function externalClaim(input: {
  source: ExternalSource; url: string; observedAt: string; method: RetrievalMethod;
  kind: string; key: string; raw: string | null; value: unknown; confidence: number;
  date?: string | null; metadata?: Record<string, unknown>;
}): EvidenceClaim {
  const ceiling = input.method === "INDEX_CAPTURE" ? EXTERNAL_POLICY.confidence.indexCapture :
    input.method === "PRIMARY_CAPTURE" ? EXTERNAL_POLICY.confidence.primaryCapture : 1;
  return { kind: input.kind, claimKey: input.key, sourceUrl: input.url,
    extractionMethod: `${input.source}_${input.method}_V1`, rawValue: input.raw,
    normalizedValue: input.value, confidence: Math.min(input.confidence, ceiling), observedAt: input.observedAt,
    sourceRecordedAt: input.date ?? null, metadata: { source: input.source, policyVersion: EXTERNAL_POLICY.version,
      retrievalMethod: input.method, currentPresence: input.method === "PRIMARY_HTTP",
      precision: input.date ? "DAY" : "OBSERVATION", ...input.metadata } };
}

export function evidenceIdentity(claim: EvidenceClaim): string {
  const value = claim.normalizedValue && typeof claim.normalizedValue === "object" && !Array.isArray(claim.normalizedValue)
    ? Object.fromEntries(Object.entries(claim.normalizedValue).filter(([key]) => !["soldObservedAt", "changeUpperBound"].includes(key))) : claim.normalizedValue;
  return hashValue({ sourceUrl: claim.sourceUrl, key: claim.claimKey, value,
    recorded: claim.sourceRecordedAt, method: claim.extractionMethod, metadata: claim.metadata });
}

export function detailRequired(input: { known: boolean; previousMarker: string | null; marker: string | null;
  lastDetailAt: string | null; now: string; deep?: boolean; exitVerification?: boolean; policyChanged?: boolean }): boolean {
  return !input.known || input.deep === true || input.exitVerification === true || input.policyChanged === true ||
    !input.marker || input.marker !== input.previousMarker || !input.lastDetailAt ||
    Date.parse(input.now) - Date.parse(input.lastDetailAt) >= EXTERNAL_POLICY.deepRotationHours * 3_600_000;
}
