begin;
-- Derived resolution only: source metadata, coordinates, hashes and first_seen stay intact.
alter table public.locations add column territorial_street_id uuid references public.street_registry_streets(id),
 add column territorial_civic text, add column territorial_resolution jsonb not null default '{}';
create index locations_territorial_identity_idx on public.locations(territorial_street_id,territorial_civic);
create table public.public_record_territorial_resolutions (
 record_id uuid primary key references public.building_practice_records(id) on delete restrict,
 input_hash text not null, policy_version text not null, references_json jsonb not null default '[]',
 candidate_building_ids uuid[] not null default '{}', unmatched_cause text,
 evaluated_at timestamptz not null default now(),
 check(unmatched_cause is null or unmatched_cause in('NO_ADDRESS_AVAILABLE','STREET_ONLY','STREET_AND_CIVIC_NOT_IN_REGISTRY','CIVIC_AMBIGUOUS','MULTIPLE_BUILDING_CANDIDATES','LOCALITY_ONLY','CADASTRAL_ONLY','AREA_DOCUMENT','DATASET_WITHOUT_TERRITORIAL_FIELDS','NORMALIZATION_FAILURE','OTHER')),
 check(jsonb_typeof(references_json)='array')
);
alter table public.public_record_territorial_resolutions enable row level security;
create policy territorial_resolution_read on public.public_record_territorial_resolutions for select to authenticated using(true);
create policy territorial_resolution_service on public.public_record_territorial_resolutions for all to service_role using(true) with check(true);
grant select on public.public_record_territorial_resolutions to authenticated;
grant all on public.public_record_territorial_resolutions to service_role;

create function public.recompute_territorial_graph(p_locations jsonb,p_records jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v jsonb; ref jsonb; civic text; bid uuid; n integer; applied integer:=0; links integer:=0;
begin
 if jsonb_typeof(p_locations)<>'array' or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_locations)>100 or jsonb_array_length(p_records)>100 then raise exception 'Bounded graph batch required';end if;
 for v in select value from jsonb_array_elements(p_locations) loop
  if v->>'streetId' is not null and not exists(select 1 from street_registry_streets where id=(v->>'streetId')::uuid and record_status='active') then raise exception 'Unknown street';end if;
  if v->>'civic' is not null and v->>'civic' !~ '^\d+[a-z]{0,2}$' then raise exception 'Exact civic required';end if;
  update locations set territorial_street_id=(v->>'streetId')::uuid,territorial_civic=v->>'civic',territorial_resolution=v-'id'
   where id=(v->>'id')::uuid and (territorial_resolution,territorial_street_id,territorial_civic) is distinct from (v-'id',(v->>'streetId')::uuid,v->>'civic');
 end loop;
 for v in select value from jsonb_array_elements(p_records) loop
  -- A plan made before a source refresh cannot replace the projection for a new hash.
  if not exists(select 1 from building_practice_records where id=(v->>'id')::uuid and content_hash=v->>'inputHash') then raise exception 'Stale graph input';end if;
  insert into public_record_territorial_resolutions(record_id,input_hash,policy_version,references_json,candidate_building_ids,unmatched_cause)
   values((v->>'id')::uuid,v->>'inputHash',v->>'version',v->'references',array(select jsonb_array_elements_text(v->'candidateBuildingIds')::uuid),v->>'unmatchedCause')
   on conflict(record_id) do update set input_hash=excluded.input_hash,policy_version=excluded.policy_version,references_json=excluded.references_json,
    candidate_building_ids=excluded.candidate_building_ids,unmatched_cause=excluded.unmatched_cause,evaluated_at=now()
    where (public_record_territorial_resolutions.input_hash,public_record_territorial_resolutions.policy_version,public_record_territorial_resolutions.references_json,public_record_territorial_resolutions.candidate_building_ids,public_record_territorial_resolutions.unmatched_cause)
    is distinct from (excluded.input_hash,excluded.policy_version,excluded.references_json,excluded.candidate_building_ids,excluded.unmatched_cause);
  for ref in select value from jsonb_array_elements(v->'references') loop
   if nullif(ref->>'streetId','') is null or ref->>'civicState'<>'EXPLICIT' then continue;end if;
   for civic in select jsonb_array_elements_text(ref->'civics') loop
    select count(*),min(b.id::text)::uuid into n,bid from buildings b join locations l on l.id=b.location_id
     where l.territorial_street_id=(ref->>'streetId')::uuid and l.territorial_civic=civic and l.territorial_resolution->>'status'='RESOLVED';
    if n=1 then
     insert into building_practice_buildings(practice_record_id,building_id,match_confidence,match_reasons,matcher_version)
      values((v->>'id')::uuid,bid,.95,'["unique_official_street","exact_civic","unique_existing_building","property_unit_not_asserted"]',v->>'version')
      on conflict(practice_record_id,building_id) do nothing;
     get diagnostics n=row_count;links:=links+n;
    end if;
   end loop;
  end loop;applied:=applied+1;
 end loop;return jsonb_build_object('recordsProcessed',applied,'newBuildingLinks',links);
end $$;
revoke all on function public.recompute_territorial_graph(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.recompute_territorial_graph(jsonb,jsonb) to service_role;

create view public.market_observer_graph_record_streets with(security_invoker=true) as
select distinct t.record_id,s.id street_id,s.canonical_name,s.locality,s.geometry,'STREET'::text relation_scope
from public_record_territorial_resolutions t join building_practice_records r on r.id=t.record_id and r.content_hash=t.input_hash
cross join lateral jsonb_array_elements(t.references_json) ref join street_registry_streets s on s.id::text=ref->>'streetId'
union
select rs.* from market_observer_public_record_streets rs where not exists(
 select 1 from public_record_territorial_resolutions t join building_practice_records r on r.id=t.record_id and r.content_hash=t.input_hash where t.record_id=rs.record_id);

create view public.market_observer_graph_building_properties with(security_invoker=true) as
select * from market_observer_building_properties
union
select b.id,p.id,'BUILDING'::text,'REVIEW_REQUIRED'::text
from buildings b join locations bl on bl.id=b.location_id
join locations pl on pl.territorial_street_id=bl.territorial_street_id and pl.territorial_civic=bl.territorial_civic
join properties p on p.primary_location_id=pl.id and p.identity_status<>'MERGED'
where bl.territorial_civic is not null and bl.territorial_resolution->>'status'='RESOLVED' and pl.territorial_resolution->>'status'='RESOLVED'
 and not exists(select 1 from buildings other_b join locations other_l on other_l.id=other_b.location_id where other_b.id<>b.id and other_l.territorial_street_id=bl.territorial_street_id and other_l.territorial_civic=bl.territorial_civic);

create function public.territorial_activity(p30 integer,p90 integer,p_categories integer,p_practices integer,p_works integer) returns jsonb
language sql immutable parallel safe as $$
 select jsonb_build_object('version','territorial_activity_v1','score',least(40,greatest(p30,0)*10)+least(20,greatest(p90-p30,0)*4)+least(15,greatest(p_categories,0)*5)+case when p_practices>0 then 15 else 0 end+case when p_works>0 then 10 else 0 end,
 'breakdown',jsonb_build_object('recent30',least(40,greatest(p30,0)*10),'older90',least(20,greatest(p90-p30,0)*4),'diversity',least(15,greatest(p_categories,0)*5),'buildingPractice',case when p_practices>0 then 15 else 0 end,'publicWorks',case when p_works>0 then 10 else 0 end),
 'reasons',jsonb_build_object('records30',p30,'records90',p90,'recentCategories',p_categories,'recentPractices',p_practices,'recentWorks',p_works),'meaning','observed_public_activity_not_sale_probability')
$$;

-- Cheap dated record facts, without correlated property counts from the Phase 2 signal view.
create view public.market_observer_graph_record_facts with(security_invoker=true) as
select r.*,coalesce(r.source_status,'')!~* 'annull|revocat|revok|cancel' and r.record_date between current_date-30 and current_date recent30,
 coalesce(r.source_status,'')!~* 'annull|revocat|revok|cancel' and r.record_date between current_date-90 and current_date recent90
from market_observer_public_records r;

create view public.market_observer_graph_building_context with(security_invoker=true) as
with documents as (
 select l.building_id,count(distinct r.id)::int documents,
 count(distinct r.id) filter(where r.recent30)::int recent30,count(distinct r.id) filter(where r.recent90)::int recent90,
 count(distinct r.record_type) filter(where r.recent90)::int recent_categories,
 count(*) filter(where r.recent90 and r.record_type in('CILA','SCIA','AGIBILITA','AGIBILITY_SIGNAL','BUILDING_PERMIT','PERMESSO_COSTRUIRE','SANATORIA','CONDONO'))::int recent_practices,
 count(*) filter(where r.recent90 and r.record_type in('PUBLIC_WORK','ROAD_WORK','VIABILITY'))::int recent_works,
 jsonb_object_agg(r.id::text,r.record_type) categories_by_record,max(r.record_date) last_activity,
 jsonb_agg(jsonb_build_object('recordId',r.id,'sourceUrl',r.source_url,'references',r.cadastral_references)) filter(where jsonb_array_length(r.cadastral_references)>0) declared_cadastral_references
 from building_practice_buildings l join market_observer_graph_record_facts r on r.id=l.practice_record_id where l.is_current group by l.building_id
), portfolio as (
 select bp.building_id,count(distinct bp.property_id)::int properties,count(distinct bp.property_id) filter(where a.state='ACTIVE')::int active,
 count(distinct bp.property_id) filter(where a.exit_classification in('SOLD_CONFIRMED','SOLD_PROBABLE'))::int sold,
 count(distinct u.id)::int publications,array_agg(distinct ag.name) filter(where ag.id is not null) agencies
 from market_observer_graph_building_properties bp left join market_observer_property_archive a on a.property_id=bp.property_id
 left join agency_listings al on al.property_id=bp.property_id left join publications u on u.agency_listing_id=al.id
 left join agencies ag on ag.id=al.agency_id group by bp.building_id
)
select b.id building_id,b.display_name,b.location_id,l.street_name,l.street_number civic,l.locality,l.territorial_street_id street_id,
 coalesce(s.canonical_name,l.street_name) canonical_street,array_remove(array[l.street_number,l.territorial_civic],null) civic_variants,
 l.latitude,l.longitude,l.precision_level precision_type,l.territorial_civic canonical_civic,l.territorial_resolution,
 coalesce(p.properties,0) known_properties,coalesce(p.active,0) active_properties,coalesce(p.properties,0)-coalesce(p.active,0) historical_properties,
 coalesce(p.sold,0) sold_observed,coalesce(p.publications,0) publications,coalesce(p.agencies,'{}') agencies,
 coalesce(d.documents,0) public_record_count,coalesce(d.recent30,0) recent30,coalesce(d.recent90,0) recent90,d.last_activity,
 coalesce(d.categories_by_record,'{}') categories_by_record,coalesce(d.declared_cadastral_references,'[]') declared_cadastral_references,
 territorial_activity(coalesce(d.recent30,0),coalesce(d.recent90,0),coalesce(d.recent_categories,0),coalesce(d.recent_practices,0),coalesce(d.recent_works,0)) activity
from buildings b left join locations l on l.id=b.location_id left join street_registry_streets s on s.id=l.territorial_street_id left join documents d on d.building_id=b.id left join portfolio p on p.building_id=b.id;

create view public.market_observer_graph_street_context with(security_invoker=true) as
with documents as (
 select s.street_id,count(distinct r.id)::int documents,count(distinct r.id) filter(where r.recent30)::int recent30,
 count(distinct r.id) filter(where r.recent90)::int recent90,count(distinct r.record_type) filter(where r.recent90)::int recent_categories,
 count(*) filter(where r.recent90 and r.record_type in('CILA','SCIA','AGIBILITA','AGIBILITY_SIGNAL','BUILDING_PERMIT','PERMESSO_COSTRUIRE','SANATORIA','CONDONO'))::int practices,
 count(*) filter(where r.recent90 and r.record_type in('PUBLIC_WORK','ROAD_WORK','VIABILITY'))::int works,
 jsonb_object_agg(r.id::text,r.record_type) categories_by_record,max(r.record_date) last_activity
 from market_observer_graph_record_streets s join market_observer_graph_record_facts r on r.id=s.record_id group by s.street_id
), portfolio as (
 select l.territorial_street_id street_id,count(distinct a.property_id)::int properties,count(distinct a.property_id) filter(where a.state='ACTIVE')::int active,
 count(distinct a.property_id) filter(where a.exit_classification in('SOLD_CONFIRMED','SOLD_PROBABLE'))::int sold,
 array_agg(distinct a.agency_name) agencies from properties p join locations l on l.id=p.primary_location_id
 join market_observer_property_archive a on a.property_id=p.id where l.territorial_street_id is not null group by l.territorial_street_id
), building_counts as (select l.territorial_street_id street_id,count(*)::int buildings from buildings b join locations l on l.id=b.location_id group by l.territorial_street_id)
select s.id street_id,s.canonical_name,s.locality,s.geometry,'STREET'::text precision_type,
 coalesce(p.properties,0) known_properties,coalesce(p.active,0) active_properties,coalesce(p.properties,0)-coalesce(p.active,0) historical_properties,
 coalesce(p.sold,0) sold_observed,coalesce(p.agencies,'{}') agencies,coalesce(b.buildings,0) known_buildings,
 coalesce(d.documents,0) public_record_count,coalesce(d.recent30,0) recent30,coalesce(d.recent90,0) recent90,d.last_activity,
 coalesce(d.categories_by_record,'{}') categories_by_record,
 territorial_activity(coalesce(d.recent30,0),coalesce(d.recent90,0),coalesce(d.recent_categories,0),coalesce(d.practices,0),coalesce(d.works,0)) activity
from street_registry_streets s left join documents d on d.street_id=s.id left join portfolio p on p.street_id=s.id left join building_counts b on b.street_id=s.id;

create view public.market_observer_building_duplicate_candidates with(security_invoker=true) as
with declared as materialized (
 select distinct l.building_id,c->>'sheet' sheet,c->>'parcel' parcel from building_practice_buildings l
 join building_practice_records r on r.id=l.practice_record_id
 cross join lateral jsonb_array_elements(coalesce(r.sanitized_payload->'cadastralReferences','[]')) c
 where l.is_current and nullif(c->>'sheet','') is not null and nullif(c->>'parcel','') is not null
), parcel_pairs as materialized (
 select distinct a.building_id,b.building_id candidate_id from declared a join declared b on a.sheet=b.sheet and a.parcel=b.parcel and a.building_id<b.building_id
)
select b.id building_id,other.id candidate_id,l.territorial_street_id street_id,l.territorial_civic civic,
 case when l.latitude is not null and ol.latitude is not null and (abs(l.latitude-ol.latitude)>.002 or abs(l.longitude-ol.longitude)>.002)
  and l.precision_level in('EXACT_ADDRESS','EXACT_COORDINATES') and ol.precision_level in('EXACT_ADDRESS','EXACT_COORDINATES') then 'DIFFERENT'
 when l.latitude is not null and ol.latitude is not null and abs(l.latitude-ol.latitude)<.00005 and abs(l.longitude-ol.longitude)<.00005
  and l.precision_level in('EXACT_ADDRESS','EXACT_COORDINATES') and ol.precision_level in('EXACT_ADDRESS','EXACT_COORDINATES') then 'AUTO_SAME_BUILDING'
 else 'PROBABLE_SAME_BUILDING' end classification,
 jsonb_build_array('same_unique_official_street','same_exact_civic','merge_not_executed','unit_not_asserted') reasons
from buildings b join locations l on l.id=b.location_id join locations ol on ol.territorial_street_id=l.territorial_street_id and ol.territorial_civic=l.territorial_civic
join buildings other on other.location_id=ol.id and other.id>b.id where l.territorial_civic is not null
union
select distinct b1.id,b2.id,l1.territorial_street_id,l1.territorial_civic,'REVIEW_REQUIRED',
 jsonb_build_array('shared_declared_parcel_or_near_coordinates','not_official_building_identity','merge_not_executed')
from buildings b1 join locations l1 on l1.id=b1.location_id cross join buildings b2 join locations l2 on l2.id=b2.location_id
where b1.id<b2.id and not coalesce(l1.territorial_street_id is not null and l1.territorial_street_id=l2.territorial_street_id and l1.territorial_civic is not null and l1.territorial_civic=l2.territorial_civic,false)
 and ((l1.latitude is not null and l2.latitude is not null and abs(l1.latitude-l2.latitude)<.0001 and abs(l1.longitude-l2.longitude)<.0001)
 or exists(select 1 from parcel_pairs pp where pp.building_id=b1.id and pp.candidate_id=b2.id));

grant select on public.market_observer_graph_record_streets,public.market_observer_graph_building_properties,public.market_observer_graph_record_facts,
 public.market_observer_graph_building_context,public.market_observer_graph_street_context,public.market_observer_building_duplicate_candidates to authenticated,service_role;
revoke all on function public.territorial_activity(integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.territorial_activity(integer,integer,integer,integer,integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
