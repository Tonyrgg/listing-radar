begin;
-- The Worker classifies documentary evidence without computing market totals.
create view public.worker_document_map_facts with(security_invoker=true) as
WITH record_streets as materialized (
 select record_id,min(street_id::text)::uuid street_id from market_observer_graph_record_streets
 group by record_id having count(distinct street_id)=1
), record_buildings as materialized (
 select practice_record_id record_id,min(building_id::text)::uuid building_id
 from building_practice_buildings where is_current and match_confidence>=.95
 group by practice_record_id having count(distinct building_id)=1
)
select e->>'id' event_id,r.id record_id,r.source_key source,r.source_url record_source_url,
 e->>'event_type' event_type,e->>'event_subtype' event_subtype,
 (e->>'event_date')::date event_date,e->>'date_semantics' date_semantics,
 (e->>'observed_at')::timestamptz observed_at,r.first_seen_at record_first_seen_at,
 (e->>'confidence')::numeric confidence,e->>'evidence_text' evidence_text,e->'evidence_location' evidence_location,
 e->>'classification_version' classification_version,(e->>'real_estate_relevance')::integer real_estate_relevance,
 e->>'sale_proximity' sale_proximity,e->>'works_lifecycle' works_lifecycle,e->'units_before' units_before,e->'units_after' units_after,
 e->>'from_use' from_use,e->>'to_use' to_use,e->>'ownership_scope' ownership_scope,e->'derived_signals' derived_signals,
 case when loc.building_id is not null then 'BUILDING' when st.street_id is not null then 'STREET' else 'AREA' end territorial_level,
 loc.building_id,st.street_id,null::uuid property_id,
 case when jsonb_array_length(d.references_json)=1 then d.references_json->0->>'streetName' end street,
 case when jsonb_array_length(d.references_json)=1 and jsonb_array_length(coalesce(d.references_json->0->'civics','[]'))=1 then d.references_json->0->'civics'->>0 end civic,
 r.area_name,r.content_hash,
 e fact,r.practice_number
from public_record_territorial_resolutions d
join market_observer_public_records r on r.id=d.record_id and r.content_hash=d.input_hash and r.content_hash=d.semantic_input_hash
cross join lateral jsonb_array_elements(d.semantic_projection->'events') e
left join record_streets st on st.record_id=r.id
left join record_buildings loc on loc.record_id=r.id and jsonb_array_length(d.references_json)=1
 and jsonb_array_length(coalesce(d.references_json->0->'civics','[]'))=1
where coalesce(r.source_status,'') !~* 'revoc|annull|revoke|cancel';
revoke all on public.worker_document_map_facts from public,anon,authenticated;
grant select on public.worker_document_map_facts to service_role;
notify pgrst,'reload schema';
commit;
