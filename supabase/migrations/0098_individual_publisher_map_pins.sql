begin;
-- A property-specific publisher pin replaces a former shared area location at
-- equal precision. Human-verified and more precise positions keep precedence.
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.persist_property_lifecycle_observation_atomic(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text)'::regprocedure) into definition;
 needle:='when exists(select 1 from public.locations where id = property.primary_location_id and manually_verified) then property.primary_location_id';
 if position(needle in definition)=0 then raise exception 'Primary location guard not recognized';end if;
 if position('publisher_pin_individual_location' in definition)>0 then raise exception 'Publisher pin migration already applied';end if;
 definition:=replace(definition,needle,needle||E'\n      -- publisher_pin_individual_location\n      when p_listing->>''adapterKey'' = ''vistocasa''\n        and jsonb_typeof(p_listing #> ''{provenance,publishedMapPin}'') = ''object''\n        and exists(select 1 from public.locations old_location\n          where old_location.id = property.primary_location_id\n          and old_location.evidence_source = ''vistocasa''\n          and old_location.precision_level = p_listing #>> ''{location,precision}''\n          and old_location.precision_level in (''APPROXIMATE_AREA'',''STREET_ONLY''))\n      then v_location_id');
 execute definition;
end$$;
notify pgrst,'reload schema';
commit;
