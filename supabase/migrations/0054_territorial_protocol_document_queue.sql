begin;

create or replace view public.market_observer_practice_document_queue with(security_invoker=true) as
select r.id index_record_id,r.application_code,r.practice_number,r.protocol_number,
 (r.occurred_at at time zone 'UTC')::date protocol_date,r.intervention_type,r.content_hash,r.source_url,
 case when s.index_record_id is null then 'PENDING'
  when s.index_input_hash<>r.content_hash or (s.primary_record_id is not null and p.content_hash is distinct from s.primary_input_hash) then 'STALE'
  else s.search_state end search_state,
 s.candidate_count,s.checked_at,s.policy_version,
 case when s.index_input_hash=r.content_hash and p.content_hash=s.primary_input_hash then p.id end primary_record_id,
 case when s.index_input_hash=r.content_hash and p.content_hash=s.primary_input_hash then p.source_url end primary_source_url,
 case when s.index_input_hash=r.content_hash and p.content_hash=s.primary_input_hash and s.search_state='LINKED' then p.document_urls else '[]'::jsonb end document_urls,
 r.source_key,
 array(select jsonb_array_elements_text(coalesce(r.sanitized_payload->'documentSearchTopics',
  case r.intervention_type when 'FRAZIONAMENTO' then '["SPLIT"]'::jsonb when 'FUSIONE_ACCOPPIAMENTO' then '["MERGE"]'::jsonb
   when 'CAMBIO_DESTINAZIONE_USO' then '["USE_CHANGE"]'::jsonb when 'FINE_LAVORI' then '["COMPLETION"]'::jsonb
   when 'AGIBILITA' then '["COMPLETION"]'::jsonb when 'NUOVA_COSTRUZIONE' then '["NEW_BUILDING"]'::jsonb else '[]'::jsonb end))) search_topics
from public.building_practice_records r
left join public.building_practice_document_search s on s.index_record_id=r.id
left join public.building_practice_records p on p.id=s.primary_record_id
where r.source_key in ('comune-bitonto-elenco-pratiche-2025','comune-bitonto-protocolli-territorio')
 and coalesce(r.sanitized_payload->>'treatment','')<>'ARCHIVE_ONLY_JUDICIAL'
 -- The same complete administrative identity in both registries is shown once.
 and not (r.source_key='comune-bitonto-elenco-pratiche-2025'
  and r.sanitized_payload->'registryIdentity' is not null and r.sanitized_payload->'registryIdentity'<>'null'::jsonb
  and exists(select 1 from public.building_practice_records other
   where other.source_key='comune-bitonto-protocolli-territorio' and other.application_code=r.application_code
    and other.sanitized_payload->'registryIdentity'=r.sanitized_payload->'registryIdentity'
    and coalesce(other.sanitized_payload->>'treatment','')<>'ARCHIVE_ONLY_JUDICIAL'));

notify pgrst, 'reload schema';
commit;
