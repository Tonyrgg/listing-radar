-- Live read measurement after 0035: OR/EXISTS civic context took ~6.7s for 5 rows.
-- Same semantics and history, indexable joins instead of a building/property cross scan.
begin;
create function public.public_record_civic_key(value text) returns text
language sql immutable parallel safe set search_path=public as $$
 select regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]','','g')
$$;
create index public_records_location_context_idx on public.locations(
 public.public_record_street_key(street_name),public.public_record_civic_key(street_number),
 lower(coalesce(locality,municipality,''))) where lower(municipality)='bitonto' and coalesce(street_number,'')<>'';
create index public_records_property_location_idx on public.properties(primary_location_id) where identity_status<>'MERGED';
create index public_records_building_location_idx on public.buildings(location_id);
create or replace view public.market_observer_building_properties with(security_invoker=true) as
select b.id building_id,p.id property_id,'BUILDING'::text relation_scope,'REVIEW_REQUIRED'::text unit_match
from public.properties p join public.buildings b on b.id=p.building_id where p.identity_status<>'MERGED'
union
select b.id,p.id,'BUILDING'::text,'REVIEW_REQUIRED'::text
from public.properties p join public.locations pl on pl.id=p.primary_location_id
join public.locations bl on public.public_record_street_key(pl.street_name)=public.public_record_street_key(bl.street_name)
 and public.public_record_civic_key(pl.street_number)=public.public_record_civic_key(bl.street_number)
 and lower(coalesce(pl.locality,pl.municipality,''))=lower(coalesce(bl.locality,bl.municipality,''))
join public.buildings b on b.location_id=bl.id
where p.identity_status<>'MERGED' and lower(pl.municipality)='bitonto' and coalesce(pl.street_number,'')<>'';
notify pgrst,'reload schema';
commit;
