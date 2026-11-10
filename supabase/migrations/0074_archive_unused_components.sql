begin;
-- Avoid a full evidence scan for every FK check during verified component removal.
create index if not exists evidence_component_reference_idx on public.evidence_rows(content_ref)where content_ref is not null;
create function public.protect_referenced_snapshot_components()returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE'and current_setting('radar.retire_components',true)='verified'and to_regclass('pg_temp.radar_verified_unused_components')is not null then
  if exists(select 1 from pg_temp.radar_verified_unused_components where id=old.id and payload_hash=md5(to_jsonb(old)::text))then return old;end if;
 end if;
 raise exception 'Payload history is immutable';
end$$;
drop trigger protect_snapshot_components on public.snapshot_components;
create trigger protect_snapshot_components before update or delete on public.snapshot_components for each row execute function public.protect_referenced_snapshot_components();
revoke all on function public.protect_referenced_snapshot_components()from public,anon,authenticated;

create function public.retire_unused_snapshot_components(p_backup_name text)returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare src text;n integer;ds constant text:='retired-matching-2026-11-10';
begin
 if auth.role()is distinct from 'service_role'then raise exception 'Service role required';end if;
 if exists(select 1 from lifecycle_jobs where status='RUNNING')then raise exception 'Market sync running';end if;
 if p_backup_name!~'^retired-sections/retired-matching-2026-11-10-[a-f0-9]{64}\.jsonl\.gz$'or not exists(select 1 from storage.objects where bucket_id='radar-archive-backups'and name=p_backup_name)then raise exception 'Private dataset backup required';end if;
 if exists(select 1 from information_schema.columns where table_schema='public'and column_name='component_refs'and table_name<>all(array['snapshot_payload_versions','image_fingerprint_archive_groups']))then raise exception 'Unknown component owner: review references';end if;
 perform set_config('lock_timeout','3s',true);
 lock table public.snapshot_components,public.snapshot_payload_versions,public.evidence_rows,public.image_fingerprint_archive_groups in share row exclusive mode;
 select source into strict src from public.fingerprint_archive_external_config where singleton;
 create temporary table radar_retired_components(id bigint primary key,payload jsonb)on commit drop;
 insert into radar_retired_components select row_id::bigint,payload from radar_external.retired_rows where source=src and dataset=ds and table_name='snapshot_components';
 create temporary table radar_used_components(id bigint primary key)on commit drop;
 insert into radar_used_components
 select content_ref from public.evidence_rows where content_ref is not null
 union select (r.value#>>'{}')::bigint from public.snapshot_payload_versions v cross join lateral jsonb_each(v.component_refs->'payload')r
 union select (component_refs->>'description')::bigint from public.snapshot_payload_versions where component_refs->>'description'is not null
 union select (r.value#>>'{}')::bigint from public.image_fingerprint_archive_groups v cross join lateral jsonb_each(v.component_refs->'payload')r;
 create temporary table radar_verified_unused_components(id bigint primary key,payload_hash text)on commit drop;
 if exists(select 1 from public.snapshot_components c join radar_retired_components r using(id)left join radar_used_components u using(id)where u.id is null and to_jsonb(c)is distinct from r.payload)then raise exception 'Component archive differs: source preserved';end if;
 insert into radar_verified_unused_components select c.id,md5(to_jsonb(c)::text)from public.snapshot_components c join radar_retired_components r using(id)left join radar_used_components u using(id)where u.id is null;
 perform set_config('radar.retire_components','verified',true);
 delete from public.snapshot_components where id in(select id from radar_verified_unused_components);get diagnostics n=row_count;
 insert into public.retired_section_operations(dataset,table_name,removed,backup_name)values(ds,'snapshot_components',n,p_backup_name)on conflict(dataset,table_name)do update set removed=retired_section_operations.removed+excluded.removed,updated_at=now();
 return n;
end$$;
revoke all on function public.retire_unused_snapshot_components(text)from public,anon,authenticated;
grant execute on function public.retire_unused_snapshot_components(text)to service_role;
notify pgrst,'reload schema';
commit;
