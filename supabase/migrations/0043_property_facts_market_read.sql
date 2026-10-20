begin;
-- Avoid recomputing document density/timeline inside every semantic event page.
-- Market crossover uses the same existing V2 property/building associations.
create or replace view public.market_observer_property_facts with(security_invoker=true) as
WITH market as materialized (
 select bp.building_id,count(distinct bp.property_id)::integer known_properties,
 count(distinct bp.property_id) filter(where a.state='ACTIVE')::integer active_properties,
 (count(distinct bp.property_id)-count(distinct bp.property_id) filter(where a.state='ACTIVE'))::integer historical_properties,
 count(distinct bp.property_id) filter(where a.exit_classification in('SOLD_CONFIRMED','SOLD_PROBABLE'))::integer sold_observed,
 array_agg(distinct a.agency_name) filter(where a.agency_name is not null) agencies
 from market_observer_graph_building_properties bp
 left join market_observer_property_archive a on a.property_id=bp.property_id group by bp.building_id
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
 coalesce(b.known_properties,0) known_properties,coalesce(b.active_properties,0) active_properties,
 coalesce(b.historical_properties,0) historical_properties,coalesce(b.sold_observed,0) sold_observed,coalesce(b.agencies,'{}'::text[]) agencies,
 e fact,r.practice_number
from public_record_territorial_resolutions d
join market_observer_public_records r on r.id=d.record_id and r.content_hash=d.input_hash and r.content_hash=d.semantic_input_hash
cross join lateral jsonb_array_elements(d.semantic_projection->'events') e
left join lateral(select min(s.street_id::text)::uuid street_id from market_observer_graph_record_streets s where s.record_id=r.id having count(distinct s.street_id)=1) st on true
left join lateral(select min(l.building_id::text)::uuid building_id from building_practice_buildings l
 where l.practice_record_id=r.id and l.is_current and l.match_confidence>=.95
 and jsonb_array_length(d.references_json)=1 and jsonb_array_length(coalesce(d.references_json->0->'civics','[]'))=1
 having count(distinct l.building_id)=1) loc on true
left join market b on b.building_id=loc.building_id
where coalesce(r.source_status,'') !~* 'revoc|annull|revoke|cancel';
notify pgrst,'reload schema';
commit;
