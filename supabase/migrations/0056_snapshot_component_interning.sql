-- Lossless sharing of repeated snapshot sections and descriptions.
begin;
set local lock_timeout='5s';
create table public.snapshot_components (
 id bigint generated always as identity primary key,
 hash text not null unique,
 value jsonb not null
);
alter table public.snapshot_components enable row level security;
create policy snapshot_components_read on public.snapshot_components for select to authenticated using(true);
grant select on public.snapshot_components to authenticated,service_role;
create trigger protect_snapshot_components before update or delete on public.snapshot_components
 for each row execute function public.prevent_property_lifecycle_history_mutation();
alter table public.snapshot_payload_versions add column component_refs jsonb;

create function public.snapshot_component_intern(v jsonb) returns bigint
language plpgsql security definer set search_path=public as $$
declare h text:=encode(extensions.digest(v::text,'sha256'),'hex'); k bigint;
begin
 insert into snapshot_components(hash,value) values(h,v) on conflict(hash) do nothing;
 select id into strict k from snapshot_components where hash=h and value=v;
 return k;
end $$;
create function public.snapshot_component_payload(refs jsonb) returns jsonb
language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_object_agg(r.key,c.value),'{}'::jsonb)
 from jsonb_each(refs->'payload') r join snapshot_components c on c.id=(r.value#>>'{}')::bigint
$$;
create function public.snapshot_component_description(refs jsonb) returns text
language sql stable security invoker set search_path=public as $$
 select value#>>'{}' from snapshot_components where id=(refs->>'description')::bigint
$$;
create view public.snapshot_payload_expanded with(security_invoker=true) as
 select id,payload_hash,
 case when component_refs is null then payload else public.snapshot_component_payload(component_refs) end payload,
 case when component_refs is null then description else public.snapshot_component_description(component_refs) end description
 from public.snapshot_payload_versions;
grant select on public.snapshot_payload_expanded to authenticated,service_role;

create function public.snapshot_pack_components() returns trigger
language plpgsql security definer set search_path=public as $$
declare refs jsonb:='{}'; part record;
begin
 if new.component_refs is not null then raise exception 'Direct component references are forbidden'; end if;
 for part in select * from jsonb_each(new.payload) loop
  refs:=refs||jsonb_build_object(part.key,snapshot_component_intern(part.value));
 end loop;
 new.component_refs:=jsonb_build_object('payload',refs,'description',snapshot_component_intern(to_jsonb(new.description)::jsonb));
 -- SQL NULL is represented by JSON null, too.
 new.payload:='{}';new.description:=null;
 return new;
end $$;
-- NULL description must still have an explicit dictionary entry.
create or replace function public.snapshot_component_intern(v jsonb) returns bigint
language plpgsql security definer set search_path=public as $$
declare h text; k bigint;
begin
 v:=coalesce(v,'null'::jsonb); h:=encode(extensions.digest(v::text,'sha256'),'hex');
 insert into snapshot_components(hash,value) values(h,v) on conflict(hash) do nothing;
 select id into strict k from snapshot_components where hash=h and value=v;
 return k;
end $$;
create trigger pack_snapshot_components before insert on public.snapshot_payload_versions
 for each row execute function public.snapshot_pack_components();

create function public.protect_snapshot_component_migration() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and old.component_refs is null and new.component_refs is not null
 and (to_jsonb(old)-array['payload','description','component_refs'])=(to_jsonb(new)-array['payload','description','component_refs'])
 and new.payload='{}'::jsonb and new.description is null
 and public.snapshot_component_payload(new.component_refs)=old.payload
 and public.snapshot_component_description(new.component_refs) is not distinct from old.description then return new; end if;
 raise exception 'Payload history is immutable';
end $$;
drop trigger protect_payload_versions on public.snapshot_payload_versions;
create trigger protect_payload_versions before update or delete on public.snapshot_payload_versions
 for each row execute function public.protect_snapshot_component_migration();

-- Rebind only payload reads; insert targets and original FK identities stay physical.
do $$ declare f text; n text; definition text; begin
 foreach n in array array['lifecycle_intern_snapshot_payload()','lifecycle_protect_compacted_snapshot()','compact_snapshot_payloads(uuid,integer)'] loop
  definition:=pg_get_functiondef(('public.'||n)::regprocedure);
  definition:=replace(definition,'from public.snapshot_payload_versions','from public.snapshot_payload_expanded');
  execute definition;
 end loop;
 definition:=pg_get_viewdef('public.snapshots'::regclass,true);
 definition:=replace(definition,'JOIN snapshot_payload_versions','JOIN snapshot_payload_expanded');
 definition:=replace(definition,'JOIN public.snapshot_payload_versions','JOIN public.snapshot_payload_expanded');
 execute 'create or replace view public.snapshots with(security_invoker=true) as '||definition;
end $$;

create function public.compact_snapshot_components(p_limit integer default 200) returns integer
language plpgsql security definer set search_path=public as $$
declare row record; refs jsonb; part record; n integer:=0;
begin
 if p_limit<1 or p_limit>500 then raise exception 'Invalid batch'; end if;
 for row in select * from snapshot_payload_versions where component_refs is null order by id limit p_limit for update skip locked loop
  refs:='{}';
  for part in select * from jsonb_each(row.payload) loop
   refs:=refs||jsonb_build_object(part.key,snapshot_component_intern(part.value));
  end loop;
  refs:=jsonb_build_object('payload',refs,'description',snapshot_component_intern(to_jsonb(row.description)));
  update snapshot_payload_versions set payload='{}',description=null,component_refs=refs where id=row.id;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.snapshot_component_intern(jsonb),public.snapshot_pack_components(),public.protect_snapshot_component_migration(),public.compact_snapshot_components(integer) from public,anon,authenticated;
grant execute on function public.compact_snapshot_components(integer) to service_role;
revoke all on function public.snapshot_component_payload(jsonb),public.snapshot_component_description(jsonb) from public,anon;
grant execute on function public.snapshot_component_payload(jsonb),public.snapshot_component_description(jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
