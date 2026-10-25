// Shared identity projection: the validator reconstructs the frozen sample from evidence.
export const GROUPS = ['IDENTITY', 'OPPORTUNITY', 'SOLD', 'NEWS'];
const sources = rows => [...new Set(rows.filter(v => typeof v === 'string' && /^https:\/\//.test(v)))];
const make = (group, row, index, urls) => ({
  review_id: `${group}-${String(index + 1).padStart(2, '0')}`, group,
  property_id: row.property_id ?? null, candidate_id: row.id ?? null,
  address: row.address ?? row.claim ?? row.street ?? 'Localizzazione da verificare',
  dossier: row.property_id ? `/casa/${row.property_id}` : null,
  source_urls: sources(urls), snapshot_date: group === 'NEWS' ? '2026-10-20' : '2026-10-19',
  judgement: null, reviewer: null, reviewer_kind: null, reviewed_at: null,
  checked_source_url: null, observed_fact: null, commercial_usefulness: null,
  next_verification: null, notes: null,
});
export function makeReviewRows({ market, opportunities, sold, news }) {
  return [
    ...market.map((r, i) => make('IDENTITY', r, i, r.source_urls ?? [])),
    ...opportunities.map((r, i) => make('OPPORTUNITY', r, i, [...(market.find(m => m.property_id === r.property_id)?.source_urls ?? []), r.breakdown?.sourceUrl])),
    ...sold.map((r, i) => make('SOLD', r, i, [r.source_url, r.price_source_url])),
    ...news.filter(r => r.utility !== 'ARCHIVE_ONLY').map((r, i) => make('NEWS', r, i, [r.source?.source_url])),
  ];
}
