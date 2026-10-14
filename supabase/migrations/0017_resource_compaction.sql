-- Lossless physical compaction. Every historical observation, ID and source URL survives.
-- Backfill is bounded and explicit; VACUUM FULL is maintenance outside this transaction.
begin;
set local lock_timeout = '5s';

create function public.lifecycle_payload_split(p_payload jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare template jsonb:=p_payload; patches jsonb:='[]'; section text; item jsonb; n integer; path text[];
begin
  if p_payload ? 'observedAt' then
    patches:=patches||jsonb_build_array(jsonb_build_object('path',array['observedAt'],'value',p_payload->'observedAt'));
    template:=template-'observedAt';
  end if;
  foreach section in array array['status','marketStart'] loop
    if jsonb_typeof(p_payload #> array[section,'evidence'])='array' then
      for item,n in select value,(ordinality-1)::integer from jsonb_array_elements(p_payload #> array[section,'evidence']) with ordinality loop
        if jsonb_typeof(item)='object' and item ? 'observedAt' then
          path:=array[section,'evidence',n::text,'observedAt'];
          patches:=patches||jsonb_build_array(jsonb_build_object('path',path,'value',item->'observedAt'));
          template:=jsonb_set(template,array[section,'evidence',n::text],item-'observedAt');
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('template',template,'patches',patches);
end $$;
create function public.lifecycle_payload_restore(p_template jsonb,p_patches jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare payload jsonb:=p_template; patch jsonb; path text[];
begin
  for patch in select value from jsonb_array_elements(coalesce(p_patches,'[]')) loop
    select array_agg(value order by ordinality) into path from jsonb_array_elements_text(patch->'path') with ordinality;
    payload:=jsonb_set(payload,path,patch->'value',true);
  end loop;
  return payload;
end $$;

create table public.snapshot_payload_versions (
  id bigint generated always as identity primary key,
  payload_hash text not null unique,
  payload jsonb not null,
  description text
);
alter table public.snapshot_payload_versions enable row level security;
create policy "authenticated read payload versions" on public.snapshot_payload_versions for select to authenticated using(true);
grant select on public.snapshot_payload_versions to authenticated,service_role;
grant insert on public.snapshot_payload_versions to service_role;
grant usage,select on sequence public.snapshot_payload_versions_id_seq to service_role;
create trigger protect_payload_versions before update or delete on public.snapshot_payload_versions
  for each row execute function public.prevent_property_lifecycle_history_mutation();

-- The identity table remains the FK target. No snapshot IDs or observations are removed.
alter table public.snapshots rename to snapshot_observations;
alter table public.snapshot_observations
  add column payload_version_id bigint references public.snapshot_payload_versions(id) on delete restrict,
  add column payload_patches jsonb;

create function public.lifecycle_intern_snapshot_payload() returns trigger
language plpgsql security definer set search_path=public as $$
declare split jsonb; hash text; version bigint;
begin
  split:=public.lifecycle_payload_split(new.normalized_payload);
  hash:=encode(extensions.digest(jsonb_build_object('payload',split->'template','description',new.description)::text,'sha256'),'hex');
  select id into version from public.snapshot_payload_versions where payload_hash=hash;
  if version is null then
    insert into public.snapshot_payload_versions(payload_hash,payload,description)
      values(hash,split->'template',new.description) on conflict(payload_hash) do nothing;
    select id into strict version from public.snapshot_payload_versions where payload_hash=hash;
  end if;
  -- Hash is only an index; equality is verified before sharing a version.
  if not exists(select 1 from public.snapshot_payload_versions where id=version
    and payload=split->'template' and description is not distinct from new.description) then
    raise exception 'Snapshot payload hash collision';
  end if;
  new.payload_version_id:=version; new.payload_patches:=split->'patches';
  new.normalized_payload:='{}'; new.description:=null;
  return new;
end $$;
create trigger intern_snapshot_payload before insert on public.snapshot_observations
  for each row execute function public.lifecycle_intern_snapshot_payload();

create function public.lifecycle_protect_compacted_snapshot() returns trigger
language plpgsql set search_path=public as $$
declare version record;
begin
  if tg_op='UPDATE' and old.payload_version_id is null and new.payload_version_id is not null
    and (to_jsonb(old)-array['normalized_payload','description','payload_version_id','payload_patches'])
      = (to_jsonb(new)-array['normalized_payload','description','payload_version_id','payload_patches'])
    and new.normalized_payload='{}'::jsonb and new.description is null then
    select * into version from public.snapshot_payload_versions where id=new.payload_version_id;
    if version.id is not null and public.lifecycle_payload_restore(version.payload,new.payload_patches)=old.normalized_payload
      and version.description is not distinct from old.description then return new; end if;
  end if;
  raise exception 'snapshots is append-only; only lossless storage interning is permitted';
end $$;
drop trigger prevent_snapshots_mutation on public.snapshot_observations;
create trigger prevent_snapshots_mutation before update or delete on public.snapshot_observations
  for each row execute function public.lifecycle_protect_compacted_snapshot();

create view public.snapshots with(security_invoker=true) as
select s.id,s.publication_id,s.sync_run_id,s.contract_version,s.observed_at,s.content_hash,
  case when s.payload_version_id is null then s.normalized_payload
    else public.lifecycle_payload_restore(v.payload,s.payload_patches) end normalized_payload,
  s.title,case when s.payload_version_id is null then s.description else v.description end description,
  s.price_amount,s.price_currency,s.surface_sqm,s.rooms,s.source_status,s.availability,s.extraction_warnings,s.created_at
from public.snapshot_observations s left join public.snapshot_payload_versions v on v.id=s.payload_version_id;
alter view public.snapshots alter column id set default gen_random_uuid();
alter view public.snapshots alter column contract_version set default 1;
alter view public.snapshots alter column extraction_warnings set default '[]'::jsonb;
alter view public.snapshots alter column created_at set default now();
grant select on public.snapshots to authenticated;
grant select,insert on public.snapshots to service_role;
create function public.lifecycle_insert_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.snapshot_observations(id,publication_id,sync_run_id,contract_version,observed_at,content_hash,
    normalized_payload,title,description,price_amount,price_currency,surface_sqm,rooms,source_status,availability,extraction_warnings,created_at)
  values(new.id,new.publication_id,new.sync_run_id,new.contract_version,new.observed_at,new.content_hash,
    new.normalized_payload,new.title,new.description,new.price_amount,new.price_currency,new.surface_sqm,new.rooms,
    new.source_status,new.availability,new.extraction_warnings,new.created_at);
  return new;
end $$;
create trigger insert_snapshot instead of insert on public.snapshots for each row execute function public.lifecycle_insert_snapshot();

create function public.compact_snapshot_payloads(p_publication_id uuid,p_limit integer default 1000) returns integer
language plpgsql security definer set search_path=public as $$
declare s record; split jsonb; hash text; version bigint; total integer:=0;
begin
  if p_limit<1 or p_limit>2000 then raise exception 'Invalid compaction batch'; end if;
  for s in select * from public.snapshot_observations where publication_id=p_publication_id and payload_version_id is null
    order by id limit p_limit for update skip locked loop
    split:=public.lifecycle_payload_split(s.normalized_payload);
    hash:=encode(extensions.digest(jsonb_build_object('payload',split->'template','description',s.description)::text,'sha256'),'hex');
    insert into public.snapshot_payload_versions(payload_hash,payload,description)
      values(hash,split->'template',s.description) on conflict(payload_hash) do nothing;
    select id into strict version from public.snapshot_payload_versions where payload_hash=hash
      and payload=split->'template' and description is not distinct from s.description;
    update public.snapshot_observations set payload_version_id=version,payload_patches=split->'patches',normalized_payload='{}',description=null where id=s.id;
    total:=total+1;
  end loop;
  return total;
end $$;

alter table public.image_fingerprints rename to image_fingerprint_current;
create table public.image_fingerprint_archive_groups (
  id bigint generated always as identity primary key,
  property_id uuid references public.properties(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  row_data jsonb not null,
  observations jsonb not null check(jsonb_typeof(observations)='array')
);
create index fingerprint_archive_property on public.image_fingerprint_archive_groups(property_id);
create index fingerprint_archive_publication on public.image_fingerprint_archive_groups(publication_id);
create index fingerprint_archive_lookup on public.image_fingerprint_archive_groups((row_data->>'algorithm'),(row_data->>'fingerprint'));
alter table public.image_fingerprint_archive_groups enable row level security;
create policy "authenticated read fingerprint archive" on public.image_fingerprint_archive_groups for select to authenticated using(true);
grant select on public.image_fingerprint_archive_groups to authenticated,service_role;
grant insert on public.image_fingerprint_archive_groups to service_role;
grant usage,select on sequence public.image_fingerprint_archive_groups_id_seq to service_role;
create trigger protect_fingerprint_archive before update or delete on public.image_fingerprint_archive_groups
  for each row execute function public.prevent_property_lifecycle_history_mutation();

create view public.image_fingerprints with(security_invoker=true) as
select * from public.image_fingerprint_current
union all
select r.id,a.property_id,a.publication_id,r.snapshot_id,r.canonical_url,r.algorithm,r.fingerprint,
  r.width,r.height,r.source_recorded_at,r.metadata,r.created_at
from public.image_fingerprint_archive_groups a cross join lateral jsonb_array_elements(a.observations) o
cross join lateral jsonb_populate_record(null::public.image_fingerprint_current,a.row_data||o.value) r;
alter view public.image_fingerprints alter column id set default gen_random_uuid();
alter view public.image_fingerprints alter column metadata set default '{}'::jsonb;
alter view public.image_fingerprints alter column created_at set default now();
grant select on public.image_fingerprints to authenticated;
grant select,insert on public.image_fingerprints to service_role;
create function public.lifecycle_insert_fingerprint() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.image_fingerprint_archive_groups a where a.publication_id is not distinct from new.publication_id
    and ((a.row_data->>'canonical_url'=new.canonical_url and a.row_data->>'algorithm'=new.algorithm
      and a.observations @> jsonb_build_array(jsonb_build_object('snapshot_id',new.snapshot_id)))
      or a.observations @> jsonb_build_array(jsonb_build_object('id',new.id)))) then
    raise exception 'Duplicate historical fingerprint' using errcode='23505';
  end if;
  insert into public.image_fingerprint_current values(new.*);
  return new;
end $$;
create trigger insert_fingerprint instead of insert on public.image_fingerprints for each row execute function public.lifecycle_insert_fingerprint();

create function public.compact_image_fingerprints(p_publication_id uuid,p_limit integer default 5000) returns integer
language plpgsql security definer set search_path=public as $$
declare ids uuid[]; groups bigint[]; total integer;
begin
  if p_limit<1 or p_limit>10000 then raise exception 'Invalid compaction batch'; end if;
  select array_agg(id) into ids from (select f.id from public.snapshot_observations s
    join public.image_fingerprint_current f on f.snapshot_id=s.id
    where s.publication_id=p_publication_id and f.publication_id=p_publication_id
    order by f.id limit p_limit for update of f skip locked) selected;
  total:=coalesce(cardinality(ids),0); if total=0 then return 0; end if;
  with inserted as (
    insert into public.image_fingerprint_archive_groups(property_id,publication_id,row_data,observations)
    select property_id,publication_id,to_jsonb(f)-array['id','snapshot_id','created_at'],
      jsonb_agg(jsonb_build_object('id',id,'snapshot_id',snapshot_id,'created_at',created_at) order by id)
    from public.image_fingerprint_current f where id=any(ids)
    group by property_id,publication_id,to_jsonb(f)-array['id','snapshot_id','created_at'] returning id
  ) select array_agg(id) into groups from inserted;
  -- Exact row-set equality, not only a checksum/count, before replacing physical copies.
  if exists(
    (select to_jsonb(f) value from public.image_fingerprint_current f where id=any(ids)
      except all
     select to_jsonb(r) from public.image_fingerprint_archive_groups a cross join lateral jsonb_array_elements(a.observations) o
       cross join lateral jsonb_populate_record(null::public.image_fingerprint_current,a.row_data||o.value) r where a.id=any(groups))
    union all
    (select to_jsonb(r) from public.image_fingerprint_archive_groups a cross join lateral jsonb_array_elements(a.observations) o
       cross join lateral jsonb_populate_record(null::public.image_fingerprint_current,a.row_data||o.value) r where a.id=any(groups)
      except all select to_jsonb(f) from public.image_fingerprint_current f where id=any(ids))
  ) then raise exception 'Lossless fingerprint compaction verification failed'; end if;
  delete from public.image_fingerprint_current where id=any(ids);
  return total;
end $$;

-- Match only distinct values, without expanding historical observation arrays over the wire.
create function public.lifecycle_identity_fingerprints(p_property_ids uuid[] default null)
returns table(property_id uuid,kind text,algorithm text,fingerprint text)
language sql stable security invoker set search_path=public as $$
  select distinct property_id,'IMAGE'::text,algorithm,fingerprint from public.image_fingerprint_current
    where p_property_ids is null or property_id=any(p_property_ids)
  union
  select distinct property_id,'IMAGE'::text,row_data->>'algorithm',row_data->>'fingerprint' from public.image_fingerprint_archive_groups
    where p_property_ids is null or property_id=any(p_property_ids)
  union
  select distinct property_id,'FLOORPLAN'::text,algorithm,fingerprint from public.floorplan_fingerprints
    where p_property_ids is null or property_id=any(p_property_ids);
$$;

create function public.resource_compaction_status() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('databaseBytes',pg_database_size(current_database()),
    'fingerprintCurrentRows',(select count(*) from public.image_fingerprint_current),
    'fingerprintArchivedRows',(select coalesce(sum(jsonb_array_length(observations)),0) from public.image_fingerprint_archive_groups),
    'fingerprintArchiveGroups',(select count(*) from public.image_fingerprint_archive_groups),
    'snapshots',(select count(*) from public.snapshot_observations),
    'snapshotPayloadsPending',(select count(*) from public.snapshot_observations where payload_version_id is null),
    'payloadVersions',(select count(*) from public.snapshot_payload_versions),
    'fingerprintCurrentBytes',pg_total_relation_size('public.image_fingerprint_current'),
    'fingerprintArchiveBytes',pg_total_relation_size('public.image_fingerprint_archive_groups'),
    'snapshotObservationBytes',pg_total_relation_size('public.snapshot_observations'),
    'payloadVersionBytes',pg_total_relation_size('public.snapshot_payload_versions'));
$$;

-- Existing views retain OID dependencies after a rename: rebind their reads to the logical view.
do $$ declare v record; definition text; begin
  for v in select distinct c.oid,c.relname from pg_depend d join pg_rewrite rw on rw.oid=d.objid
    join pg_class c on c.oid=rw.ev_class join pg_namespace n on n.oid=c.relnamespace
    where d.refobjid='public.snapshot_observations'::regclass and c.relkind='v' and n.nspname='public' and c.relname<>'snapshots'
  loop
    definition:=regexp_replace(pg_get_viewdef(v.oid,true),'\msnapshot_observations\M','snapshots','g');
    execute format('create or replace view public.%I with(security_invoker=true) as %s',v.relname,definition);
  end loop;
end $$;

revoke all on function public.lifecycle_payload_split(jsonb),public.lifecycle_intern_snapshot_payload(),
  public.lifecycle_insert_snapshot(),public.lifecycle_insert_fingerprint(),public.lifecycle_protect_compacted_snapshot(),
  public.compact_snapshot_payloads(uuid,integer),public.compact_image_fingerprints(uuid,integer),public.resource_compaction_status() from public,anon,authenticated;
grant execute on function public.compact_snapshot_payloads(uuid,integer),public.compact_image_fingerprints(uuid,integer),public.resource_compaction_status() to service_role;
revoke all on function public.lifecycle_payload_restore(jsonb,jsonb),public.lifecycle_identity_fingerprints(uuid[]) from public,anon;
grant execute on function public.lifecycle_payload_restore(jsonb,jsonb),public.lifecycle_identity_fingerprints(uuid[]) to authenticated,service_role;
comment on view public.snapshots is 'Lossless original observations with shared payload versions; original IDs and FK targets preserved.';
comment on view public.image_fingerprints is 'Lossless original rows reconstructed from compact groups plus current observations.';
notify pgrst,'reload schema';
commit;
