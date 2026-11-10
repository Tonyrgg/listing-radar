begin;
alter server radar_prisma_archive options(add keep_connections 'false');
create or replace function public.read_external_fingerprint_groups(p_ids bigint[] default null,p_property_ids uuid[] default null)
returns table(id bigint,property_id uuid,publication_id uuid,row_data jsonb,observations jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare src text;
begin
 select source into strict src from public.fingerprint_archive_external_config where singleton;
 if p_ids is not null then
  return query select f.id,f.property_id,f.publication_id,f.payload->'row_data',f.payload->'observations'
   from radar_external.fingerprint_groups f where f.source=src and f.id=any(p_ids);
 elsif p_property_ids is not null then
  return query select f.id,f.property_id,f.publication_id,f.payload->'row_data',f.payload->'observations'
   from radar_external.fingerprint_groups f where f.source=src and f.property_id=any(p_property_ids);
 else
  return query select f.id,f.property_id,f.publication_id,f.payload->'row_data',f.payload->'observations'
   from radar_external.fingerprint_groups f where f.source=src;
 end if;
end $$;
create function public.fingerprint_compaction_publications(p_limit integer default 3)returns table(publication_id uuid)
language sql stable security definer set search_path=public as $$
 select distinct f.publication_id from image_fingerprint_current f join snapshots s on s.id=f.snapshot_id
 where f.publication_id is not null order by f.publication_id limit least(greatest(p_limit,1),10)
$$;
revoke all on function public.fingerprint_compaction_publications(integer) from public,anon,authenticated;
grant execute on function public.fingerprint_compaction_publications(integer) to service_role;
create table public.fingerprint_archive_maintenance_runs(
 id uuid primary key default gen_random_uuid(),started_at timestamptz not null default now(),finished_at timestamptz,
 status text not null default 'RUNNING' check(status in('RUNNING','SUCCEEDED','FAILED')),summary jsonb not null default '{}'
);
alter table public.fingerprint_archive_maintenance_runs enable row level security;
grant select,insert,update on public.fingerprint_archive_maintenance_runs to service_role;
notify pgrst,'reload schema';
commit;
