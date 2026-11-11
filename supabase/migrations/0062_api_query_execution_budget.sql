-- The expanded archive plan triggers expensive LLVM compilation on the small
-- Free instance. Keep execution semantics and the API statement timeout intact.
begin;
create function public.radar_api_query_settings() returns void
language plpgsql set search_path=pg_catalog as $$
begin
 perform set_config('jit','off',true);
end $$;
revoke all on function public.radar_api_query_settings() from public;
grant execute on function public.radar_api_query_settings() to anon,authenticated,service_role;
do $$ declare setting text; begin
 select s into setting from pg_roles r cross join lateral unnest(r.rolconfig) s
 where rolname='authenticator' and s like 'pgrst.db_pre_request=%';
 if setting is not null and setting not in ('pgrst.db_pre_request=','pgrst.db_pre_request=public.radar_api_query_settings') then
  raise exception 'Preserve existing API pre-request hook: %',setting;
 end if;
end $$;
alter role authenticator set pgrst.db_pre_request='public.radar_api_query_settings';
notify pgrst,'reload config';
commit;
