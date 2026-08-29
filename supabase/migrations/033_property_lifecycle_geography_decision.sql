-- Geography reviews must be answerable, and their answer must stick.
--
-- A GEOGRAPHY review is raised when the resolver cannot tell whether a listing
-- is in Bitonto / Palombaio / Mariotto. The listing is deliberately not
-- persisted at that point, so the review row carries no property_id: it holds
-- the agency, the source key and the raw address, and nothing else. Two things
-- followed from that.
--
-- First, a human answer had nowhere to live: manual_overrides only accepted
-- target types that point at an existing row, so the review UI was recording a
-- geography decision as an IDENTITY_MATCH override. GEOGRAPHY_SCOPE targets the
-- review_queue row itself, the way IDENTITY_MATCH already does.
--
-- Second, recordGeographyReview upserts on dedupe_key with status 'OPEN', so
-- every later sync of the same agency reset a resolved case back to open and the
-- queue never emptied. The application now omits status on conflict; this index
-- lets the sync engine find the standing answer for a listing before deciding
-- to drop it.

alter table public.manual_overrides
  drop constraint manual_overrides_target_type_check;
alter table public.manual_overrides
  add constraint manual_overrides_target_type_check check (target_type in (
    'PROPERTY',
    'AGENCY_LISTING',
    'PUBLICATION',
    'PRIVATE_PUBLICATION',
    'EVENT',
    'IDENTITY_MATCH',
    'GEOGRAPHY_SCOPE',
    'MARKET_AGE'
  ));

create index if not exists review_queue_geography_decision_idx
  on public.review_queue (review_type, dedupe_key)
  where review_type = 'GEOGRAPHY' and status = 'RESOLVED';
