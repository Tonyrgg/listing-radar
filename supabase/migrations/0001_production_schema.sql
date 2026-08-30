-- Production schema baseline generated from the archived migration lineage.
-- Historical data backfills, cleanup updates/deletes, and superseded function
-- definitions are intentionally excluded; static data lives in 0002.

create extension if not exists pgcrypto;


-- -----------------------------------------------------------------------------
-- Derived from 001_initial_schema.sql
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_listing_id text,
  url text not null,
  canonical_url text,
  title text not null,
  description text,
  price integer,
  sqm integer,
  price_per_sqm integer,
  rooms numeric,
  floor text,
  zone text,
  address_raw text,
  seller_type text not null check (seller_type in ('private', 'agency', 'unknown')),
  seller_name text,
  phone text,
  portal_declared_date timestamptz,
  metadata_date_published timestamptz,
  metadata_date_modified timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text default 'new',
  priority_score integer default 0,
  seller_fatigue_score integer default 0,
  duplicate_group_id uuid,
  is_price_dropped boolean default false,
  is_new_today boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index listings_source_listing_id_unique_idx
  on public.listings (source, source_listing_id)
  where source_listing_id is not null;

create unique index listings_source_url_unique_idx
  on public.listings (source, url);

create index listings_priority_score_idx on public.listings (priority_score desc);
create index listings_last_seen_at_idx on public.listings (last_seen_at desc);
create index listings_status_idx on public.listings (status);
create index listings_seller_type_idx on public.listings (seller_type);

create trigger set_listings_updated_at
before update on public.listings
for each row
execute function public.set_updated_at();

create table public.listing_snapshots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  checked_at timestamptz not null default now(),
  source text not null,
  url text not null,
  price integer,
  title text,
  description_hash text,
  is_available boolean default true,
  raw_payload jsonb,
  created_at timestamptz default now()
);

create index listing_snapshots_listing_id_idx
  on public.listing_snapshots (listing_id, checked_at desc);

create table public.listing_sources (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  source text not null,
  url text not null,
  source_listing_id text,
  seller_name text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  created_at timestamptz default now()
);

create index listing_sources_listing_id_idx on public.listing_sources (listing_id);

create table public.listing_notes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  note text not null,
  created_at timestamptz default now()
);

create index listing_notes_listing_id_idx on public.listing_notes (listing_id, created_at desc);

create table public.listing_actions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  action_type text not null,
  status text default 'pending',
  scheduled_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

create index listing_actions_listing_id_idx on public.listing_actions (listing_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  total_found integer default 0,
  new_count integer default 0,
  private_count integer default 0,
  agency_count integer default 0,
  unknown_count integer default 0,
  price_drops_count integer default 0,
  hot_old_count integer default 0,
  content text,
  created_at timestamptz default now()
);

create index reports_report_date_idx on public.reports (report_date desc);

create table public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text default 'running',
  total_found integer default 0,
  total_inserted integer default 0,
  total_updated integer default 0,
  error_count integer default 0,
  created_at timestamptz default now()
);

create index scrape_runs_started_at_idx on public.scrape_runs (started_at desc);

create table public.scrape_errors (
  id uuid primary key default gen_random_uuid(),
  scrape_run_id uuid not null references public.scrape_runs(id) on delete cascade,
  source text,
  message text not null,
  details jsonb,
  created_at timestamptz default now()
);

create index scrape_errors_scrape_run_id_idx
  on public.scrape_errors (scrape_run_id, created_at desc);

alter table public.listings enable row level security;
alter table public.listing_snapshots enable row level security;
alter table public.listing_sources enable row level security;
alter table public.listing_notes enable row level security;
alter table public.listing_actions enable row level security;
alter table public.reports enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.scrape_errors enable row level security;

create policy "authenticated select listings"
  on public.listings
  for select
  to authenticated
  using (true);

create policy "authenticated insert listings"
  on public.listings
  for insert
  to authenticated
  with check (true);

create policy "authenticated update listings"
  on public.listings
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete listings"
  on public.listings
  for delete
  to authenticated
  using (true);

create policy "authenticated select listing_snapshots"
  on public.listing_snapshots
  for select
  to authenticated
  using (true);

create policy "authenticated insert listing_snapshots"
  on public.listing_snapshots
  for insert
  to authenticated
  with check (true);

create policy "authenticated update listing_snapshots"
  on public.listing_snapshots
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete listing_snapshots"
  on public.listing_snapshots
  for delete
  to authenticated
  using (true);

create policy "authenticated select listing_sources"
  on public.listing_sources
  for select
  to authenticated
  using (true);

create policy "authenticated insert listing_sources"
  on public.listing_sources
  for insert
  to authenticated
  with check (true);

create policy "authenticated update listing_sources"
  on public.listing_sources
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete listing_sources"
  on public.listing_sources
  for delete
  to authenticated
  using (true);

create policy "authenticated select listing_notes"
  on public.listing_notes
  for select
  to authenticated
  using (true);

create policy "authenticated insert listing_notes"
  on public.listing_notes
  for insert
  to authenticated
  with check (true);

create policy "authenticated update listing_notes"
  on public.listing_notes
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete listing_notes"
  on public.listing_notes
  for delete
  to authenticated
  using (true);

create policy "authenticated select listing_actions"
  on public.listing_actions
  for select
  to authenticated
  using (true);

create policy "authenticated insert listing_actions"
  on public.listing_actions
  for insert
  to authenticated
  with check (true);

create policy "authenticated update listing_actions"
  on public.listing_actions
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete listing_actions"
  on public.listing_actions
  for delete
  to authenticated
  using (true);

create policy "authenticated select reports"
  on public.reports
  for select
  to authenticated
  using (true);

create policy "authenticated insert reports"
  on public.reports
  for insert
  to authenticated
  with check (true);

create policy "authenticated update reports"
  on public.reports
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete reports"
  on public.reports
  for delete
  to authenticated
  using (true);

create policy "authenticated select scrape_runs"
  on public.scrape_runs
  for select
  to authenticated
  using (true);

create policy "authenticated insert scrape_runs"
  on public.scrape_runs
  for insert
  to authenticated
  with check (true);

create policy "authenticated update scrape_runs"
  on public.scrape_runs
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete scrape_runs"
  on public.scrape_runs
  for delete
  to authenticated
  using (true);

create policy "authenticated select scrape_errors"
  on public.scrape_errors
  for select
  to authenticated
  using (true);

create policy "authenticated insert scrape_errors"
  on public.scrape_errors
  for insert
  to authenticated
  with check (true);

create policy "authenticated update scrape_errors"
  on public.scrape_errors
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete scrape_errors"
  on public.scrape_errors
  for delete
  to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Derived from 002_incoming_listings.sql
-- -----------------------------------------------------------------------------
create table public.incoming_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_listing_id text,
  url text not null,
  canonical_url text,
  title text not null,
  description text,
  price integer,
  sqm integer,
  rooms numeric,
  zone text,
  image_url text,
  email_message_id text,
  email_subject text,
  email_sender text,
  email_received_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'enriched', 'dismissed', 'error')),
  listing_id uuid references public.listings(id) on delete set null,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index incoming_listings_message_url_unique_idx
  on public.incoming_listings (email_message_id, canonical_url)
  where email_message_id is not null and canonical_url is not null;

create unique index incoming_listings_source_id_unique_idx
  on public.incoming_listings (source, source_listing_id)
  where source_listing_id is not null;

create index incoming_listings_status_received_idx
  on public.incoming_listings (status, email_received_at desc);

create trigger set_incoming_listings_updated_at
before update on public.incoming_listings
for each row
execute function public.set_updated_at();

create table public.email_ingestion_messages (
  message_id text primary key,
  sender text,
  subject text,
  received_at timestamptz,
  status text not null default 'processed'
    check (status in ('processed', 'ignored', 'error')),
  listings_found integer not null default 0,
  error_message text,
  processed_at timestamptz not null default now()
);

create index email_ingestion_messages_processed_at_idx
  on public.email_ingestion_messages (processed_at desc);

alter table public.incoming_listings enable row level security;
alter table public.email_ingestion_messages enable row level security;

create policy "authenticated select incoming_listings"
  on public.incoming_listings
  for select
  to authenticated
  using (true);

create policy "authenticated insert incoming_listings"
  on public.incoming_listings
  for insert
  to authenticated
  with check (true);

create policy "authenticated update incoming_listings"
  on public.incoming_listings
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete incoming_listings"
  on public.incoming_listings
  for delete
  to authenticated
  using (true);

create policy "authenticated select email_ingestion_messages"
  on public.email_ingestion_messages
  for select
  to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Derived from 0021_map_zones.sql
-- -----------------------------------------------------------------------------
-- Migration version normalized from duplicate 002 prefix; SQL preserved.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists agents_name_unique_idx
  on public.agents (lower(name));


create table if not exists public.map_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agent_id uuid references public.agents(id) on delete set null,
  color text,
  geometry jsonb not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'to_recheck')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists map_areas_agent_id_idx on public.map_areas (agent_id);
create index if not exists map_areas_status_idx on public.map_areas (status);
create index if not exists map_areas_created_at_idx on public.map_areas (created_at desc);

create table if not exists public.map_streets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agent_id uuid references public.agents(id) on delete set null,
  area_id uuid references public.map_areas(id) on delete set null,
  geometry jsonb,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'to_recheck', 'not_useful')),
  last_completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists map_streets_agent_id_idx on public.map_streets (agent_id);
create index if not exists map_streets_area_id_idx on public.map_streets (area_id);
create index if not exists map_streets_status_idx on public.map_streets (status);
create index if not exists map_streets_created_at_idx on public.map_streets (created_at desc);

create table if not exists public.map_pins (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (
      category in (
        'sale_lead',
        'empty_house',
        'follow_up',
        'useful_doorman',
        'useful_administrator',
        'owner_met',
        'door_knocked',
        'interesting_building',
        'not_interested',
        'recheck',
        'rental_lead',
        'future_sale',
        'other'
      )
    ),
  status text not null default 'new'
    check (status in ('new', 'to_verify', 'hot', 'contacted', 'follow_up', 'closed', 'discarded')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  agent_id uuid references public.agents(id) on delete set null,
  area_id uuid references public.map_areas(id) on delete set null,
  street_id uuid references public.map_streets(id) on delete set null,
  listing_id uuid references public.listings(id) on delete set null,
  latitude numeric not null,
  longitude numeric not null,
  address_raw text,
  notes text,
  follow_up_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists map_pins_agent_id_idx on public.map_pins (agent_id);
create index if not exists map_pins_area_id_idx on public.map_pins (area_id);
create index if not exists map_pins_street_id_idx on public.map_pins (street_id);
create index if not exists map_pins_listing_id_idx on public.map_pins (listing_id);
create index if not exists map_pins_status_idx on public.map_pins (status);
create index if not exists map_pins_category_idx on public.map_pins (category);
create index if not exists map_pins_priority_idx on public.map_pins (priority);
create index if not exists map_pins_follow_up_at_idx on public.map_pins (follow_up_at);
create index if not exists map_pins_created_at_idx on public.map_pins (created_at desc);

create table if not exists public.map_activity_logs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete set null,
  area_id uuid references public.map_areas(id) on delete set null,
  street_id uuid references public.map_streets(id) on delete set null,
  pin_id uuid references public.map_pins(id) on delete set null,
  action_type text not null,
  notes text,
  created_at timestamptz default now()
);

create index if not exists map_activity_logs_agent_id_idx on public.map_activity_logs (agent_id);
create index if not exists map_activity_logs_area_id_idx on public.map_activity_logs (area_id);
create index if not exists map_activity_logs_street_id_idx on public.map_activity_logs (street_id);
create index if not exists map_activity_logs_pin_id_idx on public.map_activity_logs (pin_id);
create index if not exists map_activity_logs_created_at_idx on public.map_activity_logs (created_at desc);

drop trigger if exists set_agents_updated_at on public.agents;
create trigger set_agents_updated_at
before update on public.agents
for each row
execute function public.set_updated_at();

drop trigger if exists set_map_areas_updated_at on public.map_areas;
create trigger set_map_areas_updated_at
before update on public.map_areas
for each row
execute function public.set_updated_at();

drop trigger if exists set_map_streets_updated_at on public.map_streets;
create trigger set_map_streets_updated_at
before update on public.map_streets
for each row
execute function public.set_updated_at();

drop trigger if exists set_map_pins_updated_at on public.map_pins;
create trigger set_map_pins_updated_at
before update on public.map_pins
for each row
execute function public.set_updated_at();

alter table public.agents enable row level security;
alter table public.map_areas enable row level security;
alter table public.map_streets enable row level security;
alter table public.map_pins enable row level security;
alter table public.map_activity_logs enable row level security;

drop policy if exists "authenticated select agents" on public.agents;
create policy "authenticated select agents"
  on public.agents
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert agents" on public.agents;
create policy "authenticated insert agents"
  on public.agents
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update agents" on public.agents;
create policy "authenticated update agents"
  on public.agents
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete agents" on public.agents;
create policy "authenticated delete agents"
  on public.agents
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_areas" on public.map_areas;
create policy "authenticated select map_areas"
  on public.map_areas
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_areas" on public.map_areas;
create policy "authenticated insert map_areas"
  on public.map_areas
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_areas" on public.map_areas;
create policy "authenticated update map_areas"
  on public.map_areas
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_areas" on public.map_areas;
create policy "authenticated delete map_areas"
  on public.map_areas
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_streets" on public.map_streets;
create policy "authenticated select map_streets"
  on public.map_streets
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_streets" on public.map_streets;
create policy "authenticated insert map_streets"
  on public.map_streets
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_streets" on public.map_streets;
create policy "authenticated update map_streets"
  on public.map_streets
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_streets" on public.map_streets;
create policy "authenticated delete map_streets"
  on public.map_streets
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_pins" on public.map_pins;
create policy "authenticated select map_pins"
  on public.map_pins
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_pins" on public.map_pins;
create policy "authenticated insert map_pins"
  on public.map_pins
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_pins" on public.map_pins;
create policy "authenticated update map_pins"
  on public.map_pins
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_pins" on public.map_pins;
create policy "authenticated delete map_pins"
  on public.map_pins
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_activity_logs" on public.map_activity_logs;
create policy "authenticated select map_activity_logs"
  on public.map_activity_logs
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_activity_logs" on public.map_activity_logs;
create policy "authenticated insert map_activity_logs"
  on public.map_activity_logs
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_activity_logs" on public.map_activity_logs;
create policy "authenticated update map_activity_logs"
  on public.map_activity_logs
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_activity_logs" on public.map_activity_logs;
create policy "authenticated delete map_activity_logs"
  on public.map_activity_logs
  for delete
  to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Derived from 003_app_settings.sql
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger set_app_settings_updated_at
before update on public.app_settings
for each row
execute function public.set_updated_at();

alter table public.app_settings enable row level security;

create policy "authenticated select app_settings"
  on public.app_settings
  for select
  to authenticated
  using (true);

create policy "authenticated insert app_settings"
  on public.app_settings
  for insert
  to authenticated
  with check (true);

create policy "authenticated update app_settings"
  on public.app_settings
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete app_settings"
  on public.app_settings
  for delete
  to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Derived from 0031_property_worker.sql
-- -----------------------------------------------------------------------------
-- Migration version normalized from duplicate 003 prefix; SQL preserved.
-- Property Data Worker: persistent queue, normalized cadastral data and audit log.
-- The local worker uses the service role; the web UI uses the authenticated policies below.

create table if not exists public.property_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('assisted', 'automatic')),
  status text not null default 'ready' check (status in (
    'ready', 'running', 'needs_review', 'session_expired', 'portal_error',
    'data_incomplete', 'failed', 'paused', 'completed'
  )),
  current_step text not null default 'ready',
  last_completed_step text,
  municipality text,
  street text,
  civic_number text,
  sister_source_url text,
  total_properties integer not null default 0 check (total_properties >= 0),
  processed_properties integer not null default 0 check (processed_properties >= 0),
  total_people integer not null default 0 check (total_people >= 0),
  processed_people integer not null default 0 check (processed_people >= 0),
  error_message text,
  error_details jsonb,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.property_worker_properties (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  municipality text not null,
  sheet text not null,
  parcel text not null,
  subaltern text not null,
  cadastral_key text not null,
  address text,
  census_zone text,
  category text,
  class text,
  consistency text,
  cadastral_income numeric,
  raw_payload jsonb,
  processing_status text not null default 'pending',
  crm_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists property_worker_properties_cadastral_unique_idx
  on public.property_worker_properties (municipality, sheet, parcel, subaltern);
create index if not exists property_worker_properties_job_idx
  on public.property_worker_properties (job_id, created_at);

create table if not exists public.property_worker_people (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  full_name text not null,
  birth_place text,
  birth_province text,
  birth_date date,
  tax_code text,
  right_type text,
  share_original text,
  share_numerator numeric,
  share_denominator numeric,
  share_percentage numeric,
  mobiles jsonb not null default '[]'::jsonb,
  landlines jsonb not null default '[]'::jsonb,
  emails jsonb not null default '[]'::jsonb,
  raw_payload jsonb,
  processing_status text not null default 'pending',
  crm_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_worker_people_job_idx
  on public.property_worker_people (job_id, created_at);
create index if not exists property_worker_people_tax_code_idx
  on public.property_worker_people (tax_code) where tax_code is not null;

create table if not exists public.property_worker_ownerships (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.property_worker_properties(id) on delete cascade,
  person_id uuid not null references public.property_worker_people(id) on delete cascade,
  right_type text not null default 'Proprietà',
  share_percentage numeric,
  crm_link_id text,
  processing_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists property_worker_ownerships_property_person_unique_idx
  on public.property_worker_ownerships (property_id, person_id);

create table if not exists public.property_worker_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  property_id uuid references public.property_worker_properties(id) on delete cascade,
  person_id uuid references public.property_worker_people(id) on delete cascade,
  step_name text not null,
  status text not null,
  input_data jsonb,
  output_data jsonb,
  error_message text,
  screenshot_path text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists property_worker_steps_job_idx
  on public.property_worker_steps (job_id, created_at desc);

create table if not exists public.property_worker_change_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  entity_type text not null,
  entity_identifier text not null,
  field_name text not null,
  old_value text,
  new_value text,
  source text not null default 'SISTER',
  created_at timestamptz not null default now()
);

create index if not exists property_worker_change_logs_job_idx
  on public.property_worker_change_logs (job_id, created_at desc);

drop trigger if exists set_property_worker_jobs_updated_at on public.property_worker_jobs;
create trigger set_property_worker_jobs_updated_at before update on public.property_worker_jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_property_worker_properties_updated_at on public.property_worker_properties;
create trigger set_property_worker_properties_updated_at before update on public.property_worker_properties
for each row execute function public.set_updated_at();

drop trigger if exists set_property_worker_people_updated_at on public.property_worker_people;
create trigger set_property_worker_people_updated_at before update on public.property_worker_people
for each row execute function public.set_updated_at();

drop trigger if exists set_property_worker_ownerships_updated_at on public.property_worker_ownerships;
create trigger set_property_worker_ownerships_updated_at before update on public.property_worker_ownerships
for each row execute function public.set_updated_at();

alter table public.property_worker_jobs enable row level security;
alter table public.property_worker_properties enable row level security;
alter table public.property_worker_people enable row level security;
alter table public.property_worker_ownerships enable row level security;
alter table public.property_worker_steps enable row level security;
alter table public.property_worker_change_logs enable row level security;

do $$
declare
  table_name text;
  operation text;
begin
  foreach table_name in array array[
    'property_worker_jobs', 'property_worker_properties', 'property_worker_people',
    'property_worker_ownerships', 'property_worker_steps', 'property_worker_change_logs'
  ] loop
    foreach operation in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I',
        'authenticated ' || operation || ' ' || table_name, table_name);
      if operation = 'insert' then
        execute format('create policy %I on public.%I for insert to authenticated with check (true)',
          'authenticated insert ' || table_name, table_name);
      elsif operation = 'update' then
        execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)',
          'authenticated update ' || table_name, table_name);
      else
        execute format('create policy %I on public.%I for %s to authenticated using (true)',
          'authenticated ' || operation || ' ' || table_name, table_name, operation);
      end if;
    end loop;
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- Derived from 004_listing_crm_status.sql
-- -----------------------------------------------------------------------------
alter table public.listings
  add column if not exists crm_status text not null default 'untreated'
  check (crm_status in ('untreated', 'treated'));

create index if not exists listings_crm_status_idx
  on public.listings (crm_status);


-- -----------------------------------------------------------------------------
-- Derived from 0041_requests_matching.sql
-- -----------------------------------------------------------------------------
-- Migration version normalized from duplicate 004 prefix; SQL preserved.
-- Richieste, portafoglio e matching. Applicare dopo le migration esistenti.
create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text,
  email text,
  notes text,
  external_crm_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.internal_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  landmarks jsonb not null default '[]'::jsonb,
  aliases jsonb not null default '[]'::jsonb,
  associated_streets jsonb not null default '[]'::jsonb,
  map_area_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  title text,
  contract_type text not null check (contract_type in ('sale', 'rent')),
  property_types jsonb not null default '[]'::jsonb,
  municipality text default 'Bitonto',
  status text not null default 'draft' check (status in ('draft','active','urgent','suspended','satisfied','cancelled','archived')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  budget_ideal numeric,
  budget_max numeric,
  monthly_rent_ideal numeric,
  monthly_rent_max numeric,
  internal_sqm_min numeric,
  internal_sqm_ideal numeric,
  internal_sqm_max numeric,
  commercial_sqm_estimated_min numeric,
  commercial_sqm_estimated_max numeric,
  rooms_min numeric,
  rooms_ideal numeric,
  rooms_max numeric,
  bedrooms_min numeric,
  bathrooms_min numeric,
  floor_min integer,
  floor_max integer,
  building_floors_max integer,
  accepted_conditions jsonb not null default '[]'::jsonb,
  availability_requirement text,
  available_by date,
  notes text,
  external_crm_id text,
  source text default 'manual',
  last_imported_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  contract_type text not null check (contract_type in ('sale', 'rent')),
  property_type text not null,
  municipality text default 'Bitonto',
  address text,
  internal_zone_id uuid references public.internal_zones(id) on delete set null,
  price numeric,
  monthly_rent numeric,
  internal_sqm numeric,
  commercial_sqm numeric,
  rooms numeric,
  bedrooms numeric,
  bathrooms numeric,
  floor integer,
  building_floors integer,
  condition text,
  availability_status text,
  available_from date,
  description text,
  notes text,
  external_crm_id text,
  source text default 'manual',
  last_imported_at timestamptz,
  mandate_status text not null default 'active' check (mandate_status in ('draft','active','suspended','expired','sold','rented','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_zones (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.property_requests(id) on delete cascade,
  zone_id uuid not null references public.internal_zones(id) on delete cascade,
  preference_level text not null check (preference_level in ('required','preferred','accepted','excluded')),
  created_at timestamptz not null default now(),
  unique (request_id, zone_id)
);

create table if not exists public.feature_definitions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  category text not null,
  field_type text not null check (field_type in ('boolean','number','range','select','multiselect','text')),
  applies_to text not null default 'both' check (applies_to in ('request','property','both')),
  allowed_values jsonb,
  default_weight numeric not null default 5,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_feature_preferences (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.property_requests(id) on delete cascade,
  feature_definition_id uuid not null references public.feature_definitions(id) on delete cascade,
  preference_level text not null check (preference_level in ('required','preferred','indifferent','avoid')),
  desired_value jsonb,
  custom_weight numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, feature_definition_id)
);

create table if not exists public.property_feature_values (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  feature_definition_id uuid not null references public.feature_definitions(id) on delete cascade,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, feature_definition_id)
);

create table if not exists public.request_property_matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.property_requests(id) on delete cascade,
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  score numeric not null default 0 check (score >= 0 and score <= 100),
  classification text not null check (classification in ('compatible','almost_compatible','weak','not_relevant')),
  matched_criteria jsonb not null default '[]'::jsonb,
  missing_preferences jsonb not null default '[]'::jsonb,
  conflicting_criteria jsonb not null default '[]'::jsonb,
  explanation text,
  status text not null default 'new' check (status in ('new','to_propose','proposed','interested','visit_scheduled','not_interested','excluded','negotiation','completed')),
  last_calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, property_id)
);

create table if not exists public.matching_activity_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists property_requests_status_idx on public.property_requests(status);
create index if not exists portfolio_properties_status_idx on public.portfolio_properties(mandate_status);
create index if not exists request_matches_request_score_idx on public.request_property_matches(request_id, score desc);
create index if not exists request_matches_property_score_idx on public.request_property_matches(property_id, score desc);
create index if not exists matching_activity_entity_idx on public.matching_activity_logs(entity_type, entity_id, created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'clients','internal_zones','property_requests','portfolio_properties',
    'feature_definitions','request_feature_preferences','property_feature_values',
    'request_property_matches'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end $$;


do $$
declare table_name text;
begin
  foreach table_name in array array[
    'clients','internal_zones','property_requests','portfolio_properties','request_zones',
    'feature_definitions','request_feature_preferences','property_feature_values',
    'request_property_matches','matching_activity_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "authenticated select %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated insert %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated update %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated delete %s" on public.%I', table_name, table_name);
    execute format('create policy "authenticated select %s" on public.%I for select to authenticated using (true)', table_name, table_name);
    execute format('create policy "authenticated insert %s" on public.%I for insert to authenticated with check (true)', table_name, table_name);
    execute format('create policy "authenticated update %s" on public.%I for update to authenticated using (true) with check (true)', table_name, table_name);
    execute format('create policy "authenticated delete %s" on public.%I for delete to authenticated using (true)', table_name, table_name);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- Derived from 005_listing_coordinates.sql
-- -----------------------------------------------------------------------------
alter table public.listings
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists coordinates_source text;

alter table public.listing_snapshots
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists coordinates_source text;

create index if not exists listings_coordinates_idx
  on public.listings (latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists listing_snapshots_coordinates_idx
  on public.listing_snapshots (latitude, longitude)
  where latitude is not null and longitude is not null;


-- -----------------------------------------------------------------------------
-- Derived from 006_property_worker_archives.sql
-- -----------------------------------------------------------------------------
-- Saved SISTER acquisitions can be imported later without scraping again.

alter table public.property_worker_jobs
  add column if not exists saved_at timestamptz,
  add column if not exists import_started_at timestamptz;

alter table public.property_worker_jobs
  drop constraint if exists property_worker_jobs_status_check;

alter table public.property_worker_jobs
  add constraint property_worker_jobs_status_check check (status in (
    'ready', 'running', 'needs_review', 'session_expired', 'portal_error',
    'data_incomplete', 'failed', 'paused', 'saved', 'completed'
  ));

drop index if exists public.property_worker_properties_cadastral_unique_idx;
create unique index if not exists property_worker_properties_job_cadastral_unique_idx
  on public.property_worker_properties (job_id, municipality, sheet, parcel, subaltern);

create index if not exists property_worker_jobs_saved_at_idx
  on public.property_worker_jobs (saved_at desc) where saved_at is not null;


-- -----------------------------------------------------------------------------
-- Derived from 007_request_real_estate_format.sql
-- -----------------------------------------------------------------------------
-- Allinea il formato delle richieste ai campi realmente usati nel gestionale.
alter table public.property_requests
  add column if not exists destination text,
  add column if not exists financing_method text,
  add column if not exists credit_status text,
  add column if not exists requested_floor_band text,
  add column if not exists from_own_listing boolean not null default false;

alter table public.property_requests
  drop constraint if exists property_requests_destination_check,
  add constraint property_requests_destination_check
    check (destination is null or destination in (
      'first_home', 'investment', 'exchange', 'temporary', 'other'
    )),
  drop constraint if exists property_requests_financing_method_check,
  add constraint property_requests_financing_method_check
    check (financing_method is null or financing_method in (
      'cash', 'cash_and_mortgage', 'full_mortgage', 'exchange', 'other'
    )),
  drop constraint if exists property_requests_credit_status_check,
  add constraint property_requests_credit_status_check
    check (credit_status is null or credit_status in (
      'unknown', 'in_progress', 'positive', 'negative'
    )),
  drop constraint if exists property_requests_requested_floor_band_check,
  add constraint property_requests_requested_floor_band_check
    check (requested_floor_band is null or requested_floor_band in (
      'any', 'low', 'medium', 'high', 'top'
    ));


-- -----------------------------------------------------------------------------
-- Derived from 008_crm_request_archive_import.sql
-- -----------------------------------------------------------------------------
-- Import completo e riprendibile dell'archivio richieste dal CRM.
alter table public.clients
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

alter table public.property_requests
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

create unique index if not exists clients_external_crm_id_unique
  on public.clients (external_crm_id) where external_crm_id is not null;
create unique index if not exists property_requests_external_crm_id_unique
  on public.property_requests (external_crm_id) where external_crm_id is not null;

create table if not exists public.crm_request_import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','failed','cancelled')),
  source_url text not null,
  total_requests integer not null default 0,
  processed_requests integer not null default 0,
  failed_requests integer not null default 0,
  current_external_id text,
  current_title text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_request_import_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.crm_request_import_runs(id) on delete cascade,
  external_crm_id text not null,
  source_url text not null,
  title text,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  list_payload jsonb not null default '{}'::jsonb,
  detail_payload jsonb,
  imported_request_id uuid references public.property_requests(id) on delete set null,
  error_message text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, external_crm_id)
);

create index if not exists crm_request_import_runs_status_idx
  on public.crm_request_import_runs (status, updated_at desc);
create index if not exists crm_request_import_items_run_status_idx
  on public.crm_request_import_items (run_id, status, created_at);

drop trigger if exists set_clients_updated_at on public.clients;
create trigger set_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
drop trigger if exists set_property_requests_updated_at on public.property_requests;
create trigger set_property_requests_updated_at before update on public.property_requests
  for each row execute function public.set_updated_at();
drop trigger if exists set_crm_request_import_runs_updated_at on public.crm_request_import_runs;
create trigger set_crm_request_import_runs_updated_at before update on public.crm_request_import_runs
  for each row execute function public.set_updated_at();
drop trigger if exists set_crm_request_import_items_updated_at on public.crm_request_import_items;
create trigger set_crm_request_import_items_updated_at before update on public.crm_request_import_items
  for each row execute function public.set_updated_at();

alter table public.crm_request_import_runs enable row level security;
alter table public.crm_request_import_items enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['crm_request_import_runs','crm_request_import_items'] loop
    execute format('drop policy if exists "authenticated select %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated insert %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated update %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated delete %s" on public.%I', table_name, table_name);
    execute format('create policy "authenticated select %s" on public.%I for select to authenticated using (true)', table_name, table_name);
    execute format('create policy "authenticated insert %s" on public.%I for insert to authenticated with check (true)', table_name, table_name);
    execute format('create policy "authenticated update %s" on public.%I for update to authenticated using (true) with check (true)', table_name, table_name);
    execute format('create policy "authenticated delete %s" on public.%I for delete to authenticated using (true)', table_name, table_name);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- Derived from 009_zone_geometries_and_property_coordinates.sql
-- -----------------------------------------------------------------------------
-- Abilita la posizione puntuale degli immobili.

alter table public.portfolio_properties
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

create index if not exists portfolio_properties_coordinates_idx
  on public.portfolio_properties (latitude, longitude)
  where latitude is not null and longitude is not null;


-- -----------------------------------------------------------------------------
-- Derived from 010_separate_operational_and_property_zones.sql
-- -----------------------------------------------------------------------------
-- Separa definitivamente:
-- - map_areas: aree operative assegnate agli agenti per ricerca e contatto;
-- - internal_zones: quartieri e zone immobiliari usati da immobili, richieste e matching.

alter table public.internal_zones
  add column if not exists geometry jsonb,
  add column if not exists color text not null default '#5fbf7a';

-- I collegamenti creati in precedenza erano semanticamente errati: un'area di
-- lavoro di un agente non rappresenta il quartiere di un immobile.
alter table public.internal_zones
  drop constraint if exists internal_zones_map_area_id_fkey;

drop index if exists public.internal_zones_map_area_id_idx;

alter table public.internal_zones
  drop column if exists map_area_id;

comment on table public.map_areas is
  'Aree operative assegnate agli agenti per ricerca, chiamate e lavoro sul territorio.';

comment on table public.internal_zones is
  'Zone immobiliari usate per localizzare immobili, preferenze delle richieste e matching.';

comment on column public.internal_zones.geometry is
  'Perimetro GeoJSON della zona immobiliare, indipendente dalle aree operative degli agenti.';


-- -----------------------------------------------------------------------------
-- Derived from 011_crm_mandate_archive_import.sql
-- -----------------------------------------------------------------------------
-- Import completo, aggiornabile e riprendibile degli incarichi/immobili dal CRM.
alter table public.portfolio_properties
  add column if not exists external_mandate_id text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

create unique index if not exists portfolio_properties_external_crm_id_unique
  on public.portfolio_properties (external_crm_id) where external_crm_id is not null;
create unique index if not exists portfolio_properties_external_mandate_id_unique
  on public.portfolio_properties (external_mandate_id) where external_mandate_id is not null;

create table if not exists public.crm_mandate_import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','failed','cancelled')),
  source_url text not null,
  total_mandates integer not null default 0,
  processed_mandates integer not null default 0,
  failed_mandates integer not null default 0,
  current_external_id text,
  current_title text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_mandate_import_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.crm_mandate_import_runs(id) on delete cascade,
  external_crm_id text not null,
  source_url text not null,
  title text,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  list_payload jsonb not null default '{}'::jsonb,
  detail_payload jsonb,
  imported_property_id uuid references public.portfolio_properties(id) on delete set null,
  error_message text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, external_crm_id)
);

create index if not exists crm_mandate_import_runs_status_idx
  on public.crm_mandate_import_runs (status, updated_at desc);
create index if not exists crm_mandate_import_items_run_status_idx
  on public.crm_mandate_import_items (run_id, status, created_at);

drop trigger if exists set_portfolio_properties_updated_at on public.portfolio_properties;
create trigger set_portfolio_properties_updated_at before update on public.portfolio_properties
  for each row execute function public.set_updated_at();
drop trigger if exists set_crm_mandate_import_runs_updated_at on public.crm_mandate_import_runs;
create trigger set_crm_mandate_import_runs_updated_at before update on public.crm_mandate_import_runs
  for each row execute function public.set_updated_at();
drop trigger if exists set_crm_mandate_import_items_updated_at on public.crm_mandate_import_items;
create trigger set_crm_mandate_import_items_updated_at before update on public.crm_mandate_import_items
  for each row execute function public.set_updated_at();

alter table public.crm_mandate_import_runs enable row level security;
alter table public.crm_mandate_import_items enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['crm_mandate_import_runs','crm_mandate_import_items'] loop
    execute format('drop policy if exists "authenticated select %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated insert %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated update %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated delete %s" on public.%I', table_name, table_name);
    execute format('create policy "authenticated select %s" on public.%I for select to authenticated using (true)', table_name, table_name);
    execute format('create policy "authenticated insert %s" on public.%I for insert to authenticated with check (true)', table_name, table_name);
    execute format('create policy "authenticated update %s" on public.%I for update to authenticated using (true) with check (true)', table_name, table_name);
    execute format('create policy "authenticated delete %s" on public.%I for delete to authenticated using (true)', table_name, table_name);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- Derived from 015_listing_identity_and_sources.sql
-- -----------------------------------------------------------------------------
-- One listings row now represents one physical property. Every portal advert
-- remains available in listing_sources and every observation in snapshots.

alter table public.listings
  add column if not exists property_identity_key text,
  add column if not exists identity_confidence numeric,
  add column if not exists identity_reasons jsonb not null default '[]'::jsonb,
  add column if not exists seller_classification_confidence numeric,
  add column if not exists seller_classification_reasons jsonb not null default '[]'::jsonb;

create index if not exists listings_property_identity_key_idx
  on public.listings (property_identity_key)
  where property_identity_key is not null;

alter table public.listing_sources
  add column if not exists canonical_url text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists price integer,
  add column if not exists sqm integer,
  add column if not exists rooms numeric,
  add column if not exists floor text,
  add column if not exists zone text,
  add column if not exists address_raw text,
  add column if not exists seller_type text check (seller_type in ('private', 'agency', 'unknown')),
  add column if not exists phone text,
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists listing_sources_source_external_id_idx
  on public.listing_sources (source, source_listing_id)
  where source_listing_id is not null;

create index if not exists listing_sources_source_url_idx
  on public.listing_sources (source, url);

-- Historical duplicate cleanup intentionally excluded from the production baseline.

create or replace function public.merge_listing_records(
  target_listing_id uuid,
  duplicate_listing_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_listing_id = duplicate_listing_id then
    return;
  end if;

  update public.listing_snapshots set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.listing_sources set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.listing_notes set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.listing_actions set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.incoming_listings set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.map_pins set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;

  delete from public.listings where id = duplicate_listing_id;
end;
$$;

revoke all on function public.merge_listing_records(uuid, uuid) from public;
grant execute on function public.merge_listing_records(uuid, uuid) to service_role;


-- -----------------------------------------------------------------------------
-- Derived from 016_property_lifecycle_v2_foundation.sql
-- -----------------------------------------------------------------------------
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

-- Static agency seed moved to 0002_production_seed.sql.

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


-- -----------------------------------------------------------------------------
-- Derived from 017_property_lifecycle_media_and_intelligence.sql
-- -----------------------------------------------------------------------------
begin;

alter table public.locations
  add column precision_level text not null default 'UNKNOWN'
    check (precision_level in (
      'EXACT_ADDRESS',
      'EXACT_COORDINATES',
      'STREET_ONLY',
      'APPROXIMATE_AREA',
      'UNKNOWN'
    )),
  add column evidence_source text,
  add column manually_verified boolean not null default false,
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users(id) on delete set null;

alter table public.properties
  add column sale_status text not null default 'UNKNOWN'
    check (sale_status in ('UNKNOWN', 'PROBABLE_SOLD', 'SOLD_CONFIRMED', 'NOT_SOLD_CONFIRMED')),
  add column property_state text not null default 'OFF_MARKET_UNKNOWN'
    check (property_state in (
      'ACTIVE_AGENCY',
      'ACTIVE_PRIVATE',
      'ACTIVE_MULTI_AGENCY',
      'ACTIVE_AGENCY_AND_PRIVATE',
      'OFF_MARKET_UNKNOWN',
      'SOLD'
    )),
  add column relaunch_count integer not null default 0 check (relaunch_count >= 0),
  add column first_public_evidence_at timestamptz,
  add column representative_image_paths text[] not null default '{}'::text[];

alter table public.floorplan_fingerprints
  add column width integer check (width is null or width > 0),
  add column height integer check (height is null or height > 0),
  add column source_recorded_at timestamptz;

create index properties_sale_status_idx on public.properties (sale_status, updated_at desc);
create index properties_state_idx on public.properties (property_state, updated_at desc);
create index locations_precision_idx on public.locations (precision_level, manually_verified);

-- Storage bucket seed moved to 0002_production_seed.sql.

create or replace function public.increment_property_relaunch_count(p_property_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.properties
  set relaunch_count = relaunch_count + 1,
      updated_at = now()
  where id = p_property_id
  returning relaunch_count;
$$;

revoke all on function public.increment_property_relaunch_count(uuid)
  from public, anon, authenticated;
grant execute on function public.increment_property_relaunch_count(uuid) to service_role;

comment on column public.locations.precision_level is
  'Explicit location precision; approximate map coordinates must never be promoted to exact.';
comment on column public.properties.relaunch_count is
  'Count of justified publication relaunch events for the durable physical property.';
comment on column public.properties.representative_image_paths is
  'At most two compact private-bucket thumbnails retained for human recognition.';

commit;


-- -----------------------------------------------------------------------------
-- Derived from 018_property_lifecycle_exit_and_opportunities.sql
-- -----------------------------------------------------------------------------
begin;

alter table public.agency_listings
  add column exit_confirmed_at timestamptz,
  add column outcome_source text,
  add column outcome_confidence numeric(5,4)
    check (outcome_confidence is null or outcome_confidence between 0 and 1);

alter table public.opportunities
  add column level text not null default 'NONE'
    check (level in ('NONE', 'WATCH', 'INTERESTING', 'HIGH', 'HOT')),
  add column reasons jsonb not null default '[]'::jsonb;

alter table public.manual_overrides
  add column previous_value jsonb,
  add column source text not null default 'USER',
  add column source_reference text;

create table public.post_exit_checks (
  id uuid primary key default gen_random_uuid(),
  agency_listing_id uuid not null references public.agency_listings(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  job_id uuid references public.lifecycle_jobs(id) on delete set null,
  checked_at timestamptz not null default now(),
  technical_disappearance_confirmed boolean not null default false,
  explicit_sale_evidence boolean not null default false,
  switched_agency_evidence boolean not null default false,
  private_relist_evidence boolean not null default false,
  reappearance_evidence boolean not null default false,
  outcome text not null check (outcome in (
    'CLOSED_SOLD',
    'CLOSED_SWITCHED',
    'CLOSED_TO_PRIVATE',
    'CLOSED_WITHDRAWN',
    'OFF_MARKET_NO_SALE_EVIDENCE',
    'NEEDS_VERIFICATION',
    'REAPPEARED'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index post_exit_checks_agency_listing_idx
  on public.post_exit_checks (agency_listing_id, checked_at desc);
create index post_exit_checks_outcome_idx
  on public.post_exit_checks (outcome, checked_at desc);

create trigger prevent_post_exit_checks_mutation
  before update or delete on public.post_exit_checks
  for each row execute function public.prevent_property_lifecycle_history_mutation();

alter table public.post_exit_checks enable row level security;
grant select on table public.post_exit_checks to authenticated;
grant select, insert, update, delete on table public.post_exit_checks to service_role;

create policy "authenticated read post_exit_checks"
  on public.post_exit_checks
  for select
  to authenticated
  using (true);

create index opportunities_level_idx
  on public.opportunities (level, status, score desc, detected_at desc);

comment on table public.post_exit_checks is
  'Append-only evidence ledger for confirmed agency exits and their classified outcomes.';
comment on column public.opportunities.level is
  'Transparent V1 acquisition priority: NONE, WATCH, INTERESTING, HIGH, or HOT.';

commit;


-- -----------------------------------------------------------------------------
-- Derived from 027_property_lifecycle_building_intelligence.sql
-- -----------------------------------------------------------------------------
begin;

create table public.building_data_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_url text,
  source_etag text,
  source_last_modified text,
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input_rows integer not null default 0 check (input_rows >= 0),
  eligible_rows integer not null default 0 check (eligible_rows >= 0),
  grouped_records integer not null default 0 check (grouped_records >= 0),
  inserted_records integer not null default 0 check (inserted_records >= 0),
  updated_records integer not null default 0 check (updated_records >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  unmatched_records integer not null default 0 check (unmatched_records >= 0),
  building_links integer not null default 0 check (building_links >= 0),
  event_count integer not null default 0 check (event_count >= 0),
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index building_data_import_runs_source_idx
  on public.building_data_import_runs (source_key, started_at desc);

create table public.building_practice_records (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_record_key text not null,
  application_code text not null,
  practice_number text,
  protocol_number text,
  practice_year text,
  practice_type text,
  practice_status text,
  intervention_type text not null check (intervention_type in (
    'MANUTENZIONE_STRAORDINARIA',
    'FRAZIONAMENTO',
    'FUSIONE_ACCOPPIAMENTO',
    'CAMBIO_DESTINAZIONE_USO',
    'AGIBILITA',
    'AMPLIAMENTO',
    'RISTRUTTURAZIONE',
    'NUOVA_COSTRUZIONE',
    'FINE_LAVORI',
    'OTHER'
  )),
  occurred_at timestamptz,
  source_url text,
  content_hash text not null,
  sanitized_payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, source_record_key)
);

create index building_practice_records_event_idx
  on public.building_practice_records (intervention_type, occurred_at desc);
create index building_practice_records_application_idx
  on public.building_practice_records (application_code, practice_year);

create table public.building_practice_observations (
  id uuid primary key default gen_random_uuid(),
  practice_record_id uuid not null
    references public.building_practice_records(id) on delete restrict,
  import_run_id uuid not null
    references public.building_data_import_runs(id) on delete restrict,
  content_hash text not null,
  sanitized_payload jsonb not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (practice_record_id, content_hash)
);

create index building_practice_observations_record_idx
  on public.building_practice_observations (practice_record_id, observed_at desc);

create table public.building_practice_buildings (
  practice_record_id uuid not null
    references public.building_practice_records(id) on delete restrict,
  building_id uuid not null references public.buildings(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (practice_record_id, building_id)
);

create index building_practice_buildings_building_idx
  on public.building_practice_buildings (building_id, last_seen_at desc);

create trigger set_building_data_import_runs_updated_at
  before update on public.building_data_import_runs
  for each row execute function public.set_updated_at();
create trigger set_building_practice_records_updated_at
  before update on public.building_practice_records
  for each row execute function public.set_updated_at();

create trigger prevent_building_practice_observations_mutation
  before update or delete on public.building_practice_observations
  for each row execute function public.prevent_property_lifecycle_history_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'building_data_import_runs',
    'building_practice_records',
    'building_practice_observations',
    'building_practice_buildings'
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

comment on table public.building_practice_records is
  'Sanitized, deduplicated municipal building-practice records; direct personal fields are excluded.';
comment on table public.building_practice_observations is
  'Append-only content versions observed during incremental public-dataset imports.';
comment on table public.building_practice_buildings is
  'Civic-level associations only; property-level association requires separate unit evidence.';

commit;


-- -----------------------------------------------------------------------------
-- Derived from 028_property_lifecycle_private_radar.sql
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- Derived from 029_property_lifecycle_hardening_state.sql
-- -----------------------------------------------------------------------------
begin;

alter table public.sync_runs
  add column observation_commit_count integer not null default 0
    check (observation_commit_count >= 0),
  add column observation_failure_count integer not null default 0
    check (observation_failure_count >= 0);

create table public.adapter_health_baselines (
  agency_id uuid primary key references public.agencies(id) on delete restrict,
  successful_run_count integer not null default 0 check (successful_run_count >= 0),
  recent_inventory_counts integer[] not null default '{}'::integer[],
  rolling_median numeric,
  variability numeric check (variability is null or variability >= 0),
  schema_fingerprint text,
  schema_version integer not null default 0 check (schema_version >= 0),
  pending_schema_fingerprint text,
  pending_schema_run_count integer not null default 0
    check (pending_schema_run_count >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  consecutive_healthy_runs integer not null default 0
    check (consecutive_healthy_runs >= 0),
  last_success_at timestamptz,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.adapter_health_baselines enable row level security;
grant select on table public.adapter_health_baselines to authenticated;
grant select, insert, update, delete on table public.adapter_health_baselines to service_role;

create policy "authenticated read adapter health baselines"
  on public.adapter_health_baselines
  for select
  to authenticated
  using (true);

alter table public.agency_listings
  add column monitoring_phase text not null default 'NONE'
    check (monitoring_phase in ('NONE', 'WAITING_CONFIRMATION', 'EVIDENCE_REVIEW', 'COMPLETE')),
  add column post_exit_check_due_at timestamptz,
  add column next_check_at timestamptz,
  add column check_attempt integer not null default 0 check (check_attempt >= 0),
  add column last_check_at timestamptz,
  add constraint agency_listings_post_exit_schedule_check check (
    (monitoring_phase in ('NONE', 'COMPLETE') and next_check_at is null)
    or (monitoring_phase in ('WAITING_CONFIRMATION', 'EVIDENCE_REVIEW') and next_check_at is not null)
  );

create index agency_listings_post_exit_due_idx
  on public.agency_listings (next_check_at, monitoring_phase)
  where monitoring_phase in ('WAITING_CONFIRMATION', 'EVIDENCE_REVIEW');

create unique index post_exit_checks_job_unique_idx
  on public.post_exit_checks (job_id)
  where job_id is not null;

create or replace function public.record_adapter_health_observation(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_state text,
  p_observed_count integer,
  p_expected_count integer,
  p_parse_error_count integer,
  p_structure_fingerprint text,
  p_reasons jsonb,
  p_diagnostics jsonb,
  p_response_status integer,
  p_baseline jsonb,
  p_observed_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('HEALTHY', 'DEGRADED', 'FAILED', 'STRUCTURE_CHANGED') then
    raise exception 'Invalid adapter health state %', p_state;
  end if;

  insert into public.adapter_health (
    agency_id,
    sync_run_id,
    state,
    checked_at,
    response_status,
    observed_count,
    expected_count,
    parse_error_count,
    structure_fingerprint,
    reasons,
    diagnostics
  ) values (
    p_agency_id,
    p_sync_run_id,
    p_state,
    p_observed_at,
    p_response_status,
    p_observed_count,
    p_expected_count,
    p_parse_error_count,
    p_structure_fingerprint,
    coalesce(p_reasons, '[]'::jsonb),
    coalesce(p_diagnostics, '{}'::jsonb) || jsonb_build_object('baseline', p_baseline)
  );

  insert into public.adapter_health_baselines (
    agency_id,
    successful_run_count,
    recent_inventory_counts,
    rolling_median,
    variability,
    schema_fingerprint,
    schema_version,
    pending_schema_fingerprint,
    pending_schema_run_count,
    consecutive_failures,
    consecutive_healthy_runs,
    last_success_at,
    last_observed_at,
    updated_at
  ) values (
    p_agency_id,
    coalesce((p_baseline->>'successfulRunCount')::integer, 0),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p_baseline->'recentInventoryCounts', '[]'::jsonb))::integer),
      '{}'::integer[]
    ),
    (p_baseline->>'rollingMedian')::numeric,
    (p_baseline->>'variability')::numeric,
    p_baseline->>'schemaFingerprint',
    coalesce((p_baseline->>'schemaVersion')::integer, 0),
    p_baseline->>'pendingSchemaFingerprint',
    coalesce((p_baseline->>'pendingSchemaRunCount')::integer, 0),
    coalesce((p_baseline->>'consecutiveFailures')::integer, 0),
    coalesce((p_baseline->>'consecutiveHealthyRuns')::integer, 0),
    case when p_state = 'HEALTHY' then p_observed_at else null end,
    p_observed_at,
    now()
  )
  on conflict (agency_id) do update set
    successful_run_count = excluded.successful_run_count,
    recent_inventory_counts = excluded.recent_inventory_counts,
    rolling_median = excluded.rolling_median,
    variability = excluded.variability,
    schema_fingerprint = excluded.schema_fingerprint,
    schema_version = excluded.schema_version,
    pending_schema_fingerprint = excluded.pending_schema_fingerprint,
    pending_schema_run_count = excluded.pending_schema_run_count,
    consecutive_failures = excluded.consecutive_failures,
    consecutive_healthy_runs = excluded.consecutive_healthy_runs,
    last_success_at = case
      when p_state = 'HEALTHY' then p_observed_at
      else adapter_health_baselines.last_success_at
    end,
    last_observed_at = excluded.last_observed_at,
    updated_at = now();
end;
$$;

create or replace function public.record_observation_commit_failure(p_sync_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sync_runs
  set observation_failure_count = observation_failure_count + 1
  where id = p_sync_run_id;
$$;

create or replace function public.refresh_property_lifecycle_intelligence_atomic(
  p_property_id uuid,
  p_as_of timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property record;
  v_active_agencies integer;
  v_active_private boolean;
  v_property_state text;
  v_price_drops integer;
  v_age_days integer;
  v_best_state text;
  v_level text;
  v_score numeric;
  v_reasons jsonb;
begin
  select * into strict v_property
  from public.properties
  where id = p_property_id
  for update;

  select count(distinct agency_id) into v_active_agencies
  from public.agency_listings
  where property_id = p_property_id and state = 'ACTIVE';

  select exists(
    select 1 from public.private_publications
    where property_id = p_property_id and state = 'ACTIVE'
  ) into v_active_private;

  v_property_state := case
    when v_property.sale_status = 'SOLD_CONFIRMED' and v_active_agencies = 0 and not v_active_private then 'SOLD'
    when v_active_agencies > 1 and v_active_private then 'ACTIVE_AGENCY_AND_PRIVATE'
    when v_active_agencies > 1 then 'ACTIVE_MULTI_AGENCY'
    when v_active_agencies = 1 and v_active_private then 'ACTIVE_AGENCY_AND_PRIVATE'
    when v_active_agencies = 1 then 'ACTIVE_AGENCY'
    when v_active_private then 'ACTIVE_PRIVATE'
    else 'OFF_MARKET_UNKNOWN'
  end;

  update public.properties
  set property_state = v_property_state, updated_at = now()
  where id = p_property_id;

  select count(*) into v_price_drops
  from public.events
  where property_id = p_property_id and event_type = 'PRICE_DROP';

  if v_property.true_market_start_upper_bound is not null then
    v_age_days := greatest(0, floor(extract(epoch from (p_as_of - v_property.true_market_start_upper_bound)) / 86400)::integer);
  else
    v_age_days := null;
  end if;

  select state into v_best_state
  from public.agency_listings
  where property_id = p_property_id
  order by case state
    when 'CLOSED_SOLD' then 6
    when 'CLOSED_TO_PRIVATE' then 5
    when 'OFF_MARKET_NO_SALE_EVIDENCE' then 4
    when 'CLOSED_SWITCHED' then 3
    when 'EXIT_PENDING' then 2
    else 1
  end desc
  limit 1;

  if v_property.sale_status = 'SOLD_CONFIRMED' or v_best_state = 'CLOSED_SOLD' then
    v_level := 'NONE'; v_score := 0; v_reasons := '["sold_confirmed"]'::jsonb;
  elsif v_best_state = 'CLOSED_TO_PRIVATE' then
    v_level := 'HOT'; v_score := 100; v_reasons := '["agency_to_private_confirmed"]'::jsonb;
  elsif v_best_state = 'OFF_MARKET_NO_SALE_EVIDENCE' then
    v_level := 'HIGH'; v_score := 85;
    v_reasons := '["agency_exit_confirmed","no_sale_evidence","no_new_agency_evidence"]'::jsonb;
  elsif v_best_state = 'CLOSED_SWITCHED' then
    v_level := 'INTERESTING'; v_score := 55; v_reasons := '["agency_switch_confirmed"]'::jsonb;
  elsif v_best_state = 'EXIT_PENDING' then
    v_level := 'INTERESTING'; v_score := 50; v_reasons := '["agency_exit_under_review"]'::jsonb;
  else
    v_score := 0;
    v_reasons := '[]'::jsonb;
    if coalesce(v_age_days, 0) >= 150 then
      v_score := v_score + 25;
      v_reasons := v_reasons || '["true_market_age_at_least_150_days"]'::jsonb;
    end if;
    if v_price_drops > 0 then
      v_score := v_score + least(15, v_price_drops * 5);
      v_reasons := v_reasons || jsonb_build_array('price_drops:' || v_price_drops);
    end if;
    if v_property.relaunch_count > 0 then
      v_score := v_score + least(15, v_property.relaunch_count * 5);
      v_reasons := v_reasons || jsonb_build_array('relaunches:' || v_property.relaunch_count);
    end if;
    if v_score > 0 then
      v_level := 'WATCH';
    else
      v_level := 'NONE';
      v_reasons := '["no_current_opportunity_signal"]'::jsonb;
    end if;
  end if;

  insert into public.opportunities (
    property_id, opportunity_type, status, level, score,
    evidence_summary, reasons, rule_version, dedupe_key
  ) values (
    p_property_id,
    'ACQUISITION',
    case when v_level = 'NONE' then case when v_property.sale_status = 'SOLD_CONFIRMED' then 'DISMISSED' else 'EXPIRED' end else 'OPEN' end,
    v_level,
    v_score,
    jsonb_build_object('propertyState', v_property_state),
    v_reasons,
    1,
    'acquisition:' || p_property_id || ':v1'
  )
  on conflict (dedupe_key) do update set
    status = excluded.status,
    level = excluded.level,
    score = excluded.score,
    evidence_summary = excluded.evidence_summary,
    reasons = excluded.reasons,
    updated_at = now();
end;
$$;

revoke all on function public.record_adapter_health_observation(uuid, uuid, text, integer, integer, integer, text, jsonb, jsonb, integer, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_adapter_health_observation(uuid, uuid, text, integer, integer, integer, text, jsonb, jsonb, integer, jsonb, timestamptz)
  to service_role;

revoke all on function public.record_observation_commit_failure(uuid)
  from public, anon, authenticated;
grant execute on function public.record_observation_commit_failure(uuid) to service_role;

revoke all on function public.refresh_property_lifecycle_intelligence_atomic(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_property_lifecycle_intelligence_atomic(uuid, timestamptz)
  to service_role;

comment on table public.adapter_health_baselines is
  'Baseline progressiva per agenzia; contiene soltanto osservazioni healthy realmente accumulate.';
comment on column public.agency_listings.next_check_at is
  'Scadenza durevole del prossimo controllo Post-Exit, indipendente dalla memoria del worker.';
comment on column public.sync_runs.observation_failure_count is
  'Numero di observation la cui transazione DB è fallita e non ha prodotto stato parziale.';

commit;


-- -----------------------------------------------------------------------------
-- Derived from 030_property_lifecycle_atomic_observations.sql
-- -----------------------------------------------------------------------------
begin;

create or replace function public.insert_property_lifecycle_event_atomic(
  p_property_id uuid,
  p_agency_listing_id uuid,
  p_publication_id uuid,
  p_sync_run_id uuid,
  p_event_type text,
  p_occurred_at timestamptz,
  p_dedupe_key text,
  p_confidence numeric default 1,
  p_actor_type text default 'SYSTEM',
  p_payload jsonb default '{}'::jsonb,
  p_evidence_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.events (
    property_id, agency_listing_id, publication_id, sync_run_id,
    event_type, occurred_at, confidence, actor_type, dedupe_key, payload
  ) values (
    p_property_id, p_agency_listing_id, p_publication_id, p_sync_run_id,
    p_event_type, p_occurred_at, coalesce(p_confidence, 1), p_actor_type,
    p_dedupe_key, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (dedupe_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id from public.events where dedupe_key = p_dedupe_key;
  end if;

  if v_event_id is not null and coalesce(array_length(p_evidence_ids, 1), 0) > 0 then
    insert into public.event_evidence (event_id, evidence_id)
    select v_event_id, evidence_id from unnest(p_evidence_ids) evidence_id
    on conflict do nothing;
  end if;
  return v_event_id;
end;
$$;

-- Superseded observation function omitted; final definition is derived from migration 032.

revoke all on function public.insert_property_lifecycle_event_atomic(uuid, uuid, uuid, uuid, text, timestamptz, text, numeric, text, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.insert_property_lifecycle_event_atomic(uuid, uuid, uuid, uuid, text, timestamptz, text, numeric, text, jsonb, uuid[])
  to service_role;


commit;


-- -----------------------------------------------------------------------------
-- Derived from 031_property_lifecycle_durable_exit.sql
-- -----------------------------------------------------------------------------
begin;

create table public.missing_observation_commits (
  sync_run_id uuid not null references public.sync_runs(id) on delete restrict,
  publication_id uuid not null references public.publications(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (sync_run_id, publication_id)
);

alter table public.missing_observation_commits enable row level security;
grant select on table public.missing_observation_commits to authenticated;
grant select, insert, update, delete on table public.missing_observation_commits to service_role;
create policy "authenticated read missing observation commits"
  on public.missing_observation_commits for select to authenticated using (true);

create or replace function public.apply_missing_observations_atomic(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_observed_source_keys text[],
  p_observed_at timestamptz,
  p_missing_threshold integer default 2,
  p_post_exit_delay_hours integer default 48,
  p_failure_point text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication record;
  v_agency_listing record;
  v_next_count integer;
  v_next_state text;
  v_other_active integer;
  v_missing_count integer := 0;
  v_transitioned_count integer := 0;
  v_event_id uuid;
  v_due_at timestamptz;
begin
  if p_missing_threshold < 2 then
    p_missing_threshold := 2;
  end if;
  if p_post_exit_delay_hours < 1 then
    raise exception 'Post-exit delay must be at least one hour';
  end if;
  if not exists (
    select 1 from public.sync_runs
    where id = p_sync_run_id and agency_id = p_agency_id and status = 'RUNNING'
  ) then
    raise exception 'Running sync % does not belong to agency %', p_sync_run_id, p_agency_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('missing:' || p_agency_id::text, 0));

  for v_publication in
    select p.* from public.publications p
    where p.agency_id = p_agency_id
      and p.state in ('ACTIVE', 'MISSING_PENDING')
      and not (p.source_key = any(coalesce(p_observed_source_keys, '{}'::text[])))
    order by p.id
    for update
  loop
    insert into public.missing_observation_commits (sync_run_id, publication_id)
    values (p_sync_run_id, v_publication.id)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    select * into strict v_agency_listing
    from public.agency_listings
    where id = v_publication.agency_listing_id
    for update;
    v_next_count := v_publication.missing_healthy_run_count + 1;
    v_next_state := case
      when v_next_count >= p_missing_threshold then 'REMOVED'
      else 'MISSING_PENDING'
    end;

    update public.publications set
      state = v_next_state,
      missing_healthy_run_count = v_next_count,
      missing_since = coalesce(missing_since, p_observed_at),
      removed_at = case when v_next_state = 'REMOVED' then p_observed_at else null end
    where id = v_publication.id;
    v_missing_count := v_missing_count + 1;

    if p_failure_point = 'AFTER_MISSING_PUBLICATION' then
      raise exception 'Injected missing observation failure AFTER_MISSING_PUBLICATION';
    end if;

    select count(*) into v_other_active
    from public.publications
    where agency_listing_id = v_agency_listing.id
      and id <> v_publication.id
      and state in ('ACTIVE', 'MISSING_PENDING');

    if v_next_state = 'REMOVED' and v_agency_listing.state = 'ACTIVE' and v_other_active = 0 then
      v_due_at := p_observed_at + make_interval(hours => p_post_exit_delay_hours);
      update public.agency_listings set
        state = 'EXIT_PENDING',
        state_reason = jsonb_build_object('publicationState', v_next_state),
        monitoring_phase = 'WAITING_CONFIRMATION',
        post_exit_check_due_at = v_due_at,
        next_check_at = v_due_at,
        check_attempt = 0,
        last_check_at = null
      where id = v_agency_listing.id;

      insert into public.lifecycle_jobs (
        job_type, agency_id, payload, run_after, dedupe_key
      ) values (
        'POST_EXIT_CHECK', p_agency_id,
        jsonb_build_object(
          'agencyListingId', v_agency_listing.id,
          'publicationId', v_publication.id
        ),
        v_due_at,
        'POST_EXIT_CHECK:' || v_agency_listing.id || ':' || v_publication.id || ':' || v_next_count
      ) on conflict do nothing;
    end if;

    v_event_id := public.insert_property_lifecycle_event_atomic(
      v_agency_listing.property_id,
      v_agency_listing.id,
      v_publication.id,
      p_sync_run_id,
      case when v_next_state = 'REMOVED' then 'PUBLICATION_REMOVED' else 'PUBLICATION_MISSING_PENDING' end,
      p_observed_at,
      v_publication.id || ':' || case when v_next_state = 'REMOVED' then 'PUBLICATION_REMOVED' else 'PUBLICATION_MISSING_PENDING' end || ':' || v_next_count,
      1,
      'SYSTEM',
      jsonb_build_object('missingHealthyRunCount', v_next_count),
      '{}'::uuid[]
    );
    if v_event_id is not null then
      v_transitioned_count := v_transitioned_count + 1;
    end if;
    perform public.refresh_property_lifecycle_intelligence_atomic(
      v_agency_listing.property_id,
      p_observed_at
    );
  end loop;

  return jsonb_build_object(
    'missingCount', v_missing_count,
    'transitionedCount', v_transitioned_count
  );
end;
$$;

create or replace function public.run_post_exit_check_atomic(
  p_job_id uuid,
  p_agency_listing_id uuid,
  p_publication_id uuid default null,
  p_checked_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_publication record;
  v_existing_outcome text;
  v_switched boolean;
  v_private boolean;
  v_manual_state text;
  v_explicit_sold boolean;
  v_reappeared boolean;
  v_due boolean;
  v_outcome text;
  v_state text;
  v_confidence numeric;
  v_next_check timestamptz;
begin
  select outcome into v_existing_outcome
  from public.post_exit_checks where job_id = p_job_id;
  if v_existing_outcome is not null then
    return v_existing_outcome;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('post-exit:' || p_agency_listing_id::text, 0));
  select * into strict v_listing
  from public.agency_listings
  where id = p_agency_listing_id
  for update;

  if p_publication_id is not null then
    select * into strict v_publication
    from public.publications
    where id = p_publication_id and agency_listing_id = p_agency_listing_id
    for update;
  else
    select * into strict v_publication
    from public.publications
    where agency_listing_id = p_agency_listing_id
    order by last_seen_at desc
    limit 1
    for update;
  end if;

  select exists(
    select 1 from public.agency_listings
    where property_id = v_listing.property_id
      and agency_id <> v_listing.agency_id
      and state = 'ACTIVE'
  ) into v_switched;
  select exists(
    select 1 from public.private_publications
    where property_id = v_listing.property_id and state = 'ACTIVE'
  ) into v_private;
  select mo.override_value #>> '{}'
  into v_manual_state
  from public.manual_overrides mo
  where mo.target_type = 'AGENCY_LISTING'
    and mo.target_id = p_agency_listing_id
    and mo.override_key = 'state'
    and mo.effective_at <= p_checked_at
    and not exists(select 1 from public.manual_overrides superseding where superseding.supersedes_id = mo.id)
  order by mo.effective_at desc, mo.created_at desc
  limit 1;

  v_explicit_sold := v_publication.state = 'SOLD_MARKED' or v_publication.source_status = 'SOLD';
  v_reappeared := v_publication.state = 'ACTIVE';
  v_due := v_listing.next_check_at is not null and p_checked_at >= v_listing.next_check_at;

  if v_manual_state is not null and v_manual_state <> 'EXIT_PENDING' then
    v_state := v_manual_state;
    v_outcome := case when v_manual_state = 'ACTIVE' then 'REAPPEARED' else v_manual_state end;
    v_confidence := 1;
  elsif v_reappeared then
    v_state := 'ACTIVE'; v_outcome := 'REAPPEARED'; v_confidence := 1;
  elsif v_explicit_sold then
    v_state := 'CLOSED_SOLD'; v_outcome := 'CLOSED_SOLD'; v_confidence := 0.95;
  elsif v_switched then
    v_state := 'CLOSED_SWITCHED'; v_outcome := 'CLOSED_SWITCHED'; v_confidence := 0.95;
  elsif v_private then
    v_state := 'CLOSED_TO_PRIVATE'; v_outcome := 'CLOSED_TO_PRIVATE'; v_confidence := 0.95;
  elsif not v_due then
    v_state := 'EXIT_PENDING'; v_outcome := 'NEEDS_VERIFICATION'; v_confidence := 0.5;
  else
    v_state := 'OFF_MARKET_NO_SALE_EVIDENCE';
    v_outcome := 'OFF_MARKET_NO_SALE_EVIDENCE';
    v_confidence := 0.85;
  end if;

  insert into public.post_exit_checks (
    agency_listing_id, publication_id, job_id, checked_at,
    technical_disappearance_confirmed, explicit_sale_evidence,
    switched_agency_evidence, private_relist_evidence, reappearance_evidence,
    outcome, confidence, evidence_summary
  ) values (
    p_agency_listing_id, v_publication.id, p_job_id, p_checked_at,
    v_publication.state = 'REMOVED', v_explicit_sold, v_switched, v_private,
    v_reappeared, v_outcome, v_confidence,
    jsonb_build_object(
      'manualOutcome', v_manual_state,
      'dueAt', v_listing.next_check_at,
      'attempt', v_listing.check_attempt + 1
    )
  );

  if v_outcome = 'NEEDS_VERIFICATION' then
    v_next_check := coalesce(v_listing.next_check_at, p_checked_at + interval '48 hours');
    update public.agency_listings set
      monitoring_phase = 'WAITING_CONFIRMATION',
      post_exit_check_due_at = coalesce(post_exit_check_due_at, v_next_check),
      next_check_at = v_next_check,
      check_attempt = check_attempt + 1,
      last_check_at = p_checked_at
    where id = p_agency_listing_id;
    insert into public.lifecycle_jobs (
      job_type, agency_id, payload, run_after, dedupe_key
    ) values (
      'POST_EXIT_CHECK',
      v_listing.agency_id,
      jsonb_build_object(
        'agencyListingId', p_agency_listing_id,
        'publicationId', v_publication.id
      ),
      v_next_check,
      'POST_EXIT_RECHECK:' || p_agency_listing_id || ':' || (v_listing.check_attempt + 1)
    ) on conflict do nothing;
  else
    update public.agency_listings set
      state = v_state,
      closed_at = case when v_state = 'ACTIVE' then null else p_checked_at end,
      exit_confirmed_at = case when v_state = 'ACTIVE' then null else p_checked_at end,
      outcome_source = case when v_manual_state is not null then 'MANUAL_OVERRIDE' else 'POST_EXIT_MONITOR_V2' end,
      outcome_confidence = v_confidence,
      monitoring_phase = case when v_state = 'ACTIVE' then 'NONE' else 'COMPLETE' end,
      post_exit_check_due_at = null,
      next_check_at = null,
      check_attempt = check_attempt + 1,
      last_check_at = p_checked_at
    where id = p_agency_listing_id;
  end if;

  perform public.insert_property_lifecycle_event_atomic(
    v_listing.property_id,
    p_agency_listing_id,
    v_publication.id,
    null,
    case when v_outcome = 'REAPPEARED' then 'PUBLICATION_REAPPEARED' else 'POST_EXIT_CLASSIFIED' end,
    p_checked_at,
    p_agency_listing_id || ':POST_EXIT:' || p_job_id,
    v_confidence,
    'SYSTEM',
    jsonb_build_object('outcome', v_outcome),
    '{}'::uuid[]
  );
  perform public.refresh_property_lifecycle_intelligence_atomic(v_listing.property_id, p_checked_at);
  return v_outcome;
end;
$$;

revoke all on function public.apply_missing_observations_atomic(uuid, uuid, text[], timestamptz, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_missing_observations_atomic(uuid, uuid, text[], timestamptz, integer, integer, text)
  to service_role;

revoke all on function public.run_post_exit_check_atomic(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.run_post_exit_check_atomic(uuid, uuid, uuid, timestamptz)
  to service_role;

comment on table public.missing_observation_commits is
  'Chiave idempotente per impedire doppi missing event o doppi incrementi nello stesso sync run.';
comment on function public.run_post_exit_check_atomic(uuid, uuid, uuid, timestamptz) is
  'Controllo Post-Exit transazionale guidato dalla scadenza durevole sull agency listing.';

commit;


-- -----------------------------------------------------------------------------
-- Derived from 032_property_lifecycle_sale_conflict.sql
-- -----------------------------------------------------------------------------
-- Sale intelligence: a sold graphic must not silently override an explicit
-- negotiation status declared by the source.
--
-- The observation RPC treated any sold graphic as deterministic sold evidence.
-- PuntoCasa marks a listing "In trattativa" (source_status NEGOTIATION, high
-- confidence) while still carrying a "venduto" overlay among its assets, so the
-- property was written as SOLD_CONFIRMED with no review raised and the mandatory
-- VENDITA / TRATTATIVA / VENDUTO distinction was lost. Contradictory evidence now
-- yields PROBABLE_SOLD and opens a review, matching how a conflicting active
-- publication is already handled.
--
-- Recreates persist_property_lifecycle_observation_atomic unchanged apart from
-- that branch.

create or replace function public.persist_property_lifecycle_observation_atomic(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_listing jsonb,
  p_identity_decision jsonb,
  p_processed_assets jsonb,
  p_location_normalized_key text,
  p_building jsonb default null,
  p_media_market_start jsonb default null,
  p_failure_point text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_key text := p_listing #>> '{source,sourceKey}';
  v_observed_at timestamptz := (p_listing->>'observedAt')::timestamptz;
  v_status text := p_listing #>> '{status,value}';
  v_location_id uuid;
  v_building_id uuid;
  v_property_id uuid;
  v_agency_listing_id uuid;
  v_publication_id uuid;
  v_snapshot_id uuid;
  v_existing_publication record;
  v_existing_property record;
  v_existing_agency_listing record;
  v_previous_snapshot record;
  v_created_property boolean := false;
  v_created_publication boolean := false;
  v_prior_publication_ids uuid[] := '{}'::uuid[];
  v_evidence_ids uuid[] := '{}'::uuid[];
  v_claim jsonb;
  v_asset jsonb;
  v_processed jsonb;
  v_evidence_id uuid;
  v_event_id uuid;
  v_initial_state text;
  v_next_agency_state text;
  v_other_active_count integer;
  v_manual_sale_status text;
  v_sale_status text;
  v_sale_conflict boolean := false;
  v_sold_graphic boolean := false;
  v_identity_outcome text := p_identity_decision->>'outcome';
  v_identity_score numeric := coalesce((p_identity_decision->>'score')::numeric, 0);
  v_candidate jsonb;
  v_candidate_property_id uuid;
  v_candidate_count integer := 0;
  v_photo_urls_before text[];
  v_photo_urls_after text[];
  v_plan_urls_before text[];
  v_plan_urls_after text[];
  v_image_hashes_before text[];
  v_image_hashes_after text[];
  v_plan_hashes_before text[];
  v_plan_hashes_after text[];
  v_changed boolean;
  v_price_before integer;
  v_price_after integer := nullif(p_listing #>> '{commercial,priceAmount}', '')::integer;
  v_media_anchor timestamptz;
  v_current_anchor timestamptz;
  v_manual_state text;
  v_other record;
begin
  if nullif(v_source_key, '') is null then
    raise exception 'Observation source key is required';
  end if;
  if not exists (
    select 1 from public.sync_runs
    where id = p_sync_run_id and agency_id = p_agency_id and status = 'RUNNING'
  ) then
    raise exception 'Running sync % does not belong to agency %', p_sync_run_id, p_agency_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_agency_id::text || ':' || v_source_key, 0));

  select p.*, al.property_id
  into v_existing_publication
  from public.publications p
  join public.agency_listings al on al.id = p.agency_listing_id
  where p.agency_id = p_agency_id and p.source_key = v_source_key
  for update of p, al;

  if v_existing_publication.id is not null then
    select s.id into v_snapshot_id
    from public.snapshots s
    where s.sync_run_id = p_sync_run_id
      and s.publication_id = v_existing_publication.id;
    if v_snapshot_id is not null then
      return jsonb_build_object(
        'propertyId', v_existing_publication.property_id,
        'agencyListingId', v_existing_publication.agency_listing_id,
        'publicationId', v_existing_publication.id,
        'snapshotId', v_snapshot_id,
        'createdProperty', false,
        'createdPublication', false,
        'replayed', true
      );
    end if;
  end if;

  insert into public.locations (
    raw_text, municipality, locality, postal_code, street_name, street_number,
    latitude, longitude, scope_state, resolution_method, resolution_confidence,
    precision_level, evidence_source, normalized_key, metadata
  ) values (
    p_listing #>> '{location,rawText}',
    p_listing #>> '{location,municipality}',
    p_listing #>> '{location,locality}',
    p_listing #>> '{location,postalCode}',
    p_listing #>> '{location,streetName}',
    p_listing #>> '{location,streetNumber}',
    nullif(p_listing #>> '{location,latitude}', '')::double precision,
    nullif(p_listing #>> '{location,longitude}', '')::double precision,
    p_listing #>> '{location,scope}',
    p_listing #>> '{location,resolutionMethod}',
    (p_listing #>> '{location,resolutionConfidence}')::numeric,
    p_listing #>> '{location,precision}',
    p_listing->>'adapterKey',
    p_location_normalized_key,
    jsonb_build_object('reasons', coalesce(p_listing #> '{location,reasons}', '[]'::jsonb))
  )
  on conflict (normalized_key) do update set
    raw_text = excluded.raw_text,
    municipality = excluded.municipality,
    locality = excluded.locality,
    postal_code = excluded.postal_code,
    street_name = excluded.street_name,
    street_number = excluded.street_number,
    latitude = case when locations.manually_verified then locations.latitude else excluded.latitude end,
    longitude = case when locations.manually_verified then locations.longitude else excluded.longitude end,
    scope_state = case when locations.manually_verified then locations.scope_state else excluded.scope_state end,
    resolution_method = case when locations.manually_verified then locations.resolution_method else excluded.resolution_method end,
    resolution_confidence = case when locations.manually_verified then locations.resolution_confidence else excluded.resolution_confidence end,
    precision_level = case when locations.manually_verified then locations.precision_level else excluded.precision_level end,
    evidence_source = excluded.evidence_source,
    metadata = excluded.metadata
  returning id into v_location_id;

  if p_building is not null then
    insert into public.buildings (
      location_id, normalized_key, display_name, attributes, first_seen_at, last_seen_at
    ) values (
      v_location_id,
      p_building->>'normalizedKey',
      p_building->>'displayName',
      jsonb_build_object(
        'municipality', p_building->>'municipality',
        'locality', p_building->>'locality',
        'streetName', p_building->>'streetName',
        'streetNumber', p_building->>'streetNumber'
      ),
      v_observed_at,
      v_observed_at
    )
    on conflict (normalized_key) do update set
      location_id = excluded.location_id,
      display_name = excluded.display_name,
      attributes = buildings.attributes || excluded.attributes,
      last_seen_at = excluded.last_seen_at
    returning id into v_building_id;
  end if;

  if v_existing_publication.id is not null then
    v_property_id := v_existing_publication.property_id;
    v_agency_listing_id := v_existing_publication.agency_listing_id;
    v_identity_outcome := 'AUTO_MATCH';
    v_identity_score := 1;
  elsif v_identity_outcome = 'AUTO_MATCH' and nullif(p_identity_decision->>'propertyId', '') is not null then
    v_property_id := (p_identity_decision->>'propertyId')::uuid;
    if not exists (select 1 from public.properties where id = v_property_id and identity_status <> 'MERGED') then
      raise exception 'Identity target % is not an active property', v_property_id;
    end if;
  else
    insert into public.properties (
      primary_location_id, building_id, property_type, identity_status,
      true_market_start_lower_bound, true_market_start_upper_bound,
      true_market_start_method, true_market_start_confidence,
      first_public_evidence_at, first_seen_at, last_seen_at, canonical_attributes
    ) values (
      v_location_id,
      v_building_id,
      p_listing #>> '{commercial,propertyType}',
      case when v_identity_outcome = 'REVIEW_REQUIRED' then 'REVIEW' else 'PROVISIONAL' end,
      nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
      nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
      p_listing #>> '{marketStart,method}',
      (p_listing #>> '{marketStart,confidence}')::numeric,
      coalesce(
        nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
        nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
        v_observed_at
      ),
      v_observed_at,
      v_observed_at,
      jsonb_build_object(
        'address', coalesce(
          nullif(trim(concat_ws(' ', p_listing #>> '{location,streetName}', p_listing #>> '{location,streetNumber}')), ''),
          p_listing #>> '{location,rawText}'
        ),
        'locality', p_listing #>> '{location,locality}',
        'surfaceSqm', p_listing #> '{commercial,surfaceSqm}',
        'rooms', p_listing #> '{commercial,rooms}',
        'floor', p_listing #> '{commercial,floor}',
        'priceAmount', p_listing #> '{commercial,priceAmount}',
        'propertyType', p_listing #> '{commercial,propertyType}'
      )
    ) returning id into v_property_id;
    v_created_property := true;
  end if;

  select * into strict v_existing_property
  from public.properties where id = v_property_id for update;

  v_current_anchor := coalesce(
    v_existing_property.true_market_start_lower_bound,
    v_existing_property.true_market_start_upper_bound,
    'infinity'::timestamptz
  );
  if coalesce(
    nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
    nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
    'infinity'::timestamptz
  ) < v_current_anchor then
    update public.properties set
      true_market_start_lower_bound = nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
      true_market_start_upper_bound = nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
      true_market_start_method = p_listing #>> '{marketStart,method}',
      true_market_start_confidence = (p_listing #>> '{marketStart,confidence}')::numeric
    where id = v_property_id;
  end if;

  update public.properties property set
    primary_location_id = case
      when property.primary_location_id is null then v_location_id
      when property.primary_location_id = v_location_id then v_location_id
      when exists(select 1 from public.locations where id = property.primary_location_id and manually_verified) then property.primary_location_id
      when (
        select case precision_level
          when 'EXACT_ADDRESS' then 4 when 'EXACT_COORDINATES' then 3
          when 'STREET_ONLY' then 2 when 'APPROXIMATE_AREA' then 1 else 0 end
        from public.locations where id = v_location_id
      ) > (
        select case precision_level
          when 'EXACT_ADDRESS' then 4 when 'EXACT_COORDINATES' then 3
          when 'STREET_ONLY' then 2 when 'APPROXIMATE_AREA' then 1 else 0 end
        from public.locations where id = property.primary_location_id
      ) then v_location_id
      else property.primary_location_id
    end,
    building_id = coalesce(property.building_id, v_building_id),
    property_type = coalesce(property.property_type, p_listing #>> '{commercial,propertyType}'),
    first_public_evidence_at = least(
      coalesce(property.first_public_evidence_at, 'infinity'::timestamptz),
      coalesce(
        nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
        nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
        v_observed_at
      )
    ),
    last_seen_at = greatest(property.last_seen_at, v_observed_at),
    canonical_attributes = property.canonical_attributes || jsonb_build_object(
      'address', coalesce(
        property.canonical_attributes->'address',
        to_jsonb(coalesce(
          nullif(trim(concat_ws(' ', p_listing #>> '{location,streetName}', p_listing #>> '{location,streetNumber}')), ''),
          p_listing #>> '{location,rawText}'
        ))
      ),
      'locality', coalesce(property.canonical_attributes->'locality', p_listing #> '{location,locality}'),
      'surfaceSqm', p_listing #> '{commercial,surfaceSqm}',
      'rooms', p_listing #> '{commercial,rooms}',
      'floor', p_listing #> '{commercial,floor}',
      'priceAmount', p_listing #> '{commercial,priceAmount}',
      'propertyType', p_listing #> '{commercial,propertyType}'
    )
  where property.id = v_property_id;

  if v_agency_listing_id is null then
    select * into v_existing_agency_listing
    from public.agency_listings
    where agency_id = p_agency_id and property_id = v_property_id
    for update;
    if v_existing_agency_listing.id is null then
      insert into public.agency_listings (
        agency_id, property_id, agency_reference, first_seen_at, last_seen_at
      ) values (
        p_agency_id, v_property_id, p_listing #>> '{source,agencyReference}',
        v_observed_at, v_observed_at
      ) returning id into v_agency_listing_id;
    else
      v_agency_listing_id := v_existing_agency_listing.id;
      update public.agency_listings set
        agency_reference = coalesce(p_listing #>> '{source,agencyReference}', agency_reference),
        last_seen_at = greatest(last_seen_at, v_observed_at)
      where id = v_agency_listing_id;
    end if;
  end if;

  if v_existing_publication.id is null then
    select coalesce(array_agg(id order by first_seen_at), '{}'::uuid[])
    into v_prior_publication_ids
    from public.publications where agency_listing_id = v_agency_listing_id;

    v_initial_state := case when v_status = 'SOLD' then 'SOLD_MARKED' else 'ACTIVE' end;
    insert into public.publications (
      agency_id, agency_listing_id, source_key, external_id, canonical_url,
      transaction_type, state, source_status, first_seen_at, last_seen_at
    ) values (
      p_agency_id, v_agency_listing_id, v_source_key,
      p_listing #>> '{source,externalId}', p_listing #>> '{source,canonicalUrl}',
      p_listing #>> '{source,transactionType}', v_initial_state, v_status,
      v_observed_at, v_observed_at
    ) returning id into v_publication_id;
    v_created_publication := true;
  else
    v_publication_id := v_existing_publication.id;
    update public.publications set
      external_id = p_listing #>> '{source,externalId}',
      canonical_url = p_listing #>> '{source,canonicalUrl}',
      state = case when v_status = 'SOLD' then 'SOLD_MARKED' else 'ACTIVE' end,
      source_status = v_status,
      missing_healthy_run_count = 0,
      missing_since = null,
      removed_at = case when v_status = 'SOLD' then removed_at else null end,
      last_seen_at = greatest(last_seen_at, v_observed_at)
    where id = v_publication_id;
  end if;

  if p_failure_point = 'AFTER_PUBLICATION' then
    raise exception 'Injected observation failure AFTER_PUBLICATION';
  end if;

  if v_created_publication then
    for v_candidate in
      select value from jsonb_array_elements(coalesce(p_identity_decision->'candidates', '[]'::jsonb))
      where (value->>'rank')::integer <= 10
    loop
      v_candidate_property_id := (v_candidate->>'propertyId')::uuid;
      if exists(select 1 from public.properties where id = v_candidate_property_id) then
        insert into public.property_match_candidates (
          publication_id, candidate_property_id, evaluation_version, candidate_rank,
          score, outcome, feature_scores, contradictions
        ) values (
          v_publication_id, v_candidate_property_id, 1,
          (v_candidate->>'rank')::integer,
          (v_candidate->>'score')::numeric,
          case when v_identity_outcome = 'AUTO_MATCH' and (v_candidate->>'rank')::integer = 1
            then 'AUTO_MATCH' else v_identity_outcome end,
          coalesce(v_candidate->'features', '{}'::jsonb),
          coalesce(v_candidate->'contradictions', '[]'::jsonb)
        ) on conflict (publication_id, candidate_property_id, evaluation_version)
        do update set
          candidate_rank = excluded.candidate_rank,
          score = excluded.score,
          outcome = excluded.outcome,
          feature_scores = excluded.feature_scores,
          contradictions = excluded.contradictions;
        v_candidate_count := v_candidate_count + 1;
      end if;
    end loop;

    if v_identity_outcome = 'REVIEW_REQUIRED' then
      insert into public.review_queue (
        review_type, status, property_id, publication_id, title, details, dedupe_key
      ) values (
        'IDENTITY', 'OPEN', v_property_id, v_publication_id,
        'Ambiguous property identity',
        jsonb_build_object(
          'score', v_identity_score,
          'margin', coalesce((p_identity_decision->>'margin')::numeric, 0),
          'candidates', coalesce(p_identity_decision->'candidates', '[]'::jsonb)
        ),
        'identity:' || v_publication_id || ':v1'
      ) on conflict (dedupe_key) do update set
        status = 'OPEN', details = excluded.details, updated_at = now();
    end if;
  end if;

  select id, price_amount, content_hash, normalized_payload
  into v_previous_snapshot
  from public.snapshots
  where publication_id = v_publication_id
  order by observed_at desc
  limit 1;

  insert into public.snapshots (
    publication_id, sync_run_id, contract_version, observed_at, content_hash,
    normalized_payload, title, description, price_amount, price_currency,
    surface_sqm, rooms, source_status, availability, extraction_warnings
  ) values (
    v_publication_id, p_sync_run_id, (p_listing->>'contractVersion')::integer,
    v_observed_at, p_listing->>'contentHash', p_listing,
    p_listing #>> '{commercial,title}', p_listing #>> '{commercial,description}',
    v_price_after, p_listing #>> '{commercial,priceCurrency}',
    nullif(p_listing #>> '{commercial,surfaceSqm}', '')::numeric,
    nullif(p_listing #>> '{commercial,rooms}', '')::numeric,
    v_status, v_status not in ('SOLD', 'REMOVED'),
    coalesce(p_listing->'extractionWarnings', '[]'::jsonb)
  ) returning id into v_snapshot_id;

  for v_claim in
    select value from jsonb_array_elements(
      coalesce(p_listing #> '{status,evidence}', '[]'::jsonb)
      || coalesce(p_listing #> '{marketStart,evidence}', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'kind', 'LOCATION',
        'claimKey', 'publication.location',
        'sourceUrl', p_listing #>> '{source,canonicalUrl}',
        'extractionMethod', p_listing #>> '{location,resolutionMethod}',
        'rawValue', p_listing #> '{location,rawText}',
        'normalizedValue', jsonb_build_object(
          'municipality', p_listing #> '{location,municipality}',
          'locality', p_listing #> '{location,locality}',
          'postalCode', p_listing #> '{location,postalCode}',
          'streetName', p_listing #> '{location,streetName}',
          'precision', p_listing #> '{location,precision}',
          'scope', p_listing #> '{location,scope}'
        ),
        'confidence', p_listing #> '{location,resolutionConfidence}',
        'observedAt', p_listing->'observedAt',
        'sourceRecordedAt', null,
        'metadata', jsonb_build_object('reasons', p_listing #> '{location,reasons}')
      ))
    )
  loop
    insert into public.evidence (
      property_id, publication_id, snapshot_id, sync_run_id, evidence_kind,
      source_url, extraction_method, claim_key, raw_value, normalized_value,
      confidence, observed_at, source_recorded_at, evidence_hash, metadata
    ) values (
      v_property_id, v_publication_id, v_snapshot_id, p_sync_run_id,
      v_claim->>'kind', v_claim->>'sourceUrl', v_claim->>'extractionMethod',
      v_claim->>'claimKey', v_claim->>'rawValue', v_claim->'normalizedValue',
      (v_claim->>'confidence')::numeric,
      coalesce(nullif(v_claim->>'observedAt', '')::timestamptz, v_observed_at),
      nullif(v_claim->>'sourceRecordedAt', '')::timestamptz,
      encode(extensions.digest((v_claim - 'observedAt')::text, 'sha256'), 'hex'),
      coalesce(v_claim->'metadata', '{}'::jsonb)
    ) returning id into v_evidence_id;
    v_evidence_ids := array_append(v_evidence_ids, v_evidence_id);
  end loop;

  if p_media_market_start is not null then
    insert into public.evidence (
      property_id, publication_id, snapshot_id, sync_run_id, evidence_kind,
      source_url, extraction_method, claim_key, raw_value, normalized_value,
      confidence, observed_at, source_recorded_at, evidence_hash, metadata
    ) values (
      v_property_id, v_publication_id, v_snapshot_id, p_sync_run_id,
      'MARKET_START_BOUND', p_media_market_start->>'sourceUrl',
      p_media_market_start->>'method', p_media_market_start->>'claimKey',
      p_media_market_start->>'rawValue', p_media_market_start->'normalizedValue',
      (p_media_market_start->>'confidence')::numeric, v_observed_at,
      (p_media_market_start->>'sourceRecordedAt')::timestamptz,
      encode(extensions.digest((p_media_market_start - 'observedAt')::text, 'sha256'), 'hex'),
      coalesce(p_media_market_start->'metadata', '{}'::jsonb)
    ) returning id into v_evidence_id;
    v_evidence_ids := array_append(v_evidence_ids, v_evidence_id);
    v_media_anchor := (p_media_market_start->>'sourceRecordedAt')::timestamptz;
    select coalesce(true_market_start_lower_bound, true_market_start_upper_bound, 'infinity'::timestamptz)
      into v_current_anchor from public.properties where id = v_property_id;
    if v_media_anchor < v_current_anchor then
      update public.properties set
        true_market_start_lower_bound = null,
        true_market_start_upper_bound = v_media_anchor,
        true_market_start_method = p_media_market_start->>'method',
        true_market_start_confidence = (p_media_market_start->>'confidence')::numeric,
        first_public_evidence_at = least(coalesce(first_public_evidence_at, v_media_anchor), v_media_anchor)
      where id = v_property_id;
    end if;
  end if;

  if p_failure_point = 'AFTER_SNAPSHOT' then
    raise exception 'Injected observation failure AFTER_SNAPSHOT';
  end if;

  for v_asset in
    select value from jsonb_array_elements(coalesce(p_listing->'assets', '[]'::jsonb))
  loop
    select value into v_processed
    from jsonb_array_elements(coalesce(p_processed_assets, '[]'::jsonb))
    where value->>'canonicalUrl' = v_asset->>'canonicalUrl'
    limit 1;
    v_sold_graphic := v_sold_graphic
      or coalesce(v_processed->>'classification', '') = 'SOLD_GRAPHIC'
      or (v_asset->>'canonicalUrl') ~* '(vendut|sold)';

    if coalesce(v_processed->>'classification', v_asset->>'kind') = 'FLOORPLAN' then
      insert into public.floorplan_fingerprints (
        property_id, publication_id, snapshot_id, canonical_url, algorithm,
        fingerprint, width, height, source_recorded_at, metadata
      )
      select v_property_id, v_publication_id, v_snapshot_id,
        v_asset->>'canonicalUrl', algorithm, fingerprint,
        nullif(v_processed->>'width', '')::integer,
        nullif(v_processed->>'height', '')::integer,
        nullif(coalesce(v_processed->>'sourceRecordedAt', v_asset->>'sourceRecordedAt'), '')::timestamptz,
        coalesce(v_asset->'metadata', '{}'::jsonb) || jsonb_build_object(
          'classification', coalesce(v_processed->>'classification', v_asset->>'kind'),
          'format', v_processed->'format', 'contentType', v_processed->'contentType',
          'etag', v_processed->'etag', 'lastModified', v_processed->'lastModified',
          'exif', v_processed->'exif'
        )
      from (values
        (case when v_processed is null then 'SOURCE_URL_SHA256' else 'SHA256' end,
         case when v_processed is null then encode(extensions.digest(v_asset->>'canonicalUrl', 'sha256'), 'hex') else v_processed->>'sha256' end),
        ('DHASH64', case when v_processed is null then null else v_processed->>'perceptualHash' end)
      ) valueset(algorithm, fingerprint)
      where fingerprint is not null;
    elsif coalesce(v_processed->>'classification', 'IMAGE') <> 'SOLD_GRAPHIC' then
      insert into public.image_fingerprints (
        property_id, publication_id, snapshot_id, canonical_url, algorithm,
        fingerprint, width, height, source_recorded_at, metadata
      )
      select v_property_id, v_publication_id, v_snapshot_id,
        v_asset->>'canonicalUrl', algorithm, fingerprint,
        nullif(v_processed->>'width', '')::integer,
        nullif(v_processed->>'height', '')::integer,
        nullif(coalesce(v_processed->>'sourceRecordedAt', v_asset->>'sourceRecordedAt'), '')::timestamptz,
        coalesce(v_asset->'metadata', '{}'::jsonb) || jsonb_build_object(
          'classification', coalesce(v_processed->>'classification', 'IMAGE'),
          'format', v_processed->'format', 'contentType', v_processed->'contentType',
          'etag', v_processed->'etag', 'lastModified', v_processed->'lastModified',
          'exif', v_processed->'exif'
        )
      from (values
        (case when v_processed is null then 'SOURCE_URL_SHA256' else 'SHA256' end,
         case when v_processed is null then encode(extensions.digest(v_asset->>'canonicalUrl', 'sha256'), 'hex') else v_processed->>'sha256' end),
        ('DHASH64', case when v_processed is null then null else v_processed->>'perceptualHash' end)
      ) valueset(algorithm, fingerprint)
      where fingerprint is not null;
    end if;
    v_processed := null;
  end loop;

  if p_failure_point = 'DURING_EVENT_GENERATION' then
    raise exception 'Injected observation failure DURING_EVENT_GENERATION';
  end if;

  if v_existing_publication.id is not null then
    if v_existing_publication.state in ('MISSING_PENDING', 'REMOVED') and v_status <> 'SOLD' then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_REAPPEARED', v_observed_at,
        v_publication_id || ':PUBLICATION_REAPPEARED:' || (p_listing->>'contentHash'),
        1, 'SYSTEM', jsonb_build_object('sourceStatus', v_status), v_evidence_ids
      );
    end if;
    if v_status <> v_existing_publication.source_status and v_status <> 'UNKNOWN' then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'SOURCE_STATUS_CHANGED', v_observed_at,
        v_publication_id || ':SOURCE_STATUS_CHANGED:' || (p_listing->>'contentHash'),
        1, 'SYSTEM', jsonb_build_object('sourceStatus', v_status), v_evidence_ids
      );
    end if;
  end if;

  if v_previous_snapshot.id is not null then
    v_price_before := v_previous_snapshot.price_amount;
    if v_previous_snapshot.content_hash <> (p_listing->>'contentHash') then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_CONTENT_CHANGED', v_observed_at,
        v_publication_id || ':PUBLICATION_CONTENT_CHANGED:' || v_previous_snapshot.id || ':' || (p_listing->>'contentHash'),
        1, 'SYSTEM', jsonb_build_object('previousSnapshotId', v_previous_snapshot.id, 'snapshotId', v_snapshot_id), v_evidence_ids
      );
    end if;
    if v_price_before is distinct from v_price_after and v_price_before is not null and v_price_after is not null then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        case when v_price_after < v_price_before then 'PRICE_DROP' else 'PRICE_INCREASE' end,
        v_observed_at,
        v_publication_id || ':' || case when v_price_after < v_price_before then 'PRICE_DROP' else 'PRICE_INCREASE' end || ':' || v_previous_snapshot.id || ':' || v_price_after,
        1, 'SYSTEM', jsonb_build_object(
          'oldPrice', v_price_before, 'newPrice', v_price_after,
          'absoluteDelta', abs(v_price_after - v_price_before),
          'percentageDelta', round((abs(v_price_after - v_price_before)::numeric / greatest(v_price_before, 1)) * 100, 2),
          'currency', p_listing #>> '{commercial,priceCurrency}'
        ), v_evidence_ids
      );
    end if;

    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_photo_urls_before
      from jsonb_array_elements(coalesce(v_previous_snapshot.normalized_payload->'assets', '[]'::jsonb))
      where value->>'kind' = 'IMAGE';
    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_photo_urls_after
      from jsonb_array_elements(coalesce(p_listing->'assets', '[]'::jsonb))
      where value->>'kind' = 'IMAGE';
    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_plan_urls_before
      from jsonb_array_elements(coalesce(v_previous_snapshot.normalized_payload->'assets', '[]'::jsonb))
      where value->>'kind' = 'FLOORPLAN';
    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_plan_urls_after
      from jsonb_array_elements(coalesce(p_listing->'assets', '[]'::jsonb))
      where value->>'kind' = 'FLOORPLAN';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_image_hashes_before from public.image_fingerprints
      where snapshot_id = v_previous_snapshot.id and algorithm = 'DHASH64';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_image_hashes_after from public.image_fingerprints
      where snapshot_id = v_snapshot_id and algorithm = 'DHASH64';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_plan_hashes_before from public.floorplan_fingerprints
      where snapshot_id = v_previous_snapshot.id and algorithm = 'DHASH64';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_plan_hashes_after from public.floorplan_fingerprints
      where snapshot_id = v_snapshot_id and algorithm = 'DHASH64';

    v_changed := v_photo_urls_before <> v_photo_urls_after
      or (cardinality(v_image_hashes_before) > 0 and cardinality(v_image_hashes_after) > 0 and v_image_hashes_before <> v_image_hashes_after);
    if v_changed then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PHOTO_CHANGED', v_observed_at,
        v_publication_id || ':PHOTO_CHANGED:' || v_previous_snapshot.id || ':' || v_snapshot_id,
        1, 'SYSTEM', jsonb_build_object('previousSnapshotId', v_previous_snapshot.id, 'snapshotId', v_snapshot_id), v_evidence_ids
      );
    end if;
    v_changed := v_plan_urls_before <> v_plan_urls_after
      or (cardinality(v_plan_hashes_before) > 0 and cardinality(v_plan_hashes_after) > 0 and v_plan_hashes_before <> v_plan_hashes_after);
    if v_changed then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'FLOORPLAN_CHANGED', v_observed_at,
        v_publication_id || ':FLOORPLAN_CHANGED:' || v_previous_snapshot.id || ':' || v_snapshot_id,
        1, 'SYSTEM', jsonb_build_object('previousSnapshotId', v_previous_snapshot.id, 'snapshotId', v_snapshot_id), v_evidence_ids
      );
    end if;
  end if;

  if v_created_property then
    perform public.insert_property_lifecycle_event_atomic(
      v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
      'PROPERTY_DISCOVERED', v_observed_at, v_property_id || ':PROPERTY_DISCOVERED',
      1, 'SYSTEM', jsonb_build_object('identityOutcome', v_identity_outcome), v_evidence_ids
    );
  end if;
  if v_created_publication then
    perform public.insert_property_lifecycle_event_atomic(
      v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
      'PUBLICATION_DISCOVERED', v_observed_at, v_publication_id || ':PUBLICATION_DISCOVERED',
      1, 'SYSTEM', jsonb_build_object('sourceKey', v_source_key), v_evidence_ids
    );
    if cardinality(v_prior_publication_ids) > 0 then
      v_event_id := public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_RELAUNCHED', v_observed_at, v_publication_id || ':PUBLICATION_RELAUNCHED',
        1, 'SYSTEM', jsonb_build_object('priorPublicationIds', v_prior_publication_ids), v_evidence_ids
      );
      if v_event_id is not null then
        update public.properties set relaunch_count = relaunch_count + 1 where id = v_property_id;
      end if;
    end if;
  end if;
  if v_status = 'SOLD' and (v_created_publication or coalesce(v_existing_publication.source_status, '') <> 'SOLD') then
    perform public.insert_property_lifecycle_event_atomic(
      v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
      'SOURCE_MARKED_SOLD', v_observed_at,
      v_publication_id || ':SOURCE_MARKED_SOLD:' || (p_listing->>'contentHash'),
      (p_listing #>> '{status,confidence}')::numeric, 'ADAPTER', '{}'::jsonb, v_evidence_ids
    );
  end if;

  if p_failure_point = 'DURING_LIFECYCLE_UPDATE' then
    raise exception 'Injected observation failure DURING_LIFECYCLE_UPDATE';
  end if;

  select count(*) into v_other_active_count
  from public.publications
  where agency_listing_id = v_agency_listing_id
    and id <> v_publication_id
    and state in ('ACTIVE', 'MISSING_PENDING');
  select * into v_existing_agency_listing from public.agency_listings where id = v_agency_listing_id for update;
  v_next_agency_state := case
    when v_status = 'SOLD' and v_other_active_count = 0 then 'CLOSED_SOLD'
    when v_status <> 'SOLD' and v_existing_agency_listing.state = 'EXIT_PENDING' then 'ACTIVE'
    else v_existing_agency_listing.state
  end;
  update public.agency_listings set
    state = v_next_agency_state,
    last_seen_at = greatest(last_seen_at, v_observed_at),
    closed_at = case when v_next_agency_state = 'CLOSED_SOLD' then v_observed_at else null end,
    state_confidence = (p_listing #>> '{status,confidence}')::numeric,
    state_reason = jsonb_build_object('sourceStatus', v_status),
    monitoring_phase = case when v_next_agency_state = 'ACTIVE' then 'NONE' else monitoring_phase end,
    post_exit_check_due_at = case when v_next_agency_state = 'ACTIVE' then null else post_exit_check_due_at end,
    next_check_at = case when v_next_agency_state = 'ACTIVE' then null else next_check_at end,
    check_attempt = case when v_next_agency_state = 'ACTIVE' then 0 else check_attempt end
  where id = v_agency_listing_id;

  if v_created_publication and not v_created_property then
    for v_other in
      select * from public.agency_listings
      where property_id = v_property_id and agency_id <> p_agency_id
      for update
    loop
      select mo.override_value #>> '{}'
      into v_manual_state
      from public.manual_overrides mo
      where mo.target_type = 'AGENCY_LISTING'
        and mo.target_id = v_other.id
        and mo.override_key = 'state'
        and mo.effective_at <= v_observed_at
        and not exists(select 1 from public.manual_overrides superseding where superseding.supersedes_id = mo.id)
      order by mo.effective_at desc, mo.created_at desc
      limit 1;
      if v_other.state in ('EXIT_PENDING', 'OFF_MARKET_NO_SALE_EVIDENCE') and v_manual_state is null then
        update public.agency_listings set
          state = 'CLOSED_SWITCHED', closed_at = v_observed_at,
          exit_confirmed_at = v_observed_at, outcome_source = 'CROSS_AGENCY_IDENTITY_V1',
          outcome_confidence = v_identity_score, monitoring_phase = 'COMPLETE',
          post_exit_check_due_at = null, next_check_at = null
        where id = v_other.id;
        perform public.insert_property_lifecycle_event_atomic(
          v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
          'AGENCY_SWITCH_DETECTED', v_observed_at,
          v_publication_id || ':AGENCY_SWITCH_DETECTED:' || v_other.id,
          v_identity_score, 'SYSTEM', jsonb_build_object('previousAgencyListingIds', jsonb_build_array(v_other.id)), v_evidence_ids
        );
      elsif v_other.state = 'ACTIVE' then
        perform public.insert_property_lifecycle_event_atomic(
          v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
          'MULTI_AGENCY_PUBLICATION_OBSERVED', v_observed_at,
          v_publication_id || ':MULTI_AGENCY_PUBLICATION_OBSERVED:' || v_other.id,
          v_identity_score, 'SYSTEM', jsonb_build_object('otherAgencyListingIds', jsonb_build_array(v_other.id)), v_evidence_ids
        );
      end if;
      v_manual_state := null;
    end loop;
  end if;

  select mo.override_value #>> '{}'
  into v_manual_sale_status
  from public.manual_overrides mo
  where mo.target_type = 'PROPERTY' and mo.target_id = v_property_id
    and mo.override_key = 'sale_status' and mo.effective_at <= v_observed_at
    and not exists(select 1 from public.manual_overrides superseding where superseding.supersedes_id = mo.id)
  order by mo.effective_at desc, mo.created_at desc limit 1;

  select count(*) into v_other_active_count
  from public.publications p
  join public.agency_listings al on al.id = p.agency_listing_id
  where al.property_id = v_property_id and p.id <> v_publication_id and p.state = 'ACTIVE';
  if v_manual_sale_status is not null then
    v_sale_status := v_manual_sale_status;
  elsif (v_status = 'SOLD' or v_sold_graphic) and v_other_active_count > 0 then
    v_sale_status := 'PROBABLE_SOLD'; v_sale_conflict := true;
  elsif v_sold_graphic and v_status is not null and v_status not in ('SOLD', 'UNKNOWN') then
    -- The source states this listing is not sold (typically NEGOTIATION) while an
    -- asset carries a sold overlay. A graphic alone must not overrule an explicit
    -- source status, so record the weaker claim and let a human decide.
    v_sale_status := 'PROBABLE_SOLD'; v_sale_conflict := true;
  elsif v_status = 'SOLD' or v_sold_graphic then
    v_sale_status := 'SOLD_CONFIRMED';
  else
    v_sale_status := 'UNKNOWN';
  end if;
  update public.properties set sale_status = v_sale_status where id = v_property_id;
  if v_sale_conflict then
    insert into public.review_queue (
      review_type, status, property_id, publication_id, title, details, dedupe_key
    ) values (
      'LIFECYCLE', 'OPEN', v_property_id, v_publication_id,
      'Conflicting sold and active-publication evidence',
      jsonb_build_object('status', v_sale_status, 'requiresReview', true),
      'sale-conflict:' || v_property_id
    ) on conflict (dedupe_key) do update set status = 'OPEN', details = excluded.details, updated_at = now();
  end if;

  perform public.refresh_property_lifecycle_intelligence_atomic(v_property_id, v_observed_at);
  update public.sync_runs
  set observation_commit_count = observation_commit_count + 1
  where id = p_sync_run_id;

  return jsonb_build_object(
    'propertyId', v_property_id,
    'agencyListingId', v_agency_listing_id,
    'publicationId', v_publication_id,
    'snapshotId', v_snapshot_id,
    'createdProperty', v_created_property,
    'createdPublication', v_created_publication,
    'replayed', false,
    'candidateCount', v_candidate_count
  );
end;
$$;

comment on function public.persist_property_lifecycle_observation_atomic(uuid, uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb, text) is
  'Applies a V2 observation atomically; p_failure_point is reserved for rollback tests.';


-- -----------------------------------------------------------------------------
-- Derived from 033_property_lifecycle_geography_decision.sql
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- Derived from 034_property_worker_acquisition_provenance.sql
-- -----------------------------------------------------------------------------
-- Un'acquisizione conservata deve sapere da dove viene.
--
-- Finora una ricerca salvata portava con sé il luogo e due conteggi: aprendola
-- una settimana dopo non si poteva sapere se era nata da un civico, da una via
-- o da una rete di proprietari, né con quali limiti era stata raccolta. Con tre
-- sole acquisizioni in archivio, quello che le distingue conta più di prima.
--
-- `acquisition` tiene i fattori della raccolta: il tipo di run, i parametri con
-- cui è girata, cosa ha scartato, e la modalità di attività scelta quando i
-- dati sono stati presi — che è quella con cui vanno importati, non quella
-- impostata il giorno in cui premi «Importa».

alter table public.property_worker_jobs
  add column if not exists acquisition jsonb;

comment on column public.property_worker_jobs.acquisition is
  'Provenienza e parametri della raccolta conservata: kind, settings, skipped, activityMode.';


-- -----------------------------------------------------------------------------
-- Derived from 035_lifecycle_read_performance.sql
-- -----------------------------------------------------------------------------
-- Lettura dell'archivio V2 in una sola andata e ritorno.
--
-- Ogni elenco di case ricostruiva la stessa scheda con quattro ondate di query
-- in fila: le proprietà, poi gli incarichi di agenzia e le pubblicazioni
-- private, poi le agenzie e le publication, e infine gli snapshot. L'ultima
-- ondata era la più cara: chiedeva fino a duemila snapshot per ogni blocco di
-- settantacinque publication — cioè tutta la storia dei prezzi — per usarne
-- soltanto il più recente. Su mille case significava scaricare decine di
-- migliaia di righe per mostrarne sessanta, a ogni singola visita.
--
-- `lifecycle_property_hydration` fa lo stesso lavoro dentro Postgres e
-- restituisce una riga per casa: le agenzie che la tengono, l'ultimo snapshot,
-- l'ultima pubblicazione privata e quante ne sono ancora attive. La scelta fra
-- snapshot e privato resta in TypeScript, dov'è testata.
--
-- La funzione riceve gli id in POST: sparisce anche il batch da settantacinque,
-- che esisteva solo per non sforare la lunghezza della URI in GET.

-- `agency_listings` si interroga per property_id a ogni idratazione, ma
-- l'indice esisteva solo su (agency_id, state): era una scansione piena.
create index if not exists agency_listings_property_idx
  on public.agency_listings (property_id);

-- Le opportunità si leggono per casa nella scheda e nell'archivio.
create index if not exists opportunities_property_idx
  on public.opportunities (property_id, detected_at desc);

create or replace function public.lifecycle_property_hydration(p_ids uuid[])
returns table (
  property_id uuid,
  agency_refs jsonb,
  latest_snapshot jsonb,
  latest_private jsonb,
  active_private_count integer
)
language sql
stable
as $$
  with wanted as (
    select distinct pid from unnest(p_ids) as elenco(pid)
  ),
  refs as (
    select
      al.property_id as pid,
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'slug', a.slug,
          'name', a.name,
          'listingId', al.id,
          'state', al.state,
          'reference', al.agency_reference,
          'firstSeenAt', al.first_seen_at,
          'lastSeenAt', al.last_seen_at
        )
        order by al.last_seen_at desc, al.id
      ) as refs
    from public.agency_listings al
    join public.agencies a on a.id = al.agency_id
    where al.property_id = any(p_ids)
    group by al.property_id
  ),
  snap as (
    select distinct on (al.property_id)
      al.property_id as pid,
      jsonb_build_object(
        'title', s.title,
        'price_amount', s.price_amount,
        'surface_sqm', s.surface_sqm,
        'rooms', s.rooms,
        'observed_at', s.observed_at
      ) as snapshot
    from public.agency_listings al
    join public.publications p on p.agency_listing_id = al.id
    join public.snapshots s on s.publication_id = p.id
    where al.property_id = any(p_ids)
    order by al.property_id, s.observed_at desc
  ),
  priv as (
    select
      pp.property_id as pid,
      (array_agg(
        jsonb_build_object(
          'title', pp.title,
          'price_amount', pp.price_amount,
          'surface_sqm', pp.surface_sqm,
          'rooms', pp.rooms,
          'last_seen_at', pp.last_seen_at
        )
        order by pp.last_seen_at desc, pp.id
      ))[1] as latest,
      (count(*) filter (where pp.state = 'ACTIVE'))::integer as active_count
    from public.private_publications pp
    where pp.property_id = any(p_ids)
    group by pp.property_id
  )
  select
    wanted.pid,
    coalesce(refs.refs, '[]'::jsonb),
    snap.snapshot,
    priv.latest,
    coalesce(priv.active_count, 0)
  from wanted
  left join refs on refs.pid = wanted.pid
  left join snap on snap.pid = wanted.pid
  left join priv on priv.pid = wanted.pid;
$$;

comment on function public.lifecycle_property_hydration(uuid[]) is
  'Idratazione di un elenco di PROPERTY: agenzie, ultimo snapshot, ultima pubblicazione privata e privati attivi, in una sola richiesta.';

grant execute on function public.lifecycle_property_hydration(uuid[]) to authenticated, service_role;

-- «Di chi ti puoi fidare oggi», senza scaricare l'inventario.
--
-- La scheda delle fonti conta gli incarichi per stato, e per farlo si portava
-- a casa una riga per ogni incarico di ogni agenzia, più mille controlli di
-- salute e mille run di sincronizzazione, per tenere di ciascuno soltanto il
-- più recente. È una domanda da tre numeri per agenzia: ora la risponde
-- Postgres, e torna una riga per agenzia.

create or replace function public.lifecycle_agency_overview()
returns table (
  id uuid,
  slug text,
  name text,
  website_url text,
  enabled boolean,
  active_count integer,
  exited_count integer,
  sold_count integer,
  latest_health jsonb,
  latest_run jsonb
)
language sql
stable
as $$
  with conteggi as (
    select
      al.agency_id,
      (count(*) filter (where al.state = 'ACTIVE'))::integer as active_count,
      (count(*) filter (
        where al.state in (
          'EXIT_PENDING',
          'CLOSED_SWITCHED',
          'CLOSED_TO_PRIVATE',
          'CLOSED_WITHDRAWN',
          'OFF_MARKET_NO_SALE_EVIDENCE'
        )
      ))::integer as exited_count,
      (count(*) filter (where al.state = 'CLOSED_SOLD'))::integer as sold_count
    from public.agency_listings al
    group by al.agency_id
  ),
  salute as (
    select distinct on (h.agency_id)
      h.agency_id,
      jsonb_build_object('state', h.state, 'checked_at', h.checked_at) as latest
    from public.adapter_health h
    order by h.agency_id, h.checked_at desc
  ),
  corse as (
    select distinct on (r.agency_id)
      r.agency_id,
      jsonb_build_object(
        'status', r.status,
        'started_at', r.started_at,
        'finished_at', r.finished_at,
        'discovered_count', r.discovered_count,
        'in_scope_count', r.in_scope_count,
        'excluded_count', r.excluded_count,
        'error_count', r.error_count
      ) as latest
    from public.sync_runs r
    order by r.agency_id, r.started_at desc
  )
  select
    a.id,
    a.slug,
    a.name,
    a.website_url,
    a.enabled,
    coalesce(conteggi.active_count, 0),
    coalesce(conteggi.exited_count, 0),
    coalesce(conteggi.sold_count, 0),
    salute.latest,
    corse.latest
  from public.agencies a
  left join conteggi on conteggi.agency_id = a.id
  left join salute on salute.agency_id = a.id
  left join corse on corse.agency_id = a.id
  order by a.name;
$$;

comment on function public.lifecycle_agency_overview() is
  'Riepilogo per agenzia: incarichi contati per stato, ultimo controllo di salute e ultima sincronizzazione.';

grant execute on function public.lifecycle_agency_overview() to authenticated, service_role;

-- Le due letture «più recente per agenzia» reggono su questi ordini.
create index if not exists adapter_health_agency_checked_idx
  on public.adapter_health (agency_id, checked_at desc);

create index if not exists sync_runs_agency_started_idx
  on public.sync_runs (agency_id, started_at desc);

-- I segnaposti del Territorio, già uniti alla loro posizione.
--
-- La mappa chiedeva duemila case e duemila posizioni e le univa nel browser,
-- per poi buttare via ogni casa senza coordinate: due elenchi interi mandati
-- via rete per disegnarne una parte. L'unione la fa Postgres, e torna solo
-- quello che si può davvero mettere sulla mappa.

create or replace function public.map_property_pins()
returns table (
  id uuid,
  address text,
  price_amount numeric,
  surface_sqm numeric,
  latitude double precision,
  longitude double precision,
  raw_text text,
  street_name text,
  street_number text,
  municipality text
)
language sql
stable
as $$
  select
    p.id,
    p.canonical_attributes->>'address',
    case
      when jsonb_typeof(p.canonical_attributes->'priceAmount') = 'number'
      then (p.canonical_attributes->>'priceAmount')::numeric
    end,
    case
      when jsonb_typeof(p.canonical_attributes->'surfaceSqm') = 'number'
      then (p.canonical_attributes->>'surfaceSqm')::numeric
    end,
    l.latitude,
    l.longitude,
    l.raw_text,
    l.street_name,
    l.street_number,
    l.municipality
  from public.properties p
  join public.locations l on l.id = p.primary_location_id
  where p.identity_status <> 'MERGED'
    and l.latitude is not null
    and l.longitude is not null;
$$;

comment on function public.map_property_pins() is
  'Case osservate con una posizione risolta, pronte da disegnare sulla mappa.';

grant execute on function public.map_property_pins() to authenticated, service_role;

-- Quante case somigliano a ogni richiesta.
--
-- La pagina delle richieste si portava a casa tutti gli abbinamenti
-- compatibili — quasi duemila righe, in pagine da mille una dopo l'altra —
-- per contarli per richiesta. È un conteggio: torna una riga per richiesta.

create or replace function public.matching_compatible_counts()
returns table (request_id uuid, compatible_count integer)
language sql
stable
as $$
  select m.request_id, count(*)::integer
  from public.request_property_matches m
  where m.classification = 'compatible'
  group by m.request_id;
$$;

comment on function public.matching_compatible_counts() is
  'Abbinamenti compatibili contati per richiesta.';

grant execute on function public.matching_compatible_counts() to authenticated, service_role;

create index if not exists request_property_matches_classification_idx
  on public.request_property_matches (classification, request_id);


-- -----------------------------------------------------------------------------
-- Derived from 013_bitonto_property_zone_system.sql (schema only)
-- -----------------------------------------------------------------------------
alter table public.internal_zones
  add column if not exists zone_number smallint;

alter table public.internal_zones
  drop constraint if exists internal_zones_zone_number_check;

alter table public.internal_zones
  add constraint internal_zones_zone_number_check
  check (zone_number is null or zone_number between 1 and 99);

create unique index if not exists internal_zones_zone_number_idx
  on public.internal_zones (zone_number)
  where zone_number is not null;


-- Final atomic observation RPC (migration 032 supersedes migration 030).
revoke all on function public.persist_property_lifecycle_observation_atomic(uuid, uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb, text) from public;
grant execute on function public.persist_property_lifecycle_observation_atomic(uuid, uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb, text) to service_role;
