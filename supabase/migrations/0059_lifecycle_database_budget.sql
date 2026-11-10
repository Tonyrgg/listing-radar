-- Leave room for user activity and maintenance before the Free plan ceiling.
begin;
create function public.assert_lifecycle_database_budget(bytes bigint) returns void
language plpgsql immutable as $$
begin
 if bytes>=475000000 then
  raise exception 'Database capacity safeguard: % bytes. New market synchronizations are paused until storage maintenance brings usage below 475 MB. Existing data remains available.',bytes using errcode='P0001';
 end if;
end $$;
create function public.enforce_lifecycle_database_budget() returns trigger
language plpgsql security definer set search_path=public as $$
declare bytes bigint;
begin
 bytes:=pg_database_size(current_database());
 perform public.assert_lifecycle_database_budget(bytes);
 return new;
end $$;
create trigger lifecycle_database_budget before insert on public.sync_runs
 for each row execute function public.enforce_lifecycle_database_budget();
revoke all on function public.enforce_lifecycle_database_budget() from public,anon,authenticated;
revoke all on function public.assert_lifecycle_database_budget(bigint) from public,anon,authenticated;
comment on function public.enforce_lifecycle_database_budget() is 'Reject new market syncs at 475 decimal MB, reserving headroom for requests, administration and maintenance.';
commit;
