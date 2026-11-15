begin;
-- A scan performed before linking an OSM segment belongs to its official street.
do $$declare definition text;old_text text;new_text text;begin
 select pg_get_functiondef('public.read_worker_street_directory(uuid)'::regprocedure) into definition;
 old_text:=$old$scans as(select value->>'streetId' street_id,max(value->>'endedAt') at from records where collection='runs' and value->>'operation'='scan' and value->>'state'='completed' group by 1)$old$;
 new_text:=$new$scans as(select coalesce(s.value->>'linkedOfficialId',r.value->>'streetId') street_id,max(r.value->>'endedAt') at from records r left join records s on s.collection='streets' and s.record_key=r.value->>'streetId' where r.collection='runs' and r.value->>'operation'='scan' and r.value->>'state'='completed' group by 1)$new$;
 if position(old_text in definition)=0 then raise exception 'Directory scan projection not recognized';end if;
 execute replace(definition,old_text,new_text);
end$$;
notify pgrst,'reload schema';
commit;
