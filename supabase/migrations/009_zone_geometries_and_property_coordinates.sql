-- Collega le zone operative ai poligoni della mappa e abilita la posizione
-- puntuale degli immobili.

alter table public.portfolio_properties
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

create index if not exists portfolio_properties_coordinates_idx
  on public.portfolio_properties (latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists internal_zones_map_area_id_idx
  on public.internal_zones (map_area_id)
  where map_area_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'internal_zones_map_area_id_fkey'
  ) then
    alter table public.internal_zones
      add constraint internal_zones_map_area_id_fkey
      foreign key (map_area_id)
      references public.map_areas(id)
      on delete set null;
  end if;
end $$;

-- Recupera i collegamenti già riconoscibili dalle aree disegnate nella mappa.
update public.internal_zones zone
set map_area_id = area.id
from public.map_areas area
where zone.map_area_id is null
  and (
    lower(area.name) = lower(zone.name)
    or lower(area.name) like '%' || lower(regexp_replace(zone.name, '^Zona[[:space:]]+', '', 'i')) || '%'
    or lower(area.name) like '%' || lower(regexp_replace(zone.name, '^Centro[[:space:]]+', '', 'i')) || '%'
  );
