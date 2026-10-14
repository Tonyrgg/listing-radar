-- The live EXPLAIN showed repeated evidence heap reads for every market row.
-- These small partial indexes retain all original data and deterministic ordering.
begin;
set local lock_timeout='5s';
create index if not exists evidence_sold_graphic_publication_idx
  on public.evidence(publication_id,observed_at) where claim_key='publication.soldGraphic';
create index if not exists events_sold_agency_listing_idx
  on public.events(agency_listing_id,occurred_at) where event_type='SOURCE_MARKED_SOLD';
create index if not exists snapshot_observations_price_idx
  on public.snapshot_observations(publication_id,observed_at,id) include(price_amount)
  where price_amount is not null;
commit;
