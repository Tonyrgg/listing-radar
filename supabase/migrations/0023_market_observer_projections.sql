-- Dates, classified provenance and source-specific prices in the existing Intelligence views.
begin;
-- Deterministic representative source: active source first, agency inventory host next,
-- then observation recency and stable identity. Disagreement lowers confidence, never becomes a price drop.
create view public.market_observer_agency_price_metrics with (security_invoker=true) as
select al.id agency_listing_id,chosen.*,
  case when conflict.prices>1 then 0.65::numeric else 1::numeric end price_confidence,
  conflict.prices>1 source_price_conflict,
  coalesce(earlier.amount,chosen.first_asking_price) earliest_known_asking,
  coalesce(earlier.at,chosen.first_price_observed_at) earliest_known_asking_at
from public.agency_listings al join public.agencies a on a.id=al.agency_id
left join lateral(select m.publication_id,m.first_asking_price,m.latest_asking_price,m.reduction_percent,m.drop_count,
  m.canonical_url,m.first_price_observed_at,m.latest_price_observed_at,m.reduction_amount,m.drop_dates,m.drop_intervals_days
  from public.market_observer_publication_metrics m where m.agency_listing_id=al.id and m.latest_asking_price is not null
  order by (m.state in ('ACTIVE','MISSING_PENDING')) desc,
    (lower(regexp_replace(substring(m.canonical_url from '^https?://([^/]+)'),'^www\.',''))=
     lower(regexp_replace(substring(a.inventory_url from '^https?://([^/]+)'),'^www\.',''))) desc,
    m.last_seen_at desc,m.publication_id limit 1) chosen on true
left join lateral(select count(distinct m.latest_asking_price) prices from public.market_observer_publication_metrics m
  where m.agency_listing_id=al.id and m.state in ('ACTIVE','MISSING_PENDING')) conflict on true
left join lateral(select (e.normalized_value->>'amount')::integer amount,e.source_recorded_at at from public.evidence e
  where e.publication_id=chosen.publication_id and e.claim_key='publication.askingPrice' and e.confidence>=0.85
    and e.normalized_value->>'amount' ~ '^[0-9]+$' and e.source_recorded_at<=e.observed_at
    and e.source_recorded_at<chosen.first_price_observed_at order by e.source_recorded_at,e.id limit 1) earlier on true;
grant select on public.market_observer_agency_price_metrics to authenticated,service_role;

create or replace view public.market_observer_agency_listing_intelligence with (security_invoker=true) as
select al.id agency_listing_id,al.property_id,al.agency_id,a.name agency_name,al.state,
  al.first_seen_at,al.last_seen_at,al.estimated_acquisition_at,al.acquisition_confidence,
  coalesce(pr.canonical_attributes->>'address',pr.id::text) address,
  pr.canonical_attributes->>'locality' locality,pr.sale_status,pr.property_state,
  least(pr.first_seen_at,dates.published_at) earliest_market_evidence_at,
  case when pr.sale_status='SOLD_CONFIRMED' and al.state not in ('CLOSED_SWITCHED','CLOSED_WITHDRAWN','CLOSED_TO_PRIVATE') then sale_date.sold_at end sold_at,
  al.exit_confirmed_at delisted_at,
  coalesce(al.market_exit_classification,case when pr.sale_status='SOLD_CONFIRMED' and al.state not in ('CLOSED_SWITCHED','CLOSED_WITHDRAWN','CLOSED_TO_PRIVATE') then 'SOLD_CONFIRMED'
    when pr.sale_status='PROBABLE_SOLD' and exists(select 1 from public.publications where agency_listing_id=al.id and state='SOLD_MARKED') then 'SOLD_PROBABLE'
    when exists(select 1 from public.publications where agency_listing_id=al.id and state='ACTIVE' and source_status='NEGOTIATION') then 'UNDER_OFFER'
    when al.state='CLOSED_WITHDRAWN' then 'WITHDRAWN' when al.state='CLOSED_SWITCHED' then 'AGENCY_CHANGED'
    when al.state='CLOSED_TO_PRIVATE' then 'RELISTED' when al.state='OFF_MARKET_NO_SALE_EVIDENCE' then 'UNKNOWN_EXIT'
    when al.state='EXIT_PENDING' then 'MISSING_UNCONFIRMED' else 'ACTIVE' end) exit_classification,
  coalesce(al.market_exit_confidence,case when pr.sale_status='SOLD_CONFIRMED' then 0.98 when pr.sale_status='PROBABLE_SOLD' then 0.65
    else al.outcome_confidence end) exit_confidence,
  prices.first_asking_price,prices.latest_asking_price,prices.reduction_percent,prices.drop_count,
  prices.canonical_url price_source_url,op.score opportunity_score,op.reasons,op.evidence_summary,
  dates.sold_observed_at,al.market_exit_classified_at classified_at,al.market_exit_classifier_version classifier_version,
  al.market_exit_evidence_ids exit_evidence_ids,al.market_exit_reasons exit_reasons,al.market_exit_provenance exit_provenance,
  pr.primary_location_id,prices.price_confidence,prices.source_price_conflict,
  prices.first_price_observed_at,prices.latest_price_observed_at,prices.reduction_amount,prices.drop_dates,prices.drop_intervals_days,
  greatest(0,floor(extract(epoch from (coalesce(sale_date.sold_at,dates.sold_observed_at,now())-pr.first_seen_at))/86400))::integer observed_dom,
  greatest(0,floor(extract(epoch from (coalesce(sale_date.sold_at,dates.sold_observed_at,now())-least(pr.first_seen_at,dates.published_at)))/86400))::integer known_market_age,
  prices.earliest_known_asking,prices.earliest_known_asking_at,pr.canonical_attributes->>'zone' zone_name
from public.agency_listings al join public.properties pr on pr.id=al.property_id join public.agencies a on a.id=al.agency_id
left join lateral (select min(portal_published_at) published_at,
  least(
    (select min(e.occurred_at) from public.events e where e.agency_listing_id=al.id and e.event_type='SOURCE_MARKED_SOLD'),
    (select min(e.observed_at) from public.evidence e join public.publications pub on pub.id=e.publication_id
      where pub.agency_listing_id=al.id and e.claim_key='publication.soldGraphic'),
    (select min(mo.effective_at) from public.manual_overrides mo where mo.target_type='PROPERTY' and mo.target_id=pr.id
      and mo.override_key='sale_status' and mo.override_value='"SOLD_CONFIRMED"'::jsonb)
  ) sold_observed_at
  from public.publications p join public.agency_listings other on other.id=p.agency_listing_id where other.property_id=pr.id) dates on true
left join public.market_observer_agency_price_metrics prices on prices.agency_listing_id=al.id
left join lateral(select min(e.source_recorded_at) sold_at from public.evidence e join public.publications p on p.id=e.publication_id
  where p.agency_listing_id=al.id and e.claim_key='publication.soldAt' and e.confidence>=0.85
    and e.source_recorded_at is not null and e.source_recorded_at<=e.observed_at
    and (p.state='SOLD_MARKED' or p.source_status='SOLD')) sale_date on true
left join public.opportunities op on op.property_id=pr.id and op.opportunity_type='ACQUISITION';
create or replace view public.market_observer_intelligence with (security_invoker=true) as
select agency.agency_listing_id,agency.property_id,agency.agency_id,agency.agency_name,agency.state,agency.first_seen_at,agency.last_seen_at,agency.estimated_acquisition_at,agency.acquisition_confidence,agency.address,agency.locality,agency.sale_status,agency.property_state,agency.earliest_market_evidence_at,agency.sold_at,agency.delisted_at,agency.exit_classification,agency.exit_confidence,agency.first_asking_price,agency.latest_asking_price,agency.reduction_percent,agency.drop_count,agency.price_source_url,agency.opportunity_score,agency.reasons,agency.evidence_summary,agency.agency_listing_id::text row_id,agency.sold_observed_at,agency.classified_at,agency.classifier_version,agency.exit_evidence_ids,agency.exit_reasons,agency.exit_provenance,agency.primary_location_id,agency.price_confidence,agency.source_price_conflict,agency.first_price_observed_at,agency.latest_price_observed_at,agency.reduction_amount,agency.drop_dates,agency.drop_intervals_days,agency.observed_dom,agency.known_market_age,agency.earliest_known_asking,agency.earliest_known_asking_at,agency.zone_name from public.market_observer_agency_listing_intelligence agency
union all
select private_row.agency_listing_id,private_row.property_id,private_row.agency_id,private_row.agency_name,private_row.state,private_row.first_seen_at,private_row.last_seen_at,private_row.estimated_acquisition_at,private_row.acquisition_confidence,private_row.address,private_row.locality,private_row.sale_status,private_row.property_state,private_row.earliest_market_evidence_at,private_row.sold_at,private_row.delisted_at,private_row.exit_classification,private_row.exit_confidence,private_row.first_asking_price,private_row.latest_asking_price,private_row.reduction_percent,private_row.drop_count,private_row.price_source_url,private_row.opportunity_score,private_row.reasons,private_row.evidence_summary,pr.id::text row_id,private_row.sold_observed_at,private_row.classified_at,private_row.classifier_version,private_row.exit_evidence_ids,private_row.exit_reasons,private_row.exit_provenance,private_row.primary_location_id,private_row.price_confidence,private_row.source_price_conflict,private_row.first_price_observed_at,private_row.latest_price_observed_at,private_row.reduction_amount,private_row.drop_dates,private_row.drop_intervals_days,private_row.observed_dom,private_row.known_market_age,private_row.earliest_known_asking,private_row.earliest_known_asking_at,private_row.zone_name
from public.properties pr
join lateral (select * from public.private_publications where property_id=pr.id
  order by (state='ACTIVE') desc,last_seen_at desc,id limit 1) pp on true
left join public.opportunities op on op.property_id=pr.id and op.opportunity_type='ACQUISITION'
left join lateral (select count(*)::integer drop_count,min(occurred_at) first_drop_at
  from public.events where property_id=pr.id and event_type='PRIVATE_PRICE_DROP'
    and payload->>'privatePublicationId'=pp.id::text) drops on true
left join lateral (select coalesce((select (payload->>'oldPrice')::integer from public.events
  where property_id=pr.id and event_type='PRIVATE_PRICE_DROP' and payload->>'privatePublicationId'=pp.id::text
  order by occurred_at,id limit 1),pp.price_amount) price) first_price on true
cross join lateral jsonb_populate_record(null::public.market_observer_agency_listing_intelligence,jsonb_build_object(
  'property_id',pr.id,'agency_listing_id',null,'agency_id',null,'agency_name','Pubblicazione privata',
  'state',case when pp.state='ACTIVE' then 'ACTIVE' else 'OFF_MARKET_NO_SALE_EVIDENCE' end,
  'first_seen_at',pp.first_seen_at,'last_seen_at',pp.last_seen_at,'estimated_acquisition_at',null,'acquisition_confidence',null,
  'address',coalesce(pr.canonical_attributes->>'address',pp.title),'locality',pr.canonical_attributes->>'locality',
  'sale_status',pr.sale_status,'property_state',pr.property_state,
  'earliest_market_evidence_at',least(pr.first_seen_at,pp.first_public_evidence_at),'sold_at',null,'delisted_at',pp.removed_at,
  'exit_classification',case when pr.sale_status='SOLD_CONFIRMED' then 'SOLD_CONFIRMED'
    when pr.sale_status='PROBABLE_SOLD' then 'SOLD_PROBABLE'
    when exists(select 1 from public.private_publications where property_id=pr.id and state='ACTIVE') then 'ACTIVE'
    else 'UNKNOWN_EXIT' end,
  'exit_confidence',case when pp.state='REMOVED' then 0.85 else null end,
  'first_asking_price',first_price.price,'latest_asking_price',pp.price_amount,
  'reduction_percent',case when first_price.price>0 then round(100.0*(first_price.price-pp.price_amount)/first_price.price,2) else null end,
  'drop_count',drops.drop_count,'price_source_url',pp.canonical_url,'opportunity_score',op.score,
  'reasons',op.reasons,'evidence_summary',op.evidence_summary,'primary_location_id',pr.primary_location_id,
  'price_confidence',1,'source_price_conflict',false,
  'observed_dom',greatest(0,floor(extract(epoch from(now()-pr.first_seen_at))/86400)),
  'known_market_age',greatest(0,floor(extract(epoch from(now()-least(pr.first_seen_at,pp.first_public_evidence_at)))/86400)),
  'earliest_known_asking',first_price.price,'earliest_known_asking_at',pp.first_seen_at,'zone_name',pr.canonical_attributes->>'zone'
)) private_row
where pr.identity_status<>'MERGED' and not exists(select 1 from public.agency_listings where property_id=pr.id);
comment on view public.market_observer_agency_listing_intelligence is
  'sold_at requires an explicit source sale date. sold_observed_at is observation time. Age is never mandate age.';
commit;
