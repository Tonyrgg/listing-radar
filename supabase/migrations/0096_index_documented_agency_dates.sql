begin;
-- Evidence includes the remote archive. Reconstruct once per ingestion refresh,
-- never rescan all historical evidence for each page or column sort.
do $$begin
 execute 'create materialized view public.radar_agency_tenure_cache as '||pg_get_viewdef('public.radar_agency_tenure'::regclass,true);
end $$;
create unique index radar_agency_tenure_cache_id on public.radar_agency_tenure_cache(agency_listing_id);
revoke all on public.radar_agency_tenure_cache from public,anon;
grant select on public.radar_agency_tenure_cache to authenticated,service_role;
create or replace view public.radar_agency_tenure with(security_invoker=true) as select * from public.radar_agency_tenure_cache;
create or replace function public.refresh_radar_read_model() returns boolean language plpgsql security definer set search_path='' set statement_timeout='120s' set lock_timeout='3s' set jit='off' as $$
declare target bigint;refreshed bigint;at timestamptz;
begin
 if not pg_try_advisory_xact_lock(780031083) then return false;end if;
 select source_revision,refreshed_revision,refreshed_at into target,refreshed,at from public.radar_read_model_state where singleton;
 if target=refreshed and at::date=current_date then return true;end if;
 begin
  refresh materialized view concurrently public.radar_agency_tenure_cache;
  refresh materialized view concurrently public.radar_property_read_model;
  update public.radar_read_model_state set refreshed_revision=target,refreshed_at=clock_timestamp(),last_error=null,attempted_at=clock_timestamp() where singleton;
  return true;
 exception when others then
  update public.radar_read_model_state set last_error=sqlstate,attempted_at=clock_timestamp() where singleton;
  return false;
 end;
end $$;
revoke all on function public.refresh_radar_read_model() from public,anon,authenticated;
grant execute on function public.refresh_radar_read_model() to service_role;
commit;
