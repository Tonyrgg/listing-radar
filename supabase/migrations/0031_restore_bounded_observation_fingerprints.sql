-- 0022 replaced the observation RPC and inadvertently restored unbounded reads
-- of the compacted fingerprint archive fixed by 0018. A changed observation can
-- then exceed the real PostgREST timeout even for a publication with no history.
-- Restore the existing snapshot-scoped helper; preserve every historical row.
begin;
do $$ declare definition text; rewritten text; before_pattern text; after_pattern text;
begin
 definition:=pg_get_functiondef('public.persist_property_lifecycle_observation_atomic(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text)'::regprocedure);
 before_pattern:='from public.image_fingerprints' || chr(10) || '      where snapshot_id = v_previous_snapshot.id';
 after_pattern:='from public.image_fingerprints' || chr(10) || '      where snapshot_id = v_snapshot_id';
 rewritten:=replace(definition,before_pattern,
  'from public.lifecycle_snapshot_fingerprints(v_previous_snapshot.id) where snapshot_id = v_previous_snapshot.id');
 rewritten:=replace(rewritten,after_pattern,
  'from public.lifecycle_snapshot_fingerprints(v_snapshot_id) where snapshot_id = v_snapshot_id');
 rewritten:=replace(rewritten,'from public.image_fingerprints f where f.snapshot_id=v_previous_snapshot.id',
  'from public.lifecycle_snapshot_fingerprints(v_previous_snapshot.id) f where f.snapshot_id=v_previous_snapshot.id');
 if rewritten=definition or rewritten ~ 'from public.image_fingerprints([[:space:]]|$)' then
  raise exception 'Unexpected observation fingerprint query: review before migrating';
 end if;
 execute rewritten;
end $$;
notify pgrst,'reload schema';
commit;
