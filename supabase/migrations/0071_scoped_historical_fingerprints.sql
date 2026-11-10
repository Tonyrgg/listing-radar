begin;
-- The crawler reads a previous snapshot repeatedly. Never expand the entire
-- foreign archive before applying that snapshot's publication filter.
create or replace function public.lifecycle_snapshot_fingerprints(p_snapshot_id uuid)
returns setof public.image_fingerprint_current language plpgsql stable security invoker set search_path=public as $$
declare pub uuid;ids bigint[];
begin
 return query select * from public.image_fingerprint_current where snapshot_id=p_snapshot_id;
 select publication_id into pub from public.snapshot_observations where id=p_snapshot_id;
 if not found then return;end if;
 return query select r.* from public.fingerprint_archive_pending_expanded a
 cross join lateral jsonb_array_elements(a.observations)o
 cross join lateral jsonb_populate_record(null::public.image_fingerprint_current,a.row_data||o.value)r
 where a.publication_id is not distinct from pub and r.snapshot_id=p_snapshot_id;
 select array_agg(id)into ids from public.fingerprint_archive_receipts where publication_id is not distinct from pub;
 if cardinality(ids)>0 then
  return query select r.* from public.read_external_fingerprint_groups(ids)a
  cross join lateral jsonb_array_elements(a.observations)o
  cross join lateral jsonb_populate_record(null::public.image_fingerprint_current,a.row_data||o.value)r where r.snapshot_id=p_snapshot_id;
 end if;
end$$;
revoke all on function public.lifecycle_snapshot_fingerprints(uuid) from public,anon;
grant execute on function public.lifecycle_snapshot_fingerprints(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
