begin;
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.persist_property_lifecycle_observation_atomic(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text)'::regprocedure) into definition;
 needle:='when exists(select 1 from public.locations where id = property.primary_location_id and manually_verified) then property.primary_location_id';
 if position(needle in definition)=0 then raise exception 'Primary location guard not recognized';end if;
 definition:=replace(definition,needle,needle||E'\n      when p_listing->>''adapterKey'' in (''vistocasa'',''futura'') and exists(select 1 from public.locations old_pin where old_pin.id=property.primary_location_id and old_pin.latitude=nullif(p_listing #>> ''{location,latitude}'','''')::float8 and old_pin.longitude=nullif(p_listing #>> ''{location,longitude}'','''')::float8 and (nullif(p_listing #>> ''{location,streetName}'','''') is null and old_pin.street_name is not null or nullif(p_listing #>> ''{location,streetNumber}'','''') is null and old_pin.street_number is not null and lower(old_pin.street_name)=lower(p_listing #>> ''{location,streetName}''))) then property.primary_location_id');
 needle:='and not exists(select 1 from public.locations where id=property.primary_location_id and manually_verified)';
 if position(needle in definition)=0 then raise exception 'Canonical address guard not recognized';end if;
 definition:=replace(definition,needle,'and not exists(select 1 from public.locations where id=property.primary_location_id and (manually_verified or street_number is not null and nullif(p_listing #>> ''{location,streetNumber}'','''') is null))');
 execute definition;
end$$;
notify pgrst,'reload schema';
commit;
