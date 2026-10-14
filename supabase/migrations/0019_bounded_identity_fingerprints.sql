-- Read distinct values once per bounded property batch, without expanding history
-- or recomputing a global DISTINCT for every PostgREST page.
begin;
create function public.lifecycle_identity_fingerprint_bundles(p_property_ids uuid[])
returns table(property_id uuid,images jsonb,floorplans jsonb)
language plpgsql stable security invoker set search_path=public as $$
begin
  if p_property_ids is null or cardinality(p_property_ids)>75 then
    raise exception 'A batch of at most 75 property IDs is required';
  end if;
  return query
  with values_for_batch as (
    select f.property_id,'IMAGE'::text kind,f.algorithm,f.fingerprint
    from public.image_fingerprint_current f where f.property_id=any(p_property_ids)
    union
    select a.property_id,'IMAGE'::text,a.row_data->>'algorithm',a.row_data->>'fingerprint'
    from public.image_fingerprint_archive_groups a where a.property_id=any(p_property_ids)
    union
    select f.property_id,'FLOORPLAN'::text,f.algorithm,f.fingerprint
    from public.floorplan_fingerprints f where f.property_id=any(p_property_ids)
  )
  select v.property_id,
    coalesce(jsonb_agg(jsonb_build_object('algorithm',v.algorithm,'fingerprint',v.fingerprint)
      order by v.algorithm,v.fingerprint) filter(where v.kind='IMAGE'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('algorithm',v.algorithm,'fingerprint',v.fingerprint)
      order by v.algorithm,v.fingerprint) filter(where v.kind='FLOORPLAN'),'[]'::jsonb)
  from values_for_batch v group by v.property_id order by v.property_id;
end $$;
revoke all on function public.lifecycle_identity_fingerprint_bundles(uuid[]) from public,anon;
grant execute on function public.lifecycle_identity_fingerprint_bundles(uuid[]) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
