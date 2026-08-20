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

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'property-lifecycle-visuals',
  'property-lifecycle-visuals',
  false,
  1048576,
  array['image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
