begin;
-- Reuse the same verified previous snapshot inside one atomic observation.
-- Otherwise each processed asset could repeat the foreign history read.
do $$declare definition text;matches integer;begin
 select pg_get_functiondef('public.persist_property_lifecycle_observation_atomic(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb,text)'::regprocedure)into definition;
 if position('v_previous_fingerprints' in definition)>0 then raise exception 'Observation already rewritten';end if;
 select count(*)into matches from regexp_matches(definition,'into v_previous_snapshot[[:space:]]+from public\.snapshots[^;]*;','gi');
 if matches<>2 or position('v_previous_snapshot record;'in definition)=0 then raise exception 'Observation snapshot reads not recognized';end if;
 definition:=replace(definition,'v_previous_snapshot record;','v_previous_snapshot record; v_previous_fingerprints public.image_fingerprint_current[]; v_fingerprint_snapshot uuid;');
 definition:=replace(definition,'public.lifecycle_snapshot_fingerprints(v_previous_snapshot.id)','unnest(v_previous_fingerprints)');
 definition:=regexp_replace(definition,'(into v_previous_snapshot[[:space:]]+from public\.snapshots[^;]*;)',E'\\1\n if v_previous_snapshot.id is distinct from v_fingerprint_snapshot then\n select array_agg(f) into v_previous_fingerprints from public.lifecycle_snapshot_fingerprints(v_previous_snapshot.id) f;\n v_fingerprint_snapshot:=v_previous_snapshot.id;end if;','gi');
 execute definition;
end$$;
notify pgrst,'reload schema';
commit;
