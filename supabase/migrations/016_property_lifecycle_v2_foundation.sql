begin;

-- Property Lifecycle V2 is intentionally additive. The legacy listing radar
-- tables remain the source of truth for the existing application.

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  adapter_key text not null unique,
  website_url text not null,
  inventory_url text not null,
  enabled boolean not null default true,
  monitored_localities text[] not null default array['bitonto', 'palombaio', 'mariotto']::text[],
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agencies_slug_format_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  raw_text text,
  country_code text not null default 'IT',
  region text,
  province text,
  municipality text,
  locality text,
  postal_code text,
  street_name text,
  street_number text,
  latitude double precision,
  longitude double precision,
  scope_state text not null default 'REVIEW'
    check (scope_state in ('IN_SCOPE', 'OUT_OF_SCOPE', 'REVIEW')),
  resolution_method text,
  resolution_confidence numeric(5,4)
    check (resolution_confidence is null or resolution_confidence between 0 and 1),
  normalized_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_coordinate_pair_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create index locations_scope_idx on public.locations (scope_state, municipality, locality);

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete set null,
  normalized_key text unique,
  display_name text,
  attributes jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references public.buildings(id) on delete set null,
  primary_location_id uuid references public.locations(id) on delete set null,
  property_type text,
  identity_status text not null default 'PROVISIONAL'
    check (identity_status in ('PROVISIONAL', 'CONFIRMED', 'MERGED', 'SPLIT', 'REVIEW')),
  true_market_start_lower_bound timestamptz,
  true_market_start_upper_bound timestamptz,
  true_market_start_method text,
  true_market_start_confidence numeric(5,4)
    check (true_market_start_confidence is null or true_market_start_confidence between 0 and 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  canonical_attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_market_start_bounds_check check (
    true_market_start_lower_bound is null
    or true_market_start_upper_bound is null
    or true_market_start_lower_bound <= true_market_start_upper_bound
  )
);

create index properties_location_idx on public.properties (primary_location_id);
create index properties_building_idx on public.properties (building_id);
create index properties_true_market_start_idx on public.properties (true_market_start_lower_bound);

create table public.agency_listings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  agency_reference text,
  state text not null default 'ACTIVE' check (state in (
    'ACTIVE',
    'EXIT_PENDING',
    'CLOSED_SOLD',
    'CLOSED_SWITCHED',
    'CLOSED_TO_PRIVATE',
    'CLOSED_WITHDRAWN',
    'OFF_MARKET_NO_SALE_EVIDENCE'
  )),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  state_confidence numeric(5,4)
    check (state_confidence is null or state_confidence between 0 and 1),
  state_reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, property_id)
);

create index agency_listings_reference_idx
  on public.agency_listings (agency_id, agency_reference)
  where agency_reference is not null;
create index agency_listings_state_idx on public.agency_listings (agency_id, state);

create table public.lifecycle_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in (
    'SYNC_AGENCY',
    'SYNC_ALL',
    'DEEP_SYNC_AGENCY',
    'DEEP_SYNC_ALL',
    'BOOTSTRAP_AGENCY',
    'BOOTSTRAP_ALL',
    'POST_EXIT_CHECK',
    'BUILDING_DATA_SYNC'
  )),
  agency_id uuid references public.agencies(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED')),
  priority integer not null default 0,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  dedupe_key text,
  worker_id text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index lifecycle_jobs_active_dedupe_idx on public.lifecycle_jobs (dedupe_key)
  where dedupe_key is not null and status in ('QUEUED', 'RUNNING', 'RETRY');
create index lifecycle_jobs_claim_idx
  on public.lifecycle_jobs (priority desc, run_after, created_at)
  where status in ('QUEUED', 'RUNNING', 'RETRY');

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  job_id uuid references public.lifecycle_jobs(id) on delete set null,
  adapter_key text not null,
  mode text not null default 'SYNC'
    check (mode in ('SYNC', 'DEEP_SYNC', 'BOOTSTRAP', 'FIXTURE')),
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  health_state text check (health_state in ('HEALTHY', 'DEGRADED', 'FAILED', 'STRUCTURE_CHANGED')),
  inventory_complete boolean not null default false,
  absence_evaluation_allowed boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  expected_count integer check (expected_count is null or expected_count >= 0),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  normalized_count integer not null default 0 check (normalized_count >= 0),
  in_scope_count integer not null default 0 check (in_scope_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  transitioned_count integer not null default 0 check (transitioned_count >= 0),
  structure_fingerprint text,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sync_runs_absence_health_check check (
    not absence_evaluation_allowed
    or (health_state = 'HEALTHY' and inventory_complete)
  )
);

create index sync_runs_agency_started_idx on public.sync_runs (agency_id, started_at desc);
create index sync_runs_health_idx on public.sync_runs (health_state, started_at desc);

create table public.adapter_health (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  state text not null check (state in ('HEALTHY', 'DEGRADED', 'FAILED', 'STRUCTURE_CHANGED')),
  checked_at timestamptz not null default now(),
  response_status integer,
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  observed_count integer check (observed_count is null or observed_count >= 0),
  expected_count integer check (expected_count is null or expected_count >= 0),
  parse_error_count integer not null default 0 check (parse_error_count >= 0),
  structure_fingerprint text,
  reasons jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index adapter_health_agency_checked_idx
  on public.adapter_health (agency_id, checked_at desc);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  agency_listing_id uuid not null references public.agency_listings(id) on delete restrict,
  source_key text not null,
  external_id text,
  canonical_url text not null,
  transaction_type text not null default 'SALE'
    check (transaction_type in ('SALE', 'RENT', 'OTHER', 'UNKNOWN')),
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'MISSING_PENDING', 'REMOVED', 'SOLD_MARKED')),
  source_status text not null default 'UNKNOWN'
    check (source_status in ('ACTIVE', 'NEGOTIATION', 'SOLD', 'REMOVED', 'UNKNOWN')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  missing_healthy_run_count integer not null default 0 check (missing_healthy_run_count >= 0),
  removed_at timestamptz,
  source_recorded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, source_key),
  constraint publications_missing_state_check check (
    (state <> 'MISSING_PENDING' or missing_healthy_run_count > 0)
    and (missing_healthy_run_count = 0 or missing_since is not null)
  )
);

create index publications_agency_state_idx on public.publications (agency_id, state);
create index publications_agency_listing_idx on public.publications (agency_listing_id);
create index publications_last_seen_idx on public.publications (last_seen_at desc);

create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete restrict,
  sync_run_id uuid not null references public.sync_runs(id) on delete restrict,
  contract_version integer not null default 1 check (contract_version > 0),
  observed_at timestamptz not null,
  content_hash text not null,
  normalized_payload jsonb not null,
  title text,
  description text,
  price_amount integer check (price_amount is null or price_amount >= 0),
  price_currency text,
  surface_sqm numeric check (surface_sqm is null or surface_sqm >= 0),
  rooms numeric check (rooms is null or rooms >= 0),
  source_status text,
  availability boolean,
  extraction_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (sync_run_id, publication_id)
);

create index snapshots_publication_observed_idx
  on public.snapshots (publication_id, observed_at desc);
create index snapshots_content_hash_idx on public.snapshots (content_hash);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  snapshot_id uuid references public.snapshots(id) on delete restrict,
  sync_run_id uuid references public.sync_runs(id) on delete restrict,
  evidence_kind text not null,
  source_url text not null,
  extraction_method text not null,
  claim_key text not null,
  raw_value text,
  normalized_value jsonb,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  observed_at timestamptz not null,
  source_recorded_at timestamptz,
  evidence_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (sync_run_id, publication_id, evidence_hash)
);

create index evidence_property_kind_idx on public.evidence (property_id, evidence_kind, observed_at desc);
create index evidence_publication_idx on public.evidence (publication_id, observed_at desc);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  agency_listing_id uuid references public.agency_listings(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  sync_run_id uuid references public.sync_runs(id) on delete restrict,
  event_type text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  actor_type text not null default 'SYSTEM'
    check (actor_type in ('SYSTEM', 'ADAPTER', 'USER', 'IMPORT')),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb
);

create index events_property_occurred_idx on public.events (property_id, occurred_at desc);
create index events_publication_idx on public.events (publication_id, occurred_at desc);
create index events_type_idx on public.events (event_type, occurred_at desc);

create table public.event_evidence (
  event_id uuid not null references public.events(id) on delete restrict,
  evidence_id uuid not null references public.evidence(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, evidence_id)
);

create table public.image_fingerprints (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  snapshot_id uuid references public.snapshots(id) on delete restrict,
  canonical_url text not null,
  algorithm text not null,
  fingerprint text not null,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  source_recorded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, canonical_url, algorithm)
);

create index image_fingerprints_lookup_idx on public.image_fingerprints (algorithm, fingerprint);
create index image_fingerprints_property_idx on public.image_fingerprints (property_id);

create table public.floorplan_fingerprints (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  snapshot_id uuid references public.snapshots(id) on delete restrict,
  canonical_url text not null,
  algorithm text not null,
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, canonical_url, algorithm)
);

create index floorplan_fingerprints_lookup_idx on public.floorplan_fingerprints (algorithm, fingerprint);
create index floorplan_fingerprints_property_idx on public.floorplan_fingerprints (property_id);

create table public.property_match_candidates (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete restrict,
  candidate_property_id uuid not null references public.properties(id) on delete restrict,
  evaluation_version integer not null default 1 check (evaluation_version > 0),
  candidate_rank integer not null check (candidate_rank > 0),
  score numeric(5,4) not null check (score between 0 and 1),
  outcome text not null check (outcome in ('AUTO_MATCH', 'REVIEW_REQUIRED', 'NEW_PROPERTY')),
  feature_scores jsonb not null default '{}'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default now(),
  unique (publication_id, candidate_property_id, evaluation_version)
);

create index property_match_candidates_review_idx
  on public.property_match_candidates (outcome, score desc, evaluated_at desc);

create table public.manual_overrides (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in (
    'PROPERTY', 'AGENCY_LISTING', 'PUBLICATION', 'EVENT', 'IDENTITY_MATCH', 'MARKET_AGE'
  )),
  target_id uuid not null,
  override_key text not null,
  override_value jsonb not null,
  reason text not null check (length(trim(reason)) > 0),
  effective_at timestamptz not null default now(),
  supersedes_id uuid references public.manual_overrides(id) on delete restrict,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index manual_overrides_supersedes_unique_idx
  on public.manual_overrides (supersedes_id)
  where supersedes_id is not null;
create index manual_overrides_target_idx
  on public.manual_overrides (target_type, target_id, override_key, effective_at desc);

create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  review_type text not null check (review_type in (
    'IDENTITY', 'LIFECYCLE', 'ADAPTER_HEALTH', 'GEOGRAPHY', 'DATA_QUALITY'
  )),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  priority integer not null default 0,
  agency_id uuid references public.agencies(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  match_candidate_id uuid references public.property_match_candidates(id) on delete restrict,
  sync_run_id uuid references public.sync_runs(id) on delete restrict,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_queue_status_idx on public.review_queue (status, priority desc, created_at);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  opportunity_type text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'QUALIFIED', 'DISMISSED', 'EXPIRED', 'ACTIONED')),
  score numeric(7,4),
  detected_at timestamptz not null default now(),
  expires_at timestamptz,
  evidence_summary jsonb not null default '{}'::jsonb,
  rule_version integer not null default 1,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_status_score_idx on public.opportunities (status, score desc, detected_at desc);

create table public.building_events (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete restrict,
  event_type text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_url text,
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb
);

create index building_events_building_occurred_idx
  on public.building_events (building_id, occurred_at desc);

-- Shared mutable-table timestamp maintenance.
create trigger set_agencies_updated_at before update on public.agencies
  for each row execute function public.set_updated_at();
create trigger set_locations_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger set_buildings_updated_at before update on public.buildings
  for each row execute function public.set_updated_at();
create trigger set_properties_updated_at before update on public.properties
  for each row execute function public.set_updated_at();
create trigger set_agency_listings_updated_at before update on public.agency_listings
  for each row execute function public.set_updated_at();
create trigger set_publications_updated_at before update on public.publications
  for each row execute function public.set_updated_at();
create trigger set_lifecycle_jobs_updated_at before update on public.lifecycle_jobs
  for each row execute function public.set_updated_at();
create trigger set_review_queue_updated_at before update on public.review_queue
  for each row execute function public.set_updated_at();
create trigger set_opportunities_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

-- Append-only history is protected at the database boundary.
create or replace function public.prevent_property_lifecycle_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only; insert a correcting fact instead', tg_table_name;
end;
$$;

create trigger prevent_snapshots_mutation
  before update or delete on public.snapshots
  for each row execute function public.prevent_property_lifecycle_history_mutation();
create trigger prevent_evidence_mutation
  before update or delete on public.evidence
  for each row execute function public.prevent_property_lifecycle_history_mutation();
create trigger prevent_events_mutation
  before update or delete on public.events
  for each row execute function public.prevent_property_lifecycle_history_mutation();
create trigger prevent_event_evidence_mutation
  before update or delete on public.event_evidence
  for each row execute function public.prevent_property_lifecycle_history_mutation();
create trigger prevent_manual_overrides_mutation
  before update or delete on public.manual_overrides
  for each row execute function public.prevent_property_lifecycle_history_mutation();
create trigger prevent_building_events_mutation
  before update or delete on public.building_events
  for each row execute function public.prevent_property_lifecycle_history_mutation();

-- Atomically claims one eligible job. Expired RUNNING leases are reclaimable.
create or replace function public.claim_lifecycle_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.lifecycle_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;

  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 30 and 3600';
  end if;

  update public.lifecycle_jobs job
  set status = 'DEAD_LETTER',
      finished_at = now(),
      lease_expires_at = null,
      last_error = coalesce(job.last_error, '{}'::jsonb) || jsonb_build_object(
        'message', 'Job lease expired after final attempt',
        'failedAt', now()
      ),
      updated_at = now()
  where job.status = 'RUNNING'
    and job.lease_expires_at < now()
    and job.attempts >= job.max_attempts;

  return query
  with candidate as (
    select job.id
    from public.lifecycle_jobs job
    where job.attempts < job.max_attempts
      and job.run_after <= now()
      and (
        job.status in ('QUEUED', 'RETRY')
        or (job.status = 'RUNNING' and job.lease_expires_at < now())
      )
    order by job.priority desc, job.run_after, job.created_at
    for update skip locked
    limit 1
  )
  update public.lifecycle_jobs job
  set status = 'RUNNING',
      worker_id = p_worker_id,
      attempts = job.attempts + 1,
      leased_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(job.started_at, now()),
      finished_at = null,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

create or replace function public.complete_lifecycle_job(
  p_job_id uuid,
  p_worker_id text
)
returns public.lifecycle_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_job public.lifecycle_jobs;
begin
  update public.lifecycle_jobs job
  set status = 'SUCCEEDED',
      finished_at = now(),
      lease_expires_at = null,
      updated_at = now()
  where job.id = p_job_id
    and job.status = 'RUNNING'
    and job.worker_id = p_worker_id
  returning job.* into completed_job;

  if completed_job.id is null then
    raise exception 'running job % is not owned by worker %', p_job_id, p_worker_id;
  end if;

  return completed_job;
end;
$$;

revoke all on function public.claim_lifecycle_job(text, integer) from public, anon, authenticated;
revoke all on function public.complete_lifecycle_job(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_lifecycle_job(text, integer) to service_role;
grant execute on function public.complete_lifecycle_job(uuid, text) to service_role;

-- Authenticated users may read V2 data. Writes are reserved for service-role
-- workers until explicit application workflows are introduced.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agencies', 'locations', 'buildings', 'properties', 'agency_listings',
    'lifecycle_jobs', 'sync_runs', 'adapter_health', 'publications', 'snapshots',
    'evidence', 'events', 'event_evidence', 'image_fingerprints',
    'floorplan_fingerprints', 'property_match_candidates', 'manual_overrides',
    'review_queue', 'opportunities', 'building_events'
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

insert into public.agencies (
  slug,
  name,
  adapter_key,
  website_url,
  inventory_url,
  settings
)
values
  (
    'iconacasa-bitonto',
    'Iconacasa Bitonto — Piazza Aldo Moro',
    'iconacasa',
    'https://www.iconacasa.com',
    'https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro',
    '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2}'::jsonb
  ),
  (
    'puntocasa-bitonto',
    'PuntoCasa Bitonto',
    'puntocasa',
    'https://www.puntocasagroup.it',
    'https://www.puntocasagroup.it/acquista-la-tua-casa-2/',
    '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2}'::jsonb
  )
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

comment on table public.properties is
  'Durable physical-property identities; a relaunch creates a publication, not a new property.';
comment on table public.events is
  'Append-only Property Lifecycle event ledger. Corrections are new events or manual overrides.';
comment on table public.evidence is
  'Source-attributed facts supporting identity, geography, date, status, and lifecycle conclusions.';
comment on column public.sync_runs.absence_evaluation_allowed is
  'May be true only for a complete HEALTHY inventory; enforced by a check constraint.';
comment on column public.properties.true_market_start_lower_bound is
  'Earliest supported lower bound across publications; never reset merely by relaunch.';

commit;
