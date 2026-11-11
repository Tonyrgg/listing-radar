export function classifySourceReading(health: string | null, syncStatus: string | null, checkedAt: string | null, now: number): 'healthy'|'broken'|'partial'|'unknown' {
  if (['FAILED','STRUCTURE_CHANGED'].includes(health ?? '') || syncStatus === 'FAILED') return 'broken';
  if (health === 'DEGRADED' || syncStatus === 'PARTIAL') return 'partial';
  const at = checkedAt ? Date.parse(checkedAt) : NaN;
  if (health === 'HEALTHY') return Number.isFinite(at) && at <= now && now-at <= 86_400_000 ? 'healthy':'partial';
  return 'unknown';
}
