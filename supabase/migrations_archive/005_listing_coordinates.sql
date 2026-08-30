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
