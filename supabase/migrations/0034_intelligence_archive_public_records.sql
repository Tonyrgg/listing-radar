-- Same Property Lifecycle archive and municipal register, new consultative projections.
begin;

alter table public.building_practice_records
  add column title text,
  add column record_type text,
  add column document_url text,
  add column published_at timestamptz,
  add column document_date date,
  add column area_name text,
  add column metadata jsonb not null default '{}'::jsonb;
comment on column public.building_practice_records.occurred_at is
  'Existing practice date, potentially release/protocol/opening; not automatically publication or document date.';
comment on column public.building_practice_records.area_name is
  'Area-level context only; no automatic assertion of constraints or property-unit relevance.';

create view public.market_observer_public_records with (security_invoker=true) as
select r.id,r.source_key,r.source_record_key,
  coalesce(r.title,r.practice_type||coalesce(' · '||r.practice_number,''),'Pratica pubblica') title,
  coalesce(r.record_type,case
    when r.practice_type ~* 'SCIA' then 'SCIA'
    when r.practice_type ~* 'CILA' then 'CILA'
    when r.practice_type ~* 'sanatoria' then 'SANATORIA'
    when r.practice_type ~* 'condono' then 'CONDONO'
    when r.practice_type ~* 'agibilit' then 'AGIBILITA'
    when r.practice_type ~* 'permesso.*costruire' then 'PERMESSO_COSTRUIRE'
    else 'OTHER' end) record_type,
  r.practice_number,r.protocol_number,r.practice_year,r.practice_type,r.practice_status,r.intervention_type,
  r.occurred_at practice_date,r.published_at,r.document_date,r.source_url,r.document_url,
  r.first_seen_at,r.last_seen_at,r.content_hash,r.area_name,r.metadata,
  coalesce(r.sanitized_payload->'addresses','[]'::jsonb) addresses,
  coalesce(r.sanitized_payload->'cadastralReferences','[]'::jsonb) cadastral_references,
  coalesce((select string_agg(a->>'displayName','; ')
    from jsonb_array_elements(coalesce(r.sanitized_payload->'addresses','[]'::jsonb)) a),'') address_text,
  coalesce((select jsonb_agg(l.building_id) from public.building_practice_buildings l
    where l.practice_record_id=r.id),'[]'::jsonb) building_ids
from public.building_practice_records r;
grant select on public.market_observer_public_records to authenticated,service_role;

-- One property, one row, including properties without a current commercial relationship.
-- Relationship selection uses the same ACTIVE/OUR_AGENCY/last-seen ordering as Phase 2.
create view public.market_observer_property_archive with (security_invoker=true) as
select p.id property_id,p.id::text row_id,p.building_id,p.primary_location_id,
  coalesce(p.canonical_attributes->>'address',l.raw_text,i.address,p.id::text) address,
  coalesce(p.canonical_attributes->>'locality',l.locality,l.municipality) locality,
  coalesce(p.canonical_attributes->>'zone',i.zone_name) zone_name,
  p.property_type,p.canonical_attributes attributes,
  case when jsonb_typeof(p.canonical_attributes->'surfaceSqm')='number'
    then (p.canonical_attributes->>'surfaceSqm')::numeric end surface_sqm,
  case when jsonb_typeof(p.canonical_attributes->'rooms')='number'
    then (p.canonical_attributes->>'rooms')::numeric end rooms,
  l.street_name,l.street_number,l.latitude,l.longitude,l.precision_level location_precision,
  p.property_state,p.sale_status,p.identity_status,p.relaunch_count,
  p.first_seen_at,p.last_seen_at,p.updated_at,
  coalesce(i.earliest_market_evidence_at,p.first_seen_at) earliest_market_evidence_at,
  i.agency_listing_id,i.agency_id,coalesce(i.agency_name,'Agenzia non identificata') agency_name,
  coalesce(i.agency_role,'UNKNOWN') agency_role,i.agent_name,
  coalesce(i.state,'UNKNOWN') state,coalesce(i.exit_classification,'UNKNOWN') exit_classification,
  i.exit_confidence,i.sold_at,i.sold_observed_at,i.delisted_at,i.classified_at,
  i.estimated_acquisition_at,i.acquisition_confidence,
  i.first_asking_price,i.latest_asking_price,i.earliest_known_asking,i.earliest_known_asking_at,
  i.reduction_percent,coalesce(i.drop_count,0) drop_count,i.price_source_url,i.price_confidence,
  i.source_price_conflict,i.opportunity_score,coalesce(i.reasons,'[]'::jsonb) reasons,
  coalesce(i.evidence_summary,'{}'::jsonb) evidence_summary,
  i.market_evidence_provenance,i.publication_date_disagreement,
  greatest(0,floor(extract(epoch from(coalesce(i.sold_at,i.sold_observed_at,now())-p.first_seen_at))/86400))::integer observed_dom,
  i.known_market_age,
  (select count(*)::integer from public.publications u join public.agency_listings al on al.id=u.agency_listing_id where al.property_id=p.id)
    +(select count(*)::integer from public.private_publications pp where pp.property_id=p.id) publication_count,
  coalesce((select array_agg(distinct coalesce(u.external_source_key,a.adapter_key)) from public.publications u
    join public.agency_listings al on al.id=u.agency_listing_id join public.agencies a on a.id=al.agency_id
    where al.property_id=p.id),'{}'::text[])
    ||coalesce((select array_agg(distinct source::text) from public.private_publications pp where pp.property_id=p.id),'{}'::text[]) publication_sources,
  (select count(*)::integer from public.evidence e where e.property_id=p.id) evidence_count,
  (select count(*)::integer from public.building_practice_buildings b where b.building_id=p.building_id) document_count
from public.properties p
left join public.locations l on l.id=p.primary_location_id
left join lateral (select mi.* from public.market_observer_intelligence mi where mi.property_id=p.id
  order by (mi.state='ACTIVE') desc,(mi.state='ACTIVE' and mi.agency_role='OUR_AGENCY') desc,
    mi.last_seen_at desc,mi.row_id limit 1) i on true
where p.identity_status<>'MERGED';
grant select on public.market_observer_property_archive to authenticated,service_role;

-- An unexplained exit alone no longer generates an 85/100 opportunity.
-- This is a reproducible prioritisation rule, not human validation of lead quality.
update public.market_observer_config set weights=weights||'{
  "age":30,"dropEach":5,"dropCap":10,"relistCap":15,"reductionCap":10,
  "unknownExit":25,"agencyChange":10,"pendingExit":10,"toPrivate":25,
  "scorePolicyVersion":"market_observer_calibrated_v2"
}'::jsonb,updated_at=now() where singleton;

alter function public.refresh_property_lifecycle_intelligence_atomic(uuid,timestamptz)
  rename to refresh_market_observer_external_v1_atomic;
create function public.refresh_property_lifecycle_intelligence_atomic(p_property_id uuid,p_as_of timestamptz default now())
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.refresh_market_observer_external_v1_atomic(p_property_id,p_as_of);
  update public.opportunities set evidence_summary=evidence_summary||jsonb_build_object(
    'scoreVersion','market_observer_calibrated_v2','ruleVersion',3,
    'calibrationReason','Exit alone is insufficient; absence is not proof of mandate expiry',
    'validationStatus','NOT_HUMAN_CALIBRATED')
  where property_id=p_property_id and opportunity_type='ACQUISITION';
end $$;
revoke all on function public.refresh_market_observer_external_v1_atomic(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.refresh_market_observer_external_v1_atomic(uuid,timestamptz) to service_role;
revoke all on function public.refresh_property_lifecycle_intelligence_atomic(uuid,timestamptz) from public,anon;
grant execute on function public.refresh_property_lifecycle_intelligence_atomic(uuid,timestamptz) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
