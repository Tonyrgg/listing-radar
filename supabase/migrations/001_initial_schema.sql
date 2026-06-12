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
