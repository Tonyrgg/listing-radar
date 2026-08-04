-- Abilita la posizione puntuale degli immobili.

alter table public.portfolio_properties
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

create index if not exists portfolio_properties_coordinates_idx
  on public.portfolio_properties (latitude, longitude)
  where latitude is not null and longitude is not null;
