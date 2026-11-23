begin;

create table public.radar_retired_unknown_exits (
  property_id uuid primary key references public.properties(id) on delete cascade,
  last_seen_at timestamptz not null,
  retired_at timestamptz not null default now(),
  restored_at timestamptz
);
alter table public.radar_retired_unknown_exits enable row level security;
revoke all on public.radar_retired_unknown_exits from public,anon,authenticated;
grant select on public.radar_retired_unknown_exits to authenticated;
grant select,update on public.radar_retired_unknown_exits to service_role;
create policy radar_retired_unknown_exits_read on public.radar_retired_unknown_exits
  for select to authenticated using (true);

alter view public.radar_property_live_archive rename to radar_property_archive_before_unknown_exit_retirement;
create view public.radar_property_live_archive with (security_invoker=true) as
select b.* from public.radar_property_archive_before_unknown_exit_retirement b
where not (
  b.exit_classification = 'UNKNOWN_EXIT' and b.state = 'OFF_MARKET_NO_SALE_EVIDENCE'
  and exists (
    select 1 from public.radar_retired_unknown_exits e
    where e.property_id = b.property_id and e.restored_at is null and b.last_seen_at <= e.last_seen_at
      and not exists (
        select 1 from public.agency_listings a where a.property_id = b.property_id and a.state in ('ACTIVE','EXIT_PENDING')
      )
      and not exists (
        select 1 from public.private_publications a where a.property_id = b.property_id and a.state = 'ACTIVE'
      )
  )
);
revoke all on public.radar_property_live_archive from public,anon;
grant select on public.radar_property_live_archive to authenticated,service_role;

create function public.radar_retire_unknown_exits(p_count integer, p_sha256 text)
returns integer language plpgsql security definer set search_path='' as $$
declare
  target_ids uuid[];
  candidate_sha text;
  affected integer;
begin
  perform pg_advisory_xact_lock(hashtext('radar_retire_unknown_exits'));
  select array_agg(c.property_id order by c.property_id),
         encode(sha256(convert_to(coalesce(string_agg(c.property_id::text, E'\n' order by c.property_id), ''), 'UTF8')), 'hex')
    into target_ids, candidate_sha
  from (
    select distinct b.property_id
    from public.radar_property_live_archive b
    join public.properties p on p.id = b.property_id
    where b.exit_classification = 'UNKNOWN_EXIT' and b.state = 'OFF_MARKET_NO_SALE_EVIDENCE'
      and p.property_state not like 'ACTIVE%'
      and not exists (
        select 1 from public.agency_listings a where a.property_id = b.property_id and a.state in ('ACTIVE','EXIT_PENDING')
      )
      and not exists (
        select 1 from public.private_publications a where a.property_id = b.property_id and a.state = 'ACTIVE'
      )
  ) c;
  if cardinality(target_ids) is distinct from p_count or candidate_sha is distinct from p_sha256 then
    raise exception 'La selezione delle uscite è cambiata, ripetere il controllo.';
  end if;
  insert into public.radar_retired_unknown_exits(property_id,last_seen_at)
    select selected.property_id,max(b.last_seen_at)
    from unnest(target_ids) as selected(property_id)
    join public.radar_property_live_archive b using(property_id)
    join public.properties p on p.id=b.property_id
    where b.exit_classification='UNKNOWN_EXIT' and b.state='OFF_MARKET_NO_SALE_EVIDENCE'
      and p.property_state not like 'ACTIVE%'
      and not exists (
        select 1 from public.agency_listings a where a.property_id = b.property_id and a.state in ('ACTIVE','EXIT_PENDING')
      )
      and not exists (
        select 1 from public.private_publications a where a.property_id = b.property_id and a.state = 'ACTIVE'
      )
    group by selected.property_id
  on conflict (property_id) do update
    set last_seen_at=excluded.last_seen_at,retired_at=now(),restored_at=null;
  get diagnostics affected=row_count;
  if affected <> p_count then raise exception 'La selezione delle uscite è cambiata durante il ritiro.'; end if;
  return affected;
end;
$$;
revoke all on function public.radar_retire_unknown_exits(integer,text) from public,anon,authenticated;
grant execute on function public.radar_retire_unknown_exits(integer,text) to service_role;
notify pgrst, 'reload schema';
commit;
