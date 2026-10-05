-- Local integration test. Every fixture and change is rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"be0e3d14-4b90-41b9-83b5-43a683fc2523","role":"authenticated"}', true);
do $$
declare v_workspace uuid := gen_random_uuid(); v_revision bigint; v_count bigint;
begin
  v_revision := public.save_territory_lab_workspace(v_workspace, auth.uid(), 'live', 0, '{"version":1}');
  if v_revision <> 1 then raise exception 'First revision failed'; end if;
  v_revision := public.save_territory_lab_workspace(v_workspace, auth.uid(), 'live', 1, '{"version":1,"check":"updated"}');
  if v_revision <> 2 then raise exception 'Revision update failed'; end if;
  select count(*) into v_count from public.territory_lab_sync_events where workspace_id = v_workspace;
  if v_count <> 2 then raise exception 'Audit must be transactional'; end if;
  begin
    perform public.save_territory_lab_workspace(v_workspace, auth.uid(), 'live', 1, '{"version":1}');
    raise exception 'Stale revision accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.save_territory_lab_workspace(v_workspace, 'fd2503de-cf17-4ed5-bac1-65a5c6d269ce', 'live', 2, '{"version":1}');
    raise exception 'Foreign owner accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.territory_lab_workspaces set state = '{"version":1}' where id = v_workspace;
    raise exception 'Direct write accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', '{"sub":"fd2503de-cf17-4ed5-bac1-65a5c6d269ce","role":"authenticated"}', true);
  select count(*) into v_count from public.territory_lab_workspaces where id = v_workspace;
  if v_count <> 0 then raise exception 'Foreign workspace exposed'; end if;
  select count(*) into v_count from public.territory_lab_sync_events where workspace_id = v_workspace;
  if v_count <> 0 then raise exception 'Foreign audit exposed'; end if;
end $$;
set local role anon;
do $$
begin
  begin
    perform public.save_territory_lab_workspace(gen_random_uuid(), gen_random_uuid(), 'live', 0, '{"version":1}');
    raise exception 'Anonymous RPC accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
