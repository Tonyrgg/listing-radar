begin;
-- Semantic projection on the existing resolution, not a second document/event archive.
-- building_events is append-only, requires a building AND an occurred_at; it cannot
-- represent undated, street/area facts without inventing identity or dates.
alter table public.public_record_territorial_resolutions
 add column semantic_projection jsonb not null default '{}',
 add column semantic_input_hash text,
 add column semantic_evaluated_at timestamptz;

create function public.project_public_record_facts(p_records jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare v jsonb; e jsonb; n integer:=0; rid uuid; h text;
begin
 if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>100 then raise exception 'Bounded semantic batch required';end if;
 for v in select value from jsonb_array_elements(p_records) loop
  rid:=(v->>'recordId')::uuid;
  select content_hash into h from building_practice_records where id=rid for share;
  if h is null or h is distinct from v->>'inputHash' then raise exception 'Stale semantic input';end if;
  if v->'projection'->>'version' is distinct from 'property_facts_v1'
   or jsonb_typeof(v->'projection'->'events') is distinct from 'array'
   or jsonb_array_length(v->'projection'->'events')>40 or octet_length((v->'projection')::text)>100000 then raise exception 'Invalid semantic projection';end if;
  for e in select value from jsonb_array_elements(v->'projection'->'events') loop
   if length(coalesce(e->>'evidence_text','')) not between 2 and 180
    or e->>'classification_version' is distinct from 'property_facts_v1'
    or e->>'id' !~ '^[a-f0-9]{64}$'
    or (e->>'confidence')::numeric not between 0 and 1
    or (e->>'real_estate_relevance')::numeric not between 0 and 100
    or coalesce(e->'evidence_location'->>'source_url','') !~ '^https://'
    or coalesce(e->'evidence_location'->>'source_hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(e->'evidence_location'->>'field','') not in('practice_type','Oggetto','Oggetto Fascicolo','Tipo Pratica','albo.subject','pdf.text')
    or (e->'evidence_location'->>'field'='pdf.text' and coalesce((e->'evidence_location'->>'page')::integer,0)<1)
    or e->>'event_type'='BUILDABILITY_CHANGED' then raise exception 'Evidence-bound event required';end if;
   perform (e->>'observed_at')::timestamptz;
   if e->>'event_date' is not null then perform (e->>'event_date')::date;end if;
  end loop;
  update public_record_territorial_resolutions set semantic_projection=v->'projection',semantic_input_hash=h,semantic_evaluated_at=now()
   where record_id=rid and input_hash=h and (semantic_input_hash is distinct from h or semantic_projection is distinct from v->'projection');
  if not exists(select 1 from public_record_territorial_resolutions where record_id=rid and input_hash=h) then raise exception 'Territorial projection required first';end if;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.project_public_record_facts(jsonb) from public,anon,authenticated;
grant execute on function public.project_public_record_facts(jsonb) to service_role;

create view public.market_observer_property_facts with(security_invoker=true) as
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
 e fact
from public_record_territorial_resolutions d
join market_observer_public_records r on r.id=d.record_id and r.content_hash=d.input_hash and r.content_hash=d.semantic_input_hash
cross join lateral jsonb_array_elements(d.semantic_projection->'events') e
left join lateral(select min(s.street_id::text)::uuid street_id from market_observer_graph_record_streets s where s.record_id=r.id having count(distinct s.street_id)=1) st on true
left join lateral(select min(l.building_id::text)::uuid building_id from building_practice_buildings l
 where l.practice_record_id=r.id and l.is_current and l.match_confidence>=.95
 and jsonb_array_length(d.references_json)=1 and jsonb_array_length(coalesce(d.references_json->0->'civics','[]'))=1
 having count(distinct l.building_id)=1) loc on true
left join market_observer_graph_building_context b on b.building_id=loc.building_id
where coalesce(r.source_status,'') !~* 'revoc|annull|revoke|cancel';
grant select on public.market_observer_property_facts to authenticated,service_role;
notify pgrst,'reload schema';
commit;
