begin;
set local lock_timeout='5s';
create view public.fingerprint_archive_pending_expanded with(security_invoker=true) as
select id,property_id,publication_id,
 case when component_refs is null then row_data else public.snapshot_component_payload(component_refs) end row_data,
 case when component_refs is null then observations else public.fingerprint_unpack_observations(observation_ids,observation_snapshots,observation_times) end observations
from public.image_fingerprint_archive_groups;
grant select on public.fingerprint_archive_pending_expanded to service_role;

create or replace view public.fingerprint_archive_expanded with(security_invoker=true) as
select * from public.fingerprint_archive_pending_expanded
union all
select e.* from public.read_external_fingerprint_groups() e join public.fingerprint_archive_receipts r using(id);
grant select on public.fingerprint_archive_pending_expanded to authenticated;

-- Matching stays local: no remote round-trip or observation expansion per image.
create or replace function public.lifecycle_identity_fingerprint_bundles(p_property_ids uuid[])
returns table(property_id uuid,images jsonb,floorplans jsonb)
language plpgsql stable security invoker set search_path=public as $$
begin
 if p_property_ids is null or cardinality(p_property_ids)>75 then raise exception 'A batch of at most 75 property IDs is required';end if;
 return query with v as (
  select f.property_id,'IMAGE'::text kind,f.algorithm,f.fingerprint from image_fingerprint_current f where f.property_id=any(p_property_ids)
  union select a.property_id,'IMAGE',a.row_data->>'algorithm',a.row_data->>'fingerprint' from fingerprint_archive_pending_expanded a where a.property_id=any(p_property_ids)
  union select r.property_id,'IMAGE',r.algorithm,r.fingerprint from fingerprint_archive_receipts r where r.property_id=any(p_property_ids)
  union select f.property_id,'FLOORPLAN',f.algorithm,f.fingerprint from floorplan_fingerprints f where f.property_id=any(p_property_ids)
 ) select v.property_id,coalesce(jsonb_agg(jsonb_build_object('algorithm',v.algorithm,'fingerprint',v.fingerprint) order by v.algorithm,v.fingerprint)filter(where kind='IMAGE'),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('algorithm',v.algorithm,'fingerprint',v.fingerprint) order by v.algorithm,v.fingerprint)filter(where kind='FLOORPLAN'),'[]') from v group by v.property_id order by v.property_id;
end $$;
create or replace function public.lifecycle_identity_fingerprints(p_property_ids uuid[] default null)
returns table(property_id uuid,kind text,algorithm text,fingerprint text)
language sql stable security invoker set search_path=public as $$
 select distinct f.property_id,'IMAGE'::text,f.algorithm,f.fingerprint from image_fingerprint_current f where p_property_ids is null or f.property_id=any(p_property_ids)
 union select a.property_id,'IMAGE',a.row_data->>'algorithm',a.row_data->>'fingerprint' from fingerprint_archive_pending_expanded a where p_property_ids is null or a.property_id=any(p_property_ids)
 union select r.property_id,'IMAGE',r.algorithm,r.fingerprint from fingerprint_archive_receipts r where p_property_ids is null or r.property_id=any(p_property_ids)
 union select f.property_id,'FLOORPLAN',f.algorithm,f.fingerprint from floorplan_fingerprints f where p_property_ids is null or f.property_id=any(p_property_ids)
$$;

create function public.acknowledge_external_fingerprint_groups(p_ids bigint[]) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.image_fingerprint_archive_groups; local_payload jsonb; remote_payload jsonb; n integer:=0;r record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if p_ids is null or cardinality(p_ids)>250 or array_position(p_ids,null)is not null then raise exception 'Bounded IDs required';end if;
 -- Read the already committed external payload, not a caller-supplied checksum.
 create temporary table if not exists archive_ack_batch(id bigint primary key,payload jsonb) on commit drop;
 truncate archive_ack_batch;
 insert into archive_ack_batch select e.id,jsonb_build_object('id',e.id::text,'property_id',e.property_id,'publication_id',e.publication_id,'row_data',e.row_data,'observations',e.observations) from public.read_external_fingerprint_groups(p_ids) e;
 for old in select * from public.image_fingerprint_archive_groups where id=any(p_ids) order by id for update loop
  local_payload:=jsonb_build_object('id',old.id::text,'property_id',old.property_id,'publication_id',old.publication_id,
   'row_data',case when old.component_refs is null then old.row_data else public.snapshot_component_payload(old.component_refs)end,
   'observations',case when old.component_refs is null then old.observations else public.fingerprint_unpack_observations(old.observation_ids,old.observation_snapshots,old.observation_times)end);
  select payload into remote_payload from archive_ack_batch where id=old.id;
  if remote_payload is distinct from local_payload then raise exception 'External archive differs: source preserved';end if;
  insert into public.fingerprint_archive_receipts(id,property_id,publication_id,algorithm,fingerprint,observation_count,payload_md5)
  values(old.id,old.property_id,old.publication_id,local_payload->'row_data'->>'algorithm',local_payload->'row_data'->>'fingerprint',jsonb_array_length(local_payload->'observations'),md5(local_payload::text))
  on conflict(id)do update set verified_at=now() where fingerprint_archive_receipts.payload_md5=excluded.payload_md5;
  if not found then raise exception 'Receipt differs';end if;
  perform set_config('radar.archive_verified_delete','on',true);
  delete from public.image_fingerprint_archive_groups where id=old.id;n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.acknowledge_external_fingerprint_groups(bigint[]) from public,anon,authenticated;
grant execute on function public.acknowledge_external_fingerprint_groups(bigint[]) to service_role;

-- Preserve the existing compaction guard; allow only deletion already protected
-- by a matching receipt, inside the verified-acknowledgement transaction.
do $$ declare definition text; begin
 select pg_get_functiondef('public.protect_fingerprint_component_migration()'::regprocedure) into definition;
 definition:=replace(definition,'begin', 'begin
 if tg_op=''DELETE'' and current_setting(''radar.archive_verified_delete'',true)=''on'' and exists(
  select 1 from public.fingerprint_archive_receipts where id=old.id and payload_md5=md5(jsonb_build_object(''id'',old.id::text,''property_id'',old.property_id,''publication_id'',old.publication_id,
   ''row_data'',case when old.component_refs is null then old.row_data else public.snapshot_component_payload(old.component_refs)end,
   ''observations'',case when old.component_refs is null then old.observations else public.fingerprint_unpack_observations(old.observation_ids,old.observation_snapshots,old.observation_times)end)::text)) then return old;end if;');
 if position('radar.archive_verified_delete' in definition)=0 then raise exception 'Existing archive guard not recognized';end if;
 execute definition;
 -- Local compaction verifies its newly-created local groups, not the full remote archive.
 for definition in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='compact_image_fingerprints' loop
  execute replace(definition,'fingerprint_archive_expanded','fingerprint_archive_pending_expanded');
 end loop;
end $$;

create or replace function public.lifecycle_insert_fingerprint() returns trigger
language plpgsql security definer set search_path=public as $$
declare ids bigint[];
begin
 if exists(select 1 from fingerprint_archive_pending_expanded a where a.publication_id is not distinct from new.publication_id
  and ((a.row_data->>'canonical_url'=new.canonical_url and a.row_data->>'algorithm'=new.algorithm and a.observations @>jsonb_build_array(jsonb_build_object('snapshot_id',new.snapshot_id))) or a.observations @>jsonb_build_array(jsonb_build_object('id',new.id)))) then raise exception 'Duplicate historical fingerprint' using errcode='23505';end if;
 select array_agg(id) into ids from fingerprint_archive_receipts where publication_id is not distinct from new.publication_id;
 if cardinality(ids)>0 and exists(select 1 from read_external_fingerprint_groups(ids) a where
  (a.row_data->>'canonical_url'=new.canonical_url and a.row_data->>'algorithm'=new.algorithm and a.observations @>jsonb_build_array(jsonb_build_object('snapshot_id',new.snapshot_id))) or a.observations @>jsonb_build_array(jsonb_build_object('id',new.id))) then raise exception 'Duplicate historical fingerprint' using errcode='23505';end if;
 insert into image_fingerprint_current values(new.*);return new;
end $$;
do $$ declare definition text; begin
 if to_regprocedure('public.resource_compaction_status()') is not null then
  select pg_get_functiondef('public.resource_compaction_status()'::regprocedure) into definition;
  definition:=replace(definition,'resource_compaction_status()','resource_compaction_status_pending()');
  definition:=replace(definition,'fingerprint_archive_expanded','fingerprint_archive_pending_expanded');
  execute definition;
  execute $f$create or replace function public.resource_compaction_status() returns jsonb language sql stable security definer set search_path=public as $body$
   select resource_compaction_status_pending() || jsonb_build_object('fingerprintArchivedRows',
    (select coalesce(sum(jsonb_array_length(observations)),0) from fingerprint_archive_pending_expanded)+(select coalesce(sum(observation_count),0) from fingerprint_archive_receipts),
    'fingerprintArchiveGroups',(select count(*) from image_fingerprint_archive_groups)+(select count(*) from fingerprint_archive_receipts),
    'fingerprintExternalGroups',(select count(*) from fingerprint_archive_receipts)) $body$ $f$;
  revoke all on function public.resource_compaction_status_pending() from public,anon,authenticated;
  grant execute on function public.resource_compaction_status_pending() to service_role;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
