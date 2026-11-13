begin;
set local statement_timeout='120s';
set local lock_timeout='3s';
-- Keep archive presence distinct from publication and mandate dates, while
-- including verified captures in the existing small indexed tenure projection.
do $$declare definition text; updated text; refresh_definition text; begin
 definition:=pg_get_viewdef('public.radar_agency_tenure_cache'::regclass,true);
 updated:=replace(definition,'''publication.sourceRecordCreatedAt''','''publication.sourceRecordCreatedAt'', ''publication.archivedPresence''');
 if updated=definition then raise exception 'Agency tenure definition has changed: historical claim cannot be added safely';end if;
 execute 'create materialized view public.radar_agency_tenure_cache_v2 as '||updated;
 execute 'create unique index radar_agency_tenure_cache_v2_id on public.radar_agency_tenure_cache_v2(agency_listing_id)';
 execute 'revoke all on public.radar_agency_tenure_cache_v2 from public,anon';
 execute 'grant select on public.radar_agency_tenure_cache_v2 to authenticated,service_role';
 execute 'create or replace view public.radar_agency_tenure with(security_invoker=true) as select * from public.radar_agency_tenure_cache_v2';
 refresh_definition:=pg_get_functiondef('public.refresh_radar_read_model()'::regprocedure);
 execute replace(refresh_definition,'public.radar_agency_tenure_cache;','public.radar_agency_tenure_cache_v2;');
end $$;
drop materialized view public.radar_agency_tenure_cache;
update public.radar_read_model_state set source_revision=source_revision+1 where singleton;
notify pgrst,'reload schema';
commit;
