begin;

create table public.private_publications (
  id uuid primary key default gen_random_uuid(),
  legacy_listing_id uuid not null unique
    references public.listings(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  location_id uuid references public.locations(id) on delete set null,
  source text not null,
  source_listing_id text,
  canonical_url text not null,
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'REMOVED')),
  identity_outcome text not null
    check (identity_outcome in ('AUTO_MATCH', 'REVIEW_REQUIRED', 'NEW_PROPERTY')),
  identity_score numeric(5,4) not null default 0
    check (identity_score between 0 and 1),
  identity_margin numeric(5,4) not null default 0
    check (identity_margin between -1 and 1),
  title text not null,
  description text,
  price_amount integer check (price_amount is null or price_amount >= 0),
  surface_sqm numeric check (surface_sqm is null or surface_sqm >= 0),
  rooms numeric check (rooms is null or rooms >= 0),
  floor text,
  first_public_evidence_at timestamptz,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  removed_at timestamptz,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index private_publications_property_state_idx
  on public.private_publications (property_id, state, last_seen_at desc);
create index private_publications_source_idx
  on public.private_publications (source, source_listing_id);

create table public.private_property_match_candidates (
  id uuid primary key default gen_random_uuid(),
  private_publication_id uuid not null
    references public.private_publications(id) on delete restrict,
  candidate_property_id uuid not null
    references public.properties(id) on delete restrict,
  evaluation_version integer not null default 1 check (evaluation_version > 0),
  candidate_rank integer not null check (candidate_rank > 0),
  score numeric(5,4) not null check (score between 0 and 1),
  outcome text not null
    check (outcome in ('AUTO_MATCH', 'REVIEW_REQUIRED', 'NEW_PROPERTY')),
  feature_scores jsonb not null default '{}'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default now(),
  unique (
    private_publication_id,
    candidate_property_id,
    evaluation_version
  )
);

create index private_property_match_candidates_review_idx
  on public.private_property_match_candidates (
    outcome,
    score desc,
    evaluated_at desc
  );

alter table public.lifecycle_jobs
  drop constraint lifecycle_jobs_job_type_check;
alter table public.lifecycle_jobs
  add constraint lifecycle_jobs_job_type_check check (job_type in (
    'SYNC_AGENCY',
    'SYNC_ALL',
    'DEEP_SYNC_AGENCY',
    'DEEP_SYNC_ALL',
    'BOOTSTRAP_AGENCY',
    'BOOTSTRAP_ALL',
    'POST_EXIT_CHECK',
    'BUILDING_DATA_SYNC',
    'SYNC_PRIVATE_RADAR'
  ));

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
    'MARKET_AGE'
  ));

create trigger set_private_publications_updated_at
  before update on public.private_publications
  for each row execute function public.set_updated_at();

-- The legacy tables predate explicit API grants. Private Radar reads them through
-- the trusted backend client, and the existing ingestion backend still owns writes.
grant select, insert, update on table public.listings to service_role;
grant select, insert, update on table public.listing_snapshots to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'private_publications',
    'private_property_match_candidates'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      'authenticated read ' || table_name,
      table_name
    );
  end loop;
end;
$$;

comment on table public.private_publications is
  'Privacy-minimized V2 bridge to legacy private listings; seller contact data remains only in the legacy archive.';
comment on table public.private_property_match_candidates is
  'Auditable identity candidates for private-to-property matching; ambiguous matches require review.';

commit;
