-- A full street read timed out during coverage validation. Aggregate properties once.
begin;
create or replace view public.market_observer_street_intelligence with(security_invoker=true) as
with property_counts as (
 select public.public_record_street_key(p.street_name) street_key,lower(coalesce(p.locality,'Bitonto')) locality_key,
  count(*)::integer known_properties,count(*) filter(where p.state='ACTIVE')::integer active_properties,
  count(*) filter(where p.exit_classification in('SOLD_CONFIRMED','SOLD_PROBABLE'))::integer sold_observed
 from public.market_observer_property_archive p group by 1,2
)
select s.id street_id,s.canonical_name,s.locality,
 coalesce(p.known_properties,0) known_properties,coalesce(p.active_properties,0) active_properties,coalesce(p.sold_observed,0) sold_observed,
 count(distinct rs.record_id)::integer public_record_count,max(r.record_date) latest_record_date,
 count(distinct rs.record_id) filter(where r.recent_record)::integer recent_record_count,
 (array_agg(r.title order by r.record_date desc nulls last,r.id) filter(where r.id is not null))[1] latest_record_title
from public.street_registry_streets s
left join property_counts p on p.street_key=public.public_record_street_key(s.canonical_name) and p.locality_key=lower(coalesce(s.locality,'Bitonto'))
left join public.market_observer_public_record_streets rs on rs.street_id=s.id
left join public.market_observer_territorial_signals r on r.id=rs.record_id
group by s.id,p.known_properties,p.active_properties,p.sold_observed;
notify pgrst,'reload schema';
commit;
