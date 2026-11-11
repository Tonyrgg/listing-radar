begin;
set local lock_timeout='5s';
alter table public.image_fingerprint_archive_groups add column component_refs jsonb,
 add column observation_ids uuid[],add column observation_snapshots uuid[],add column observation_times text[];

create function public.fingerprint_unpack_observations(ids uuid[],snaps uuid[],times text[]) returns jsonb
language sql immutable as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',ids[i],'snapshot_id',snaps[i],'created_at',times[i]) order by i),'[]'::jsonb)
 from generate_subscripts(ids,1) i
$$;
create view public.fingerprint_archive_expanded with(security_invoker=true) as
select id,property_id,publication_id,
 case when component_refs is null then row_data else public.snapshot_component_payload(component_refs) end row_data,
 case when component_refs is null then observations else public.fingerprint_unpack_observations(observation_ids,observation_snapshots,observation_times) end observations
from public.image_fingerprint_archive_groups;
grant select on public.fingerprint_archive_expanded to authenticated,service_role;

create function public.fingerprint_pack_archive() returns trigger
language plpgsql security definer set search_path=public as $$
declare refs jsonb:='{}'; part record;
begin
 if new.component_refs is not null then raise exception 'Direct archive references forbidden'; end if;
 -- Preserve unexpected observation formats as-is rather than discarding fields.
 if exists(select 1 from jsonb_array_elements(new.observations) o where
   jsonb_typeof(o)<>'object' or not(o ?& array['id','snapshot_id','created_at'])
   or o-array['id','snapshot_id','created_at']<>'{}'::jsonb) then return new; end if;
 for part in select * from jsonb_each(new.row_data) loop
  refs:=refs||jsonb_build_object(part.key,public.snapshot_component_intern(part.value));
 end loop;
 new.component_refs:=jsonb_build_object('payload',refs);
 select array_agg((o->>'id')::uuid order by i),array_agg((o->>'snapshot_id')::uuid order by i),array_agg(o->>'created_at' order by i)
 into new.observation_ids,new.observation_snapshots,new.observation_times
 from jsonb_array_elements(new.observations) with ordinality e(o,i);
 if public.snapshot_component_payload(new.component_refs)<>new.row_data
 or public.fingerprint_unpack_observations(new.observation_ids,new.observation_snapshots,new.observation_times)<>new.observations
 then raise exception 'Archive reconstruction failed'; end if;
 new.row_data:='{}';new.observations:='[]';return new;
end $$;
create trigger pack_fingerprint_archive before insert on public.image_fingerprint_archive_groups
 for each row execute function public.fingerprint_pack_archive();

create function public.protect_fingerprint_component_migration() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and old.component_refs is null and new.component_refs is not null
 and (to_jsonb(old)-array['row_data','observations','component_refs','observation_ids','observation_snapshots','observation_times'])
  =(to_jsonb(new)-array['row_data','observations','component_refs','observation_ids','observation_snapshots','observation_times'])
 and new.row_data='{}'::jsonb and new.observations='[]'::jsonb
 and public.snapshot_component_payload(new.component_refs)=old.row_data
 and public.fingerprint_unpack_observations(new.observation_ids,new.observation_snapshots,new.observation_times)=old.observations
 then return new; end if;
 raise exception 'Fingerprint archive is append-only';
end $$;
drop trigger protect_fingerprint_archive on public.image_fingerprint_archive_groups;
create trigger protect_fingerprint_archive before update or delete on public.image_fingerprint_archive_groups
 for each row execute function public.protect_fingerprint_component_migration();

-- Read paths see identical logical rows, including bounded matching RPCs.
do $$ declare r record; definition text; begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.prosrc like '%image_fingerprint_archive_groups%'
 loop
  definition:=pg_get_functiondef(r.oid);
  definition:=regexp_replace(definition,'(\mfrom|\mjoin) (public\.)?image_fingerprint_archive_groups\M','\1 public.fingerprint_archive_expanded','gi');
  execute definition;
 end loop;
 for r in select distinct c.oid,c.relname from pg_depend d join pg_rewrite rw on rw.oid=d.objid
 join pg_class c on c.oid=rw.ev_class join pg_namespace n on n.oid=c.relnamespace
 where d.refobjid='public.image_fingerprint_archive_groups'::regclass and c.relkind='v' and n.nspname='public' and c.relname<>'fingerprint_archive_expanded'
 loop
  definition:=pg_get_viewdef(r.oid,true);
  definition:=regexp_replace(definition,'(\mfrom|\mjoin) (public\.)?image_fingerprint_archive_groups\M','\1 public.fingerprint_archive_expanded','gi');
  execute format('create or replace view public.%I with(security_invoker=true) as %s',r.relname,definition);
 end loop;
end $$;

create function public.compact_fingerprint_arrays(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=public as $$
declare r record; packed public.image_fingerprint_archive_groups; refs jsonb; part record; n integer:=0;
begin
 if p_limit<1 or p_limit>500 then raise exception 'Invalid batch'; end if;
 for r in select * from image_fingerprint_archive_groups where component_refs is null order by id limit p_limit for update skip locked loop
  if exists(select 1 from jsonb_array_elements(r.observations) o where jsonb_typeof(o)<>'object'
    or not(o ?& array['id','snapshot_id','created_at']) or o-array['id','snapshot_id','created_at']<>'{}'::jsonb) then
    raise exception 'Unexpected archive format: preserve original'; end if;
  refs:='{}';for part in select * from jsonb_each(r.row_data) loop
   refs:=refs||jsonb_build_object(part.key,snapshot_component_intern(part.value));end loop;
  select array_agg((o->>'id')::uuid order by i),array_agg((o->>'snapshot_id')::uuid order by i),array_agg(o->>'created_at' order by i)
  into packed.observation_ids,packed.observation_snapshots,packed.observation_times
  from jsonb_array_elements(r.observations) with ordinality e(o,i);
  update image_fingerprint_archive_groups set component_refs=jsonb_build_object('payload',refs),
   observation_ids=packed.observation_ids,observation_snapshots=packed.observation_snapshots,observation_times=packed.observation_times,
   row_data='{}',observations='[]' where id=r.id;
  n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.fingerprint_pack_archive(),public.protect_fingerprint_component_migration(),public.compact_fingerprint_arrays(integer) from public,anon,authenticated;
grant execute on function public.compact_fingerprint_arrays(integer) to service_role;
revoke all on function public.fingerprint_unpack_observations(uuid[],uuid[],text[]) from public,anon;
grant execute on function public.fingerprint_unpack_observations(uuid[],uuid[],text[]) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
