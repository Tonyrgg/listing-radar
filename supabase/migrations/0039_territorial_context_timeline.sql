begin;
create view public.market_observer_graph_public_records with(security_invoker=true) as
select r.*,t.references_json resolved_references,t.unmatched_cause,t.policy_version territorial_policy_version
from market_observer_public_records r left join public_record_territorial_resolutions t on t.record_id=r.id and t.input_hash=r.content_hash;
create view public.market_observer_graph_record_property_links with(security_invoker=true) as
select distinct l.practice_record_id record_id,bp.property_id,l.building_id,l.match_confidence,'BUILDING'::text relation_scope,'REVIEW_REQUIRED'::text unit_match
from building_practice_buildings l join market_observer_graph_building_properties bp on bp.building_id=l.building_id where l.is_current;
create view public.market_observer_graph_property_context with(security_invoker=true) as
with building_counts as (
 select bp.property_id,count(distinct l.practice_record_id)::int records,
 count(distinct l.practice_record_id) filter(where r.recent90)::int recent,
 array_agg(distinct bp.building_id) building_ids
 from market_observer_graph_building_properties bp left join building_practice_buildings l on l.building_id=bp.building_id and l.is_current
 left join market_observer_graph_record_facts r on r.id=l.practice_record_id group by bp.property_id
), street_counts as (
 select rs.street_id,count(distinct r.id)::int records,count(distinct r.id) filter(where r.recent90)::int recent
 from market_observer_graph_record_streets rs join market_observer_graph_record_facts r on r.id=rs.record_id group by rs.street_id
)
select p.id property_id,0::int specific_record_count,coalesce(b.records,0) building_record_count,
 coalesce(b.recent,0) recent_building_count,coalesce(b.building_ids,'{}') context_building_ids,l.territorial_street_id context_street_id,
 coalesce(s.records,0) street_record_count,coalesce(s.recent,0) recent_street_count,'REVIEW_REQUIRED'::text unit_match
from properties p left join locations l on l.id=p.primary_location_id left join building_counts b on b.property_id=p.id
left join street_counts s on s.street_id=l.territorial_street_id where p.identity_status<>'MERGED';

create view public.market_observer_graph_property_archive with(security_invoker=true) as
select a.*,g.specific_record_count,g.building_record_count,g.recent_building_count,g.context_building_ids,g.context_street_id,
 g.street_record_count,g.recent_street_count,g.unit_match from market_observer_territorial_property_archive a
left join market_observer_graph_property_context g using(property_id);

create function public.read_territorial_timeline(p_scope text,p_id uuid,p_limit integer default 30,p_offset integer default 0)
returns table(event_id text,event_at timestamptz,event_kind text,title text,relation_scope text,date_precision text,source_url text,record_id uuid,property_id uuid)
language sql stable security invoker set search_path=public as $$
 with scope_properties as materialized (
  select bp.property_id from market_observer_graph_building_properties bp where p_scope='BUILDING' and bp.building_id=p_id
  union select p.id from properties p join locations l on l.id=p.primary_location_id where p_scope='STREET' and l.territorial_street_id=p_id and p.identity_status<>'MERGED'
 ), scope_records as (
  select l.practice_record_id id from building_practice_buildings l where p_scope='BUILDING' and l.building_id=p_id and l.is_current
  union select rs.record_id from market_observer_graph_record_streets rs where p_scope='STREET' and rs.street_id=p_id
 ), history as (
  select 'record:'||r.id::text event_id,r.record_date::timestamptz event_at,'PUBLIC_RECORD'::text event_kind,r.title,p_scope relation_scope,'DAY'::text date_precision,r.source_url,r.id record_id,null::uuid property_id
   from market_observer_public_records r join scope_records sr on sr.id=r.id where r.record_date is not null
  union all
  select 'market:'||a.property_id::text,a.earliest_market_evidence_at,'FIRST_MARKET_EVIDENCE',a.address,p_scope,'SOURCE_CLAIM_OR_OBSERVATION',a.market_evidence_provenance->>'url',null::uuid,a.property_id
   from market_observer_property_archive a join scope_properties s using(property_id) where a.earliest_market_evidence_at is not null
  union all
  select 'sold:'||a.property_id::text,coalesce(a.sold_at,a.sold_observed_at),'SOLD_EVIDENCE',a.address,p_scope,
   case when a.sold_at is not null then 'EXPLICIT_SOURCE_DATE' else 'OBSERVED_AT' end,null::text,null::uuid,a.property_id
   from market_observer_property_archive a join scope_properties s using(property_id)
   where a.exit_classification in('SOLD_CONFIRMED','SOLD_PROBABLE') and coalesce(a.sold_at,a.sold_observed_at) is not null
  union all
  select 'listing:'||al.id::text,al.first_seen_at,'LISTING_FIRST_OBSERVED',ag.name,p_scope,'OBSERVED_AT',null::text,null::uuid,al.property_id
   from agency_listings al join scope_properties s using(property_id) join agencies ag on ag.id=al.agency_id
  union all
  select 'event:'||e.id::text,e.occurred_at,e.event_type,coalesce(u.source_key,'Mercato osservato'),p_scope,'OBSERVED_EVENT',u.canonical_url,null::uuid,e.property_id
   from events e join scope_properties s using(property_id) left join publications u on u.id=e.publication_id
   where e.event_type in('PRICE_DROP','PRICE_INCREASE','PRICE_CHANGE','EXIT_CANDIDATE','EXIT_CONFIRMED','SOLD_MARKED','SOLD_CONFIRMED','REACTIVATED','RELISTED','AGENCY_SWITCH')
 ) select * from history where p_scope in('BUILDING','STREET') order by event_at desc,event_id limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
$$;
grant select on public.market_observer_graph_record_property_links,public.market_observer_graph_public_records,public.market_observer_graph_property_context,public.market_observer_graph_property_archive to authenticated,service_role;
revoke all on function public.read_territorial_timeline(text,uuid,integer,integer) from public,anon;
grant execute on function public.read_territorial_timeline(text,uuid,integer,integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
