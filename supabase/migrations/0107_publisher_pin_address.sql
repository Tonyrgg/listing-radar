begin;
create table public.publisher_pin_address_cache(pin_key text primary key,payload jsonb not null,queried_at timestamptz not null default now());
alter table public.publisher_pin_address_cache enable row level security;
revoke all on public.publisher_pin_address_cache from anon,authenticated;
grant all on public.publisher_pin_address_cache to service_role;
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.persist_property_lifecycle_observation_atomic(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text)'::regprocedure) into definition;
 needle:='when exists(select 1 from public.locations where id = property.primary_location_id and manually_verified) then property.primary_location_id';
 if position(needle in definition)=0 then raise exception 'Primary location guard not recognized';end if;
 definition:=replace(definition,needle,needle||E'\n      when p_listing->>''adapterKey'' in (''vistocasa'',''futura'') and jsonb_typeof(p_listing #> ''{provenance,publishedMapPin}'') = ''object'' then v_location_id');
 needle:='property.canonical_attributes->''address'',';
 if position(needle in definition)=0 then raise exception 'Address guard not recognized';end if;
 definition:=replace(definition,needle,E'case when p_listing->>''adapterKey'' in (''vistocasa'',''futura'') and nullif(p_listing #>> ''{location,streetName}'','''') is not null and not exists(select 1 from public.locations where id=property.primary_location_id and manually_verified) then null else property.canonical_attributes->''address'' end,');
 execute definition;
end$$;
notify pgrst,'reload schema';
commit;
