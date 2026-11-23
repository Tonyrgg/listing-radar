begin;

-- A larger REST transaction budget applies only to manual browser captures.
create function public.persist_worker_open_tab_observation(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_listing jsonb,
  p_identity_decision jsonb,
  p_processed_assets jsonb,
  p_location_normalized_key text,
  p_building jsonb,
  p_media_market_start jsonb,
  p_failure_point text
) returns jsonb
language sql
set search_path = ''
set statement_timeout = '10s'
as $$
  select public.persist_property_lifecycle_observation_atomic(
    p_agency_id, p_sync_run_id, p_listing, p_identity_decision, p_processed_assets,
    p_location_normalized_key, p_building, p_media_market_start, p_failure_point
  );
$$;

revoke all on function public.persist_worker_open_tab_observation(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_worker_open_tab_observation(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text) to service_role;
notify pgrst, 'reload schema';
commit;
