begin;
-- Missing fields on a subsequent crawl are not an explicit correction.
create or replace function public.retain_known_location_values() returns trigger language plpgsql set search_path=public as $$
begin
 if old.manually_verified then return new; end if;
 if (new.latitude is null or new.longitude is null) and old.latitude is not null and old.longitude is not null and old.evidence_source <> 'admaiora' then
  new.latitude:=old.latitude;new.longitude:=old.longitude;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('retainedCoordinates',jsonb_build_object('reason','missing_in_latest_reading','evidenceSource',old.evidence_source,'priorMetadata',old.metadata-'retainedCoordinates'));
 end if;
 new.street_name:=coalesce(nullif(trim(new.street_name),''),old.street_name);
 new.street_number:=coalesce(nullif(trim(new.street_number),''),old.street_number);
 return new;
end $$;
create trigger retain_known_location_values before update on public.locations for each row execute function public.retain_known_location_values();
create or replace function public.retain_known_property_values() returns trigger language plpgsql set search_path=public as $$
declare k text;
begin
 foreach k in array array['address','locality','latitude','longitude','coordinatePrecision','streetName','streetNumber','publisherName'] loop
  if new.canonical_attributes->k is null or new.canonical_attributes->k='null'::jsonb or new.canonical_attributes->k='""'::jsonb then
   if old.canonical_attributes->k is not null then new.canonical_attributes:=jsonb_set(new.canonical_attributes,array[k],old.canonical_attributes->k);end if;
  end if;
 end loop;
 return new;
end $$;
create trigger retain_known_property_values before update on public.properties for each row execute function public.retain_known_property_values();
notify pgrst,'reload schema';
commit;
