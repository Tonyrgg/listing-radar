begin;
-- Separate source and destination representations: JSON numeric values can be
-- equal even when their serialized scale differs (1.0 vs 1).
alter table public.fingerprint_archive_receipts add column external_payload_md5 text;
do $$declare definition text;begin
 select pg_get_functiondef('public.acknowledge_external_fingerprint_groups(bigint[])'::regprocedure)into definition;
 definition:=replace(definition,'observation_count,payload_md5)','observation_count,payload_md5,external_payload_md5)');
 definition:=replace(definition,$old$jsonb_array_length(local_payload->'observations'),md5(local_payload::text))$old$, $new$jsonb_array_length(local_payload->'observations'),md5(local_payload::text),md5(remote_payload::text))$new$);
 definition:=replace(definition,'fingerprint_archive_receipts.payload_md5=excluded.payload_md5','fingerprint_archive_receipts.payload_md5=excluded.payload_md5 and fingerprint_archive_receipts.external_payload_md5=excluded.external_payload_md5');
 if position('md5(remote_payload::text)'in definition)=0 then raise exception 'Receipt function not recognized';end if;
 execute definition;
end$$;
commit;
