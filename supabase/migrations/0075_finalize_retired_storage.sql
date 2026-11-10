begin;
-- Preserve the first export as an immutable diagnostic snapshot. Corrected raw
-- values have priority, without modifying any already committed archive row.
do $$declare d text;begin
 select pg_get_functiondef('public.retire_unused_snapshot_components(text)'::regprocedure)into d;
 d:=replace(d,$old$select row_id::bigint,payload from radar_external.retired_rows where source=src and dataset=ds and table_name='snapshot_components'$old$,$new$select distinct on(row_id) row_id::bigint,payload from radar_external.retired_rows where source=src and dataset in(ds,'retired-components-raw-2026-11-10') and table_name='snapshot_components' order by row_id,dataset asc$new$);
 if position('distinct on(row_id)'in d)=0 then raise exception 'Component archive reader not recognized';end if;execute d;
end$$;
create function public.reclaim_retired_matching_storage()returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role()is distinct from 'service_role'then raise exception 'Service role required';end if;
 perform set_config('lock_timeout','3s',true);lock table public.request_property_matches in access exclusive mode;
 if exists(select 1 from public.request_property_matches)then raise exception 'Matching table is not empty';end if;
 if not exists(select 1 from public.retired_section_operations where dataset='retired-matching-2026-11-10'and table_name='request_property_matches'and removed>0)then raise exception 'No verified retirement receipt';end if;
 truncate public.request_property_matches continue identity;return true;
end$$;
revoke all on function public.reclaim_retired_matching_storage()from public,anon,authenticated;
grant execute on function public.reclaim_retired_matching_storage()to service_role;
notify pgrst,'reload schema';
commit;
