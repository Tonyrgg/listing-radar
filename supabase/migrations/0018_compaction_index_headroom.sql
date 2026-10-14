-- Preserve uniqueness with transaction locks while reclaiming the oversized URL index.
-- The former index alone consumes ~230 MB on the affected project.
begin;
set local lock_timeout='5s';
create or replace function public.lifecycle_guard_fingerprint_identity() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.snapshot_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.snapshot_id::text||':'||new.canonical_url||':'||new.algorithm,0));
    if exists(select 1 from public.image_fingerprint_current where snapshot_id=new.snapshot_id
      and canonical_url=new.canonical_url and algorithm=new.algorithm) then
      raise exception 'Duplicate fingerprint observation' using errcode='23505';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.lifecycle_guard_fingerprint_identity() from public,anon,authenticated;
drop trigger if exists guard_fingerprint_identity on public.image_fingerprint_current;
create trigger guard_fingerprint_identity before insert on public.image_fingerprint_current
  for each row execute function public.lifecycle_guard_fingerprint_identity();
alter table public.image_fingerprint_current drop constraint if exists image_fingerprints_snapshot_id_canonical_url_algorithm_key;
commit;

-- A separate transaction allows the old index's disk space to be released first.
create index if not exists image_fingerprint_current_snapshot on public.image_fingerprint_current(snapshot_id);

-- A history lookup must inspect only this publication's groups, not expand the entire archive.
create or replace function public.lifecycle_snapshot_fingerprints(p_snapshot_id uuid)
returns setof public.image_fingerprint_current language sql stable security invoker set search_path=public as $$
  select * from public.image_fingerprint_current where snapshot_id=p_snapshot_id
  union all
  select r.* from public.image_fingerprint_archive_groups a
  cross join lateral jsonb_array_elements(a.observations) o
  cross join lateral jsonb_populate_record(null::public.image_fingerprint_current,a.row_data||o.value) r
  where a.publication_id=(select publication_id from public.snapshot_observations where id=p_snapshot_id)
    and a.observations @> jsonb_build_array(jsonb_build_object('snapshot_id',p_snapshot_id))
    and r.snapshot_id=p_snapshot_id;
$$;
revoke all on function public.lifecycle_snapshot_fingerprints(uuid) from public,anon;
grant execute on function public.lifecycle_snapshot_fingerprints(uuid) to authenticated,service_role;
do $$ declare definition text; rewritten text; begin
  definition:=pg_get_functiondef('public.persist_property_lifecycle_observation_atomic(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text)'::regprocedure);
  rewritten:=regexp_replace(definition,'from public.image_fingerprints\s+where snapshot_id = v_previous_snapshot\.id',
    'from public.lifecycle_snapshot_fingerprints(v_previous_snapshot.id) where snapshot_id = v_previous_snapshot.id','g');
  rewritten:=regexp_replace(rewritten,'from public.image_fingerprints\s+where snapshot_id = v_snapshot_id',
    'from public.lifecycle_snapshot_fingerprints(v_snapshot_id) where snapshot_id = v_snapshot_id','g');
  if rewritten=definition and definition not like '%lifecycle_snapshot_fingerprints%' then
    raise exception 'Unexpected fingerprint history query: review before migrating';
  end if;
  execute rewritten;
end $$;
notify pgrst,'reload schema';
