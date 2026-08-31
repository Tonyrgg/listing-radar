-- Canonical Street Registry for Bitonto and the Property Data Worker.
--
-- Schema only: the municipal inventory, geometry enrichment and ranking are
-- imported by dedicated scripts. This migration deliberately does not copy
-- legacy map_streets or internal_zones.associated_streets into the registry.

create extension if not exists pgcrypto;

create table if not exists public.street_registry_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  authority text not null,
  dataset_name text not null,
  source_url text not null,
  license text,
  last_fetched_at timestamptz,
  last_content_sha256 text,
  last_record_count integer
    check (last_record_count is null or last_record_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint street_registry_sources_sha256_check check (
    last_content_sha256 is null
    or last_content_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create table if not exists public.street_registry_import_runs (
  id uuid primary key default gen_random_uuid(),

  source_id uuid not null
    references public.street_registry_sources(id)
    on delete restrict,

  import_kind text not null
    check (
      import_kind in (
        'official_inventory',
        'geometry',
        'metrics',
        'zone_assignment'
      )
    ),

  status text not null default 'running'
    check (
      status in (
        'running',
        'completed',
        'completed_with_warnings',
        'failed'
      )
    ),

  content_sha256 text,

  source_record_count integer not null default 0
    check (source_record_count >= 0),

  inserted_count integer not null default 0
    check (inserted_count >= 0),

  updated_count integer not null default 0
    check (updated_count >= 0),

  unchanged_count integer not null default 0
    check (unchanged_count >= 0),

  warning_count integer not null default 0
    check (warning_count >= 0),

  error_message text,
  details jsonb not null default '{}'::jsonb,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint street_registry_import_runs_sha256_check check (
    content_sha256 is null
    or content_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists street_registry_import_runs_source_idx
  on public.street_registry_import_runs (source_id, started_at desc);


create table if not exists public.street_registry_centers (
  id uuid primary key default gen_random_uuid(),

  scope text not null
    check (scope in ('city', 'zone')),

  municipality text not null default 'BITONTO',

  zone_id uuid
    references public.internal_zones(id)
    on delete cascade,

  name text not null,

  latitude numeric not null
    check (latitude between -90 and 90),

  longitude numeric not null
    check (longitude between -180 and 180),

  method text not null
    check (
      method in (
        'official_landmark',
        'zone_geometry',
        'manual',
        'supporting_geocoder'
      )
    ),

  source_id uuid
    references public.street_registry_sources(id)
    on delete set null,

  source_reference text,

  is_active boolean not null default true,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint street_registry_centers_scope_zone_consistency_check check (
    (scope = 'city' and zone_id is null)
    or
    (scope = 'zone' and zone_id is not null)
  )
);

create unique index if not exists street_registry_centers_city_unique_idx
  on public.street_registry_centers (lower(municipality))
  where scope = 'city'
    and is_active;

create unique index if not exists street_registry_centers_zone_unique_idx
  on public.street_registry_centers (zone_id)
  where scope = 'zone'
    and is_active;

create table if not exists public.street_registry_streets (
  id uuid primary key default gen_random_uuid(),

  official_code text not null unique,
  municipality text not null default 'BITONTO',
  locality text,

  official_type text not null default '',
  official_description text not null,
  canonical_name text not null,
  normalized_name text not null,
  sister_search_name text not null,

  record_status text not null default 'active'
    check (record_status in ('active', 'needs_review', 'retired')),

  source_payload jsonb not null default '{}'::jsonb,

  source_id uuid
    references public.street_registry_sources(id)
    on delete set null,

  last_seen_import_id uuid
    references public.street_registry_import_runs(id)
    on delete set null,

  geometry jsonb,

  geometry_source_id uuid
    references public.street_registry_sources(id)
    on delete set null,

  geometry_match_status text not null default 'unresolved'
    check (
      geometry_match_status in (
        'unresolved',
        'exact',
        'manual',
        'ambiguous',
        'rejected'
      )
    ),

  geometry_match_metadata jsonb not null default '{}'::jsonb,
  geometry_matched_at timestamptz,

  centroid_latitude numeric
    check (centroid_latitude is null or centroid_latitude between -90 and 90),
  centroid_longitude numeric
    check (centroid_longitude is null or centroid_longitude between -180 and 180),

  length_m numeric check (length_m is null or length_m >= 0),
  city_distance_m numeric check (city_distance_m is null or city_distance_m >= 0),
  city_rank integer check (city_rank is null or city_rank >= 1),
  -- La corona e a base zero: la 0 sono i primi 250 metri dal centro.
  city_ring integer check (city_ring is null or city_ring >= 0),

  metrics_version integer,
  metrics_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint street_registry_streets_geometry_type_check check (
    geometry is null
    or geometry->>'type' in ('LineString', 'MultiLineString')
  ),

  constraint street_registry_streets_geometry_provenance_check check (
    geometry is null
    or geometry_match_status in ('exact', 'manual')
  )
);

create index if not exists street_registry_streets_normalized_name_idx
  on public.street_registry_streets (normalized_name);

create index if not exists street_registry_streets_city_rank_idx
  on public.street_registry_streets (city_rank)
  where record_status = 'active';

create index if not exists street_registry_streets_locality_idx
  on public.street_registry_streets (locality)
  where locality is not null;


create table if not exists public.street_registry_street_zones (
  street_id uuid not null
    references public.street_registry_streets(id)
    on delete cascade,

  zone_id uuid not null
    references public.internal_zones(id)
    on delete cascade,

  is_primary boolean not null default false,

  assignment_method text not null
    check (
      assignment_method in (
        'manual',
        'official',
        'geometry_intersection',
        'nearest_center',
        'associated_street_seed'
      )
    ),

  confidence numeric
    check (confidence is null or confidence between 0 and 1),

  source_id uuid
    references public.street_registry_sources(id)
    on delete set null,

  zone_distance_m numeric check (zone_distance_m is null or zone_distance_m >= 0),
  zone_rank integer check (zone_rank is null or zone_rank >= 1),
  zone_ring integer check (zone_ring is null or zone_ring >= 0),

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (street_id, zone_id)
);

create unique index if not exists street_registry_street_zones_primary_idx
  on public.street_registry_street_zones (street_id)
  where is_primary;

create index if not exists street_registry_street_zones_zone_rank_idx
  on public.street_registry_street_zones (zone_id, zone_rank);


create table if not exists public.street_registry_work_items (
  id uuid primary key default gen_random_uuid(),

  street_id uuid not null
    references public.street_registry_streets(id)
    on delete cascade,

  workflow text not null default 'owner_network'
    check (workflow in ('owner_network')),

  work_status text not null default 'pending'
    check (
      work_status in (
        'pending',
        'in_progress',
        'completed',
        'to_recheck',
        'skipped',
        'failed'
      )
    ),

  priority integer not null default 0,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),

  worker_id text,
  lease_expires_at timestamptz,

  last_job_id uuid
    references public.property_worker_jobs(id)
    on delete set null,

  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_result jsonb,
  last_error jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint street_registry_work_items_street_workflow_key
    unique (street_id, workflow),

  constraint street_registry_work_items_lease_check check (
    (work_status = 'in_progress' and worker_id is not null and lease_expires_at is not null)
    or (work_status <> 'in_progress' and worker_id is null and lease_expires_at is null)
  )
);

create index if not exists street_registry_work_items_status_idx
  on public.street_registry_work_items (work_status, priority desc);

create index if not exists street_registry_work_items_lease_idx
  on public.street_registry_work_items (lease_expires_at)
  where work_status = 'in_progress';


drop trigger if exists set_street_registry_sources_updated_at on public.street_registry_sources;
create trigger set_street_registry_sources_updated_at
before update on public.street_registry_sources
for each row
execute function public.set_updated_at();

drop trigger if exists set_street_registry_centers_updated_at on public.street_registry_centers;
create trigger set_street_registry_centers_updated_at
before update on public.street_registry_centers
for each row
execute function public.set_updated_at();

drop trigger if exists set_street_registry_streets_updated_at on public.street_registry_streets;
create trigger set_street_registry_streets_updated_at
before update on public.street_registry_streets
for each row
execute function public.set_updated_at();

drop trigger if exists set_street_registry_street_zones_updated_at on public.street_registry_street_zones;
create trigger set_street_registry_street_zones_updated_at
before update on public.street_registry_street_zones
for each row
execute function public.set_updated_at();

drop trigger if exists set_street_registry_work_items_updated_at on public.street_registry_work_items;
create trigger set_street_registry_work_items_updated_at
before update on public.street_registry_work_items
for each row
execute function public.set_updated_at();


create or replace view public.street_registry_worker_queue
with (security_invoker = true) as
select
  work.id as work_item_id,
  work.workflow,
  work.work_status,
  work.priority,
  work.attempts,
  work.max_attempts,
  work.worker_id,
  work.lease_expires_at,
  work.last_job_id,
  work.last_started_at,
  work.last_completed_at,
  work.last_result,
  work.last_error,

  street.id as street_id,
  street.official_code,
  street.municipality,
  street.locality,
  street.canonical_name,
  street.normalized_name,
  street.sister_search_name,
  street.geometry_match_status,
  street.centroid_latitude,
  street.centroid_longitude,
  street.city_distance_m,
  street.city_rank,
  street.city_ring,

  link.zone_id,
  zone.zone_number,
  zone.name as zone_name,
  link.assignment_method as zone_assignment_method,
  link.confidence as zone_assignment_confidence,
  link.zone_distance_m,
  link.zone_rank,
  link.zone_ring
from public.street_registry_work_items work
join public.street_registry_streets street
  on street.id = work.street_id
left join public.street_registry_street_zones link
  on link.street_id = street.id
  and link.is_primary
left join public.internal_zones zone
  on zone.id = link.zone_id;


create or replace function public.claim_street_registry_work(
  p_worker_id text,
  p_zone_id uuid default null,
  p_order_scope text default 'city',
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_item_id uuid;
  v_row jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'Identificativo Worker mancante';
  end if;
  if p_order_scope not in ('city', 'zone') then
    raise exception 'Ordinamento non valido: %', p_order_scope;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 21600 then
    raise exception 'Durata lease non valida: %', p_lease_seconds;
  end if;

  select work.id
  into v_work_item_id
  from public.street_registry_work_items work
  join public.street_registry_streets street
    on street.id = work.street_id
  left join public.street_registry_street_zones link
    on link.street_id = street.id
    and link.is_primary
  where work.workflow = 'owner_network'
    and street.record_status = 'active'
    and work.attempts < work.max_attempts
    and (
      work.work_status in ('pending', 'to_recheck')
      or (work.work_status = 'in_progress' and work.lease_expires_at < now())
    )
    and (p_zone_id is null or link.zone_id = p_zone_id)
  order by
    work.priority desc,
    case when p_order_scope = 'zone' then link.zone_rank else street.city_rank end
      asc nulls last,
    street.official_code asc
  limit 1
  for update of work skip locked;

  if v_work_item_id is null then
    return null;
  end if;

  update public.street_registry_work_items
  set work_status = 'in_progress',
      worker_id = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      last_started_at = now()
  where id = v_work_item_id;

  select to_jsonb(queue)
  into v_row
  from public.street_registry_worker_queue queue
  where queue.work_item_id = v_work_item_id;

  return v_row;
end;
$$;


create or replace function public.complete_street_registry_work(
  p_work_item_id uuid,
  p_worker_id text,
  p_outcome text,
  p_property_worker_job_id uuid default null,
  p_result jsonb default null,
  p_error jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.street_registry_work_items;
  v_row jsonb;
begin
  if p_outcome not in ('completed', 'to_recheck', 'skipped', 'failed') then
    raise exception 'Esito non valido: %', p_outcome;
  end if;

  select *
  into v_current
  from public.street_registry_work_items
  where id = p_work_item_id
  for update;

  if not found then
    raise exception 'Lavorazione via inesistente: %', p_work_item_id;
  end if;
  if v_current.work_status <> 'in_progress' then
    raise exception 'La lavorazione % non risulta presa in carico', p_work_item_id;
  end if;
  if v_current.worker_id is distinct from p_worker_id then
    raise exception 'La lavorazione % appartiene a un altro Worker', p_work_item_id;
  end if;

  update public.street_registry_work_items
  set work_status = p_outcome,
      worker_id = null,
      lease_expires_at = null,
      last_completed_at = now(),
      last_job_id = coalesce(p_property_worker_job_id, last_job_id),
      last_result = case when p_result is null then last_result else p_result end,
      last_error = case when p_outcome in ('completed', 'skipped') then null else p_error end
  where id = p_work_item_id;

  select to_jsonb(queue)
  into v_row
  from public.street_registry_worker_queue queue
  where queue.work_item_id = p_work_item_id;

  return v_row;
end;
$$;


alter table public.street_registry_sources enable row level security;
alter table public.street_registry_import_runs enable row level security;
alter table public.street_registry_centers enable row level security;
alter table public.street_registry_streets enable row level security;
alter table public.street_registry_street_zones enable row level security;
alter table public.street_registry_work_items enable row level security;

drop policy if exists "authenticated select street_registry_sources" on public.street_registry_sources;
create policy "authenticated select street_registry_sources"
  on public.street_registry_sources for select to authenticated using (true);

drop policy if exists "authenticated select street_registry_import_runs" on public.street_registry_import_runs;
create policy "authenticated select street_registry_import_runs"
  on public.street_registry_import_runs for select to authenticated using (true);

drop policy if exists "authenticated select street_registry_centers" on public.street_registry_centers;
create policy "authenticated select street_registry_centers"
  on public.street_registry_centers for select to authenticated using (true);

drop policy if exists "authenticated select street_registry_streets" on public.street_registry_streets;
create policy "authenticated select street_registry_streets"
  on public.street_registry_streets for select to authenticated using (true);

drop policy if exists "authenticated select street_registry_street_zones" on public.street_registry_street_zones;
create policy "authenticated select street_registry_street_zones"
  on public.street_registry_street_zones for select to authenticated using (true);

drop policy if exists "authenticated select street_registry_work_items" on public.street_registry_work_items;
create policy "authenticated select street_registry_work_items"
  on public.street_registry_work_items for select to authenticated using (true);

revoke all on public.street_registry_sources from anon;
revoke all on public.street_registry_import_runs from anon;
revoke all on public.street_registry_centers from anon;
revoke all on public.street_registry_streets from anon;
revoke all on public.street_registry_street_zones from anon;
revoke all on public.street_registry_work_items from anon;
revoke all on public.street_registry_worker_queue from anon;

grant select on public.street_registry_worker_queue to authenticated;

revoke all on function public.claim_street_registry_work(text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_street_registry_work(uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claim_street_registry_work(text, uuid, text, integer) to service_role;
grant execute on function public.complete_street_registry_work(uuid, text, text, uuid, jsonb, jsonb) to service_role;

comment on table public.street_registry_streets is
  'Inventario canonico delle aree di circolazione: Codvia e identita stabile, geometria con provenienza, metriche citta.';
comment on table public.street_registry_street_zones is
  'Relazione via-zona molti-a-molti con una sola zona primaria e metriche per zona. nearest_center e una stima operativa.';
comment on table public.street_registry_work_items is
  'Coda durevole di Rete proprietari: una lavorazione per via attiva, presa in carico con lease.';
comment on view public.street_registry_worker_queue is
  'Vista di lettura per il Property Worker: lavorazione, via e zona primaria in una riga.';
