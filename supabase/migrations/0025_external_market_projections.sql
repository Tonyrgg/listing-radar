-- Interpret accepted external evidence centrally; extend existing projections, never a second archive.
begin;
alter function public.refresh_property_lifecycle_intelligence_atomic(uuid,timestamptz) rename to refresh_market_observer_phase1_atomic;
create function public.refresh_property_lifecycle_intelligence_atomic(p_property_id uuid,p_as_of timestamptz default now())
returns void language plpgsql security definer set search_path=public as $$
declare pr record; relevant record; anchor timestamptz; age integer; drops integer; reduction numeric; assessment jsonb;
begin
  perform public.refresh_market_observer_phase1_atomic(p_property_id,p_as_of);
  select * into strict pr from public.properties where id=p_property_id for update;
  -- Current commercial relationship first. A historical competitor cannot make our current portfolio a competitor lead.
  select al.*,a.market_role into relevant from public.agency_listings al join public.agencies a on a.id=al.agency_id
    where al.property_id=p_property_id order by (al.state='ACTIVE') desc,
      (al.state='ACTIVE' and a.market_role='OUR_AGENCY') desc,al.last_seen_at desc,al.id limit 1;
  if not found then return; end if;
  if relevant.market_role='OUR_AGENCY' then
    update public.opportunities set score=0,level='NONE',status=case when status in ('QUALIFIED','ACTIONED') then status else 'EXPIRED' end,
      reasons='["our_agency_excluded"]',evidence_summary=evidence_summary||jsonb_build_object('sourceAgencyId',relevant.agency_id,'agencyRole','OUR_AGENCY','scoreVersion','external_market_evidence_v1')
      where property_id=p_property_id and opportunity_type='ACQUISITION';
    return;
  end if;
  anchor:=public.market_observer_earliest_evidence(p_property_id);
  age:=greatest(0,floor(extract(epoch from(p_as_of-anchor))/86400)::integer);
  select greatest(coalesce(max(m.drop_count),0),coalesce(max(h.reductions),0)),
    greatest(coalesce(max(m.reduction_percent),0),coalesce(max(h.reduction_percent),0)) into drops,reduction
    from public.market_observer_publication_metrics m
    join public.agency_listings al on al.id=m.agency_listing_id
    left join lateral(select case when count(*)>0 then 1 else 0 end reductions,
      max(100.0*(amount-current_amount)/nullif(amount,0)) reduction_percent
      from public.market_observer_external_price_evidence e where e.publication_id=m.publication_id
        and e.claim_key='publication.previousAskingPrice' and e.amount>e.current_amount and e.confidence>=0.85) h on true
    where al.property_id=p_property_id and (relevant.state<>'ACTIVE' or al.id=relevant.id);
  assessment:=public.market_observer_assess_opportunity(pr.sale_status,relevant.state,age,drops,pr.relaunch_count,reduction);
  update public.opportunities set score=(assessment->>'score')::numeric,level=assessment->>'level',
    status=case when status in ('QUALIFIED','ACTIONED') then status when assessment->>'level'='NONE' then
      case when pr.sale_status='SOLD_CONFIRMED' then 'DISMISSED' else 'EXPIRED' end else 'OPEN' end,
    reasons=assessment->'reasons',evidence_summary=evidence_summary||jsonb_build_object('marketAnchor',anchor,
      'ageDays',age,'components',assessment->'components','sourceAgencyId',relevant.agency_id,
      'agencyRole',relevant.market_role,'priceDropCount',drops,'reductionPercent',reduction,
      'scoreVersion','external_market_evidence_v1','policyVersion','external_market_evidence_v1','asOf',p_as_of)
    where property_id=p_property_id and opportunity_type='ACQUISITION';
end $$;
revoke all on function public.refresh_market_observer_phase1_atomic(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.refresh_market_observer_phase1_atomic(uuid,timestamptz) to service_role;
create or replace view public.market_observer_agency_price_metrics with (security_invoker=true) as
select al.id agency_listing_id,chosen.*,
  case when conflict.prices>1 then 0.65::numeric else 1::numeric end price_confidence,
  conflict.prices>1 source_price_conflict,
  coalesce(earlier.amount,chosen.first_asking_price) earliest_known_asking,
  case when earlier.amount is not null then earlier.at else chosen.first_price_observed_at end earliest_known_asking_at
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
left join lateral(
 select amount,at from (
   select (e.normalized_value->>'amount')::integer amount,e.source_recorded_at at,0 priority,e.observed_at seen
   from public.evidence e where e.publication_id=chosen.publication_id and e.claim_key='publication.askingPrice'
     and e.confidence>=0.85 and e.normalized_value->>'amount' ~ '^[0-9]+$'
     and e.source_recorded_at<=e.observed_at and e.source_recorded_at<chosen.first_price_observed_at
   union all
   select e.amount,null::timestamptz,1,e.observed_at from public.market_observer_external_price_evidence e
   where e.publication_id=chosen.publication_id and e.claim_key='publication.previousAskingPrice' and e.confidence>=0.85
     and e.amount>e.current_amount and e.current_amount=chosen.first_asking_price
     and e.observed_at<=chosen.first_price_observed_at
 ) known order by priority,at nulls last,seen limit 1
) earlier on true;

create or replace view public.market_observer_agency_listing_intelligence with (security_invoker=true) as
select al.id agency_listing_id,al.property_id,al.agency_id,a.name agency_name,al.state,
  al.first_seen_at,al.last_seen_at,al.estimated_acquisition_at,al.acquisition_confidence,
  coalesce(pr.canonical_attributes->>'address',pr.id::text) address,
  pr.canonical_attributes->>'locality' locality,pr.sale_status,pr.property_state,
  public.market_observer_earliest_evidence(pr.id) earliest_market_evidence_at,
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
  case when coalesce(sale_date.sold_at,dates.sold_observed_at,now())>=pr.first_seen_at then floor(extract(epoch from (coalesce(sale_date.sold_at,dates.sold_observed_at,now())-pr.first_seen_at))/86400)::integer else null end observed_dom,
  case when coalesce(sale_date.sold_at,dates.sold_observed_at,now())>=public.market_observer_earliest_evidence(pr.id) then floor(extract(epoch from (coalesce(sale_date.sold_at,dates.sold_observed_at,now())-public.market_observer_earliest_evidence(pr.id)))/86400)::integer else null end known_market_age,
  prices.earliest_known_asking,prices.earliest_known_asking_at,pr.canonical_attributes->>'zone' zone_name,
  a.market_role agency_role,
  coalesce((select jsonb_build_object('evidenceId',e.id,'source',e.metadata->>'source','url',e.source_url,
    'observedAt',e.observed_at,'claimedAt',e.source_recorded_at,'confidence',e.confidence,'policyVersion',e.metadata->>'policyVersion')
    from public.evidence e where e.property_id=pr.id
      and e.claim_key in ('publication.datePublished','publication.historicalMarketEvidence')
      and e.source_recorded_at=public.market_observer_earliest_evidence(pr.id) and e.confidence>=0.6
      and (e.metadata->>'source' is null or exists(select 1 from public.market_observer_sources s where s.source_key=e.metadata->>'source' and s.projections_enabled))
    order by e.confidence desc,e.observed_at,e.id limit 1),
    jsonb_build_object('source','OUR_OBSERVATION','observedAt',pr.first_seen_at)) market_evidence_provenance,
  (select e.normalized_value->>'name' from public.evidence e join public.publications pub on pub.id=e.publication_id
    join public.market_observer_sources s on s.source_key=e.metadata->>'source'
    where pub.agency_listing_id=al.id and e.claim_key='publication.agentIdentity' and s.projections_enabled
    order by e.observed_at desc,e.confidence desc,e.id limit 1) agent_name,
  (select count(*)::integer from public.market_observer_external_price_evidence e where e.property_id=pr.id) external_price_evidence_count,
  exists(select 1 from public.market_observer_cross_source_dates d where d.property_id=pr.id and d.distinct_dates>1) publication_date_disagreement
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
select agency.agency_listing_id,agency.property_id,agency.agency_id,agency.agency_name,agency.state,agency.first_seen_at,agency.last_seen_at,agency.estimated_acquisition_at,agency.acquisition_confidence,agency.address,agency.locality,agency.sale_status,agency.property_state,agency.earliest_market_evidence_at,agency.sold_at,agency.delisted_at,agency.exit_classification,agency.exit_confidence,agency.first_asking_price,agency.latest_asking_price,agency.reduction_percent,agency.drop_count,agency.price_source_url,agency.opportunity_score,agency.reasons,agency.evidence_summary,agency.agency_listing_id::text row_id,agency.sold_observed_at,agency.classified_at,agency.classifier_version,agency.exit_evidence_ids,agency.exit_reasons,agency.exit_provenance,agency.primary_location_id,agency.price_confidence,agency.source_price_conflict,agency.first_price_observed_at,agency.latest_price_observed_at,agency.reduction_amount,agency.drop_dates,agency.drop_intervals_days,agency.observed_dom,agency.known_market_age,agency.earliest_known_asking,agency.earliest_known_asking_at,agency.zone_name,agency.agency_role,agency.market_evidence_provenance,agency.agent_name,agency.external_price_evidence_count,agency.publication_date_disagreement from public.market_observer_agency_listing_intelligence agency
union all
select private_row.agency_listing_id,private_row.property_id,private_row.agency_id,private_row.agency_name,private_row.state,private_row.first_seen_at,private_row.last_seen_at,private_row.estimated_acquisition_at,private_row.acquisition_confidence,private_row.address,private_row.locality,private_row.sale_status,private_row.property_state,private_row.earliest_market_evidence_at,private_row.sold_at,private_row.delisted_at,private_row.exit_classification,private_row.exit_confidence,private_row.first_asking_price,private_row.latest_asking_price,private_row.reduction_percent,private_row.drop_count,private_row.price_source_url,private_row.opportunity_score,private_row.reasons,private_row.evidence_summary,pr.id::text row_id,private_row.sold_observed_at,private_row.classified_at,private_row.classifier_version,private_row.exit_evidence_ids,private_row.exit_reasons,private_row.exit_provenance,private_row.primary_location_id,private_row.price_confidence,private_row.source_price_conflict,private_row.first_price_observed_at,private_row.latest_price_observed_at,private_row.reduction_amount,private_row.drop_dates,private_row.drop_intervals_days,private_row.observed_dom,private_row.known_market_age,private_row.earliest_known_asking,private_row.earliest_known_asking_at,private_row.zone_name,private_row.agency_role,private_row.market_evidence_provenance,private_row.agent_name,private_row.external_price_evidence_count,private_row.publication_date_disagreement
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
  'property_id',pr.id,'agency_listing_id',null,'agency_id',null,'agency_name','Pubblicazione privata','agency_role','PRIVATE',
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
create view public.market_observer_agency_intelligence with(security_invoker=true) as
select a.id agency_id,a.name,a.market_role,count(i.agency_listing_id) monitored_count,
  count(i.agency_listing_id) filter(where i.state='ACTIVE') active_listings,
  percentile_cont(0.5) within group(order by i.known_market_age) filter(where i.state='ACTIVE') median_known_age,
  count(i.agency_listing_id) filter(where i.exit_classification in ('SOLD_CONFIRMED','SOLD_PROBABLE')) sold_observed,
  avg(i.observed_dom) filter(where i.exit_classification='SOLD_CONFIRMED') average_observed_dom,
  percentile_cont(0.5) within group(order by i.observed_dom) filter(where i.exit_classification='SOLD_CONFIRMED') median_observed_dom,
  avg(i.reduction_percent) average_price_reduction,
  count(i.agency_listing_id) filter(where i.state='ACTIVE' and i.known_market_age>=180) stale_listing_count,
  count(i.agency_listing_id) filter(where i.exit_classification='RELISTED') relisting_count,
  count(i.agency_listing_id) filter(where i.exit_classification='UNKNOWN_EXIT') unknown_exit_count,
  count(i.agency_listing_id) filter(where i.exit_classification='AGENCY_CHANGED') agency_switch_count
from public.agencies a left join public.market_observer_agency_listing_intelligence i on i.agency_id=a.id
group by a.id,a.name,a.market_role;
comment on view public.market_observer_agency_intelligence is 'Observed portfolios only, not agency conversion rates or actual sale prices.';
grant select on public.market_observer_agency_intelligence to authenticated,service_role;
-- The property card and archive lists use the same earliest-evidence calculation as Intelligence.
alter function public.lifecycle_property_hydration(uuid[]) rename to lifecycle_property_hydration_phase1;
create function public.lifecycle_property_hydration(p_ids uuid[])
returns table(property_id uuid,agency_refs jsonb,latest_snapshot jsonb,latest_private jsonb,active_private_count integer)
language sql stable set search_path=public as $$
  select h.property_id,h.agency_refs,
    case when h.latest_snapshot is null then null else h.latest_snapshot||jsonb_build_object(
      'earliest_market_evidence_at',public.market_observer_earliest_evidence(h.property_id)) end,
    case when h.latest_private is null then null else h.latest_private||jsonb_build_object(
      'earliest_market_evidence_at',public.market_observer_earliest_evidence(h.property_id)) end,
    h.active_private_count from public.lifecycle_property_hydration_phase1(p_ids) h;
$$;
grant execute on function public.lifecycle_property_hydration(uuid[]) to authenticated,service_role;
revoke all on function public.lifecycle_property_hydration(uuid[]) from public,anon;
revoke all on function public.refresh_property_lifecycle_intelligence_atomic(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.refresh_property_lifecycle_intelligence_atomic(uuid,timestamptz) to service_role;
create or replace function public.apply_missing_observations_atomic(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_observed_source_keys text[],
  p_observed_at timestamptz,
  p_missing_threshold integer default 2,
  p_post_exit_delay_hours integer default 48,
  p_failure_point text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publication record;
  v_agency_listing record;
  v_next_count integer;
  v_next_state text;
  v_other_active integer;
  v_missing_count integer := 0;
  v_transitioned_count integer := 0;
  v_event_id uuid;
  v_due_at timestamptz;
  v_presence_evidence uuid;
begin
  p_missing_threshold:=greatest(p_missing_threshold,public.market_observer_setting(p_agency_id,'missingHealthyRunThreshold'));
  p_post_exit_delay_hours:=public.market_observer_setting(p_agency_id,'postExitDelayHours');
  -- Only a finished, persisted, healthy inventory can commit absence. The actual keys are saved on the run.
  if not exists(select 1 from public.sync_runs sr where sr.id=p_sync_run_id and sr.agency_id=p_agency_id
    and sr.status='SUCCEEDED' and sr.finished_at is not null and sr.finished_at<=p_observed_at
    and sr.health_state='HEALTHY' and sr.inventory_complete and sr.absence_evaluation_allowed
    and sr.inventory_observed_keys is not null
    and sr.inventory_observed_keys @> coalesce(p_observed_source_keys,'{}'::text[])
    and coalesce(p_observed_source_keys,'{}'::text[]) @> sr.inventory_observed_keys
    and exists(select 1 from public.adapter_health h where h.sync_run_id=sr.id and h.agency_id=sr.agency_id
      and h.state='HEALTHY' and h.diagnostics->>'sourceComplete'='true' and h.diagnostics->>'baselineReady'='true')) then
    return jsonb_build_object('missingCount',0,'transitionedCount',0,'skipped','unfinished_or_unhealthy_inventory');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('missing:' || p_agency_id::text, 0));

  -- A verified catalog link is positive presence even when its detail failed.
  -- It resets absence, without pretending that price or other detail fields were read.
  for v_publication in
    select p.* from public.publications p where p.agency_id=p_agency_id and p.external_source_key is null
      and p.state in ('MISSING_PENDING','REMOVED') and p.source_status<>'REMOVED'
      and p.source_key=any(coalesce(p_observed_source_keys,'{}'::text[]))
      and p.last_seen_at <= (select started_at from public.sync_runs where id=p_sync_run_id)
      and lower(regexp_replace(substring(p.canonical_url from '^https?://([^/]+)'),'^www\.','')) =
        (select lower(regexp_replace(substring(inventory_url from '^https?://([^/]+)'),'^www\.','')) from public.agencies where id=p_agency_id)
    order by p.id for update
  loop
    select * into strict v_agency_listing from public.agency_listings where id=v_publication.agency_listing_id for update;
    update public.publications set state='ACTIVE',missing_healthy_run_count=0,missing_since=null,removed_at=null,
      last_seen_at=greatest(last_seen_at,p_observed_at) where id=v_publication.id;
    insert into public.evidence(property_id,publication_id,sync_run_id,evidence_kind,source_url,extraction_method,claim_key,
      normalized_value,confidence,observed_at,evidence_hash,metadata)
      values(v_agency_listing.property_id,v_publication.id,p_sync_run_id,'PRESENCE',
        (select inventory_url from public.agencies where id=p_agency_id),'COMPLETE_HEALTHY_INVENTORY_V1','publication.inventoryPresence',
        jsonb_build_object('present',true,'sourceKey',v_publication.source_key),1,p_observed_at,
        encode(extensions.digest(v_publication.id||':inventory-presence:'||p_sync_run_id,'sha256'),'hex'),
        jsonb_build_object('externalId',v_publication.external_id,'detailFieldsRead',false)) returning id into v_presence_evidence;
    perform public.insert_property_lifecycle_event_atomic(v_agency_listing.property_id,v_agency_listing.id,v_publication.id,p_sync_run_id,
      'PUBLICATION_REAPPEARED',p_observed_at,v_publication.id||':INVENTORY_REAPPEARED:'||p_sync_run_id,1,'SYSTEM',
      jsonb_build_object('presenceOnly',true),array[v_presence_evidence]);
    if v_agency_listing.state in ('EXIT_PENDING','OFF_MARKET_NO_SALE_EVIDENCE') and not exists(select 1 from public.manual_overrides mo
      where mo.target_type='AGENCY_LISTING' and mo.target_id=v_agency_listing.id and mo.override_key='state'
        and mo.effective_at<=p_observed_at and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)) then
      update public.agency_listings set state='ACTIVE',monitoring_phase='NONE',next_check_at=null,post_exit_check_due_at=null
        where id=v_agency_listing.id;
    end if;
    perform public.refresh_property_lifecycle_intelligence_atomic(v_agency_listing.property_id,p_observed_at);
  end loop;

  for v_publication in
    select p.* from public.publications p
    where p.agency_id = p_agency_id and p.external_source_key is null
      and p.state in ('ACTIVE', 'MISSING_PENDING')
      and lower(regexp_replace(substring(p.canonical_url from '^https?://([^/]+)'),'^www\.','')) =
        (select lower(regexp_replace(substring(inventory_url from '^https?://([^/]+)'),'^www\.','')) from public.agencies where id=p_agency_id)
      -- Inventory completeness is scoped to this source, never to all portals of the agency.

      and not (p.source_key = any(coalesce(p_observed_source_keys, '{}'::text[])))
      and p.last_seen_at < (select started_at from public.sync_runs where id=p_sync_run_id)
      and not exists(select 1 from public.sync_runs newer where newer.agency_id=p_agency_id
        and newer.started_at>(select started_at from public.sync_runs where id=p_sync_run_id))
    order by p.id
    for update
  loop
    insert into public.missing_observation_commits (sync_run_id, publication_id)
    values (p_sync_run_id, v_publication.id)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    select * into strict v_agency_listing
    from public.agency_listings
    where id = v_publication.agency_listing_id
    for update;
    v_next_count := v_publication.missing_healthy_run_count + 1;
    v_next_state := case
      when v_next_count >= p_missing_threshold
        and p_observed_at >= coalesce(v_publication.missing_since,p_observed_at) + make_interval(hours =>
          public.market_observer_setting(p_agency_id,'missingGraceHours')) then 'REMOVED'
      else 'MISSING_PENDING'
    end;

    update public.publications set
      state = v_next_state,
      missing_healthy_run_count = v_next_count,
      missing_since = coalesce(missing_since, p_observed_at),
      removed_at = case when v_next_state = 'REMOVED' then p_observed_at else null end
    where id = v_publication.id;
    v_missing_count := v_missing_count + 1;

    if p_failure_point = 'AFTER_MISSING_PUBLICATION' then
      raise exception 'Injected missing observation failure AFTER_MISSING_PUBLICATION';
    end if;

    select count(*) into v_other_active
    from public.publications
    where agency_listing_id = v_agency_listing.id
      and id <> v_publication.id
      and state in ('ACTIVE', 'MISSING_PENDING');

    if v_next_state = 'REMOVED' and v_agency_listing.state = 'ACTIVE' and v_other_active = 0 then
      v_due_at := p_observed_at + make_interval(hours => p_post_exit_delay_hours);
      update public.agency_listings set
        state = 'EXIT_PENDING',
        state_reason = jsonb_build_object('publicationState', v_next_state),
        monitoring_phase = 'WAITING_CONFIRMATION',
        post_exit_check_due_at = v_due_at,
        next_check_at = v_due_at,
        check_attempt = 0,
        last_check_at = null
      where id = v_agency_listing.id;

      insert into public.lifecycle_jobs (
        job_type, agency_id, payload, run_after, dedupe_key
      ) values (
        'POST_EXIT_CHECK', p_agency_id,
        jsonb_build_object(
          'agencyListingId', v_agency_listing.id,
          'publicationId', v_publication.id
        ),
        v_due_at,
        'POST_EXIT_CHECK:' || v_agency_listing.id || ':' || v_publication.id || ':' || v_next_count
      ) on conflict do nothing;
    end if;

    v_event_id := public.insert_property_lifecycle_event_atomic(
      v_agency_listing.property_id,
      v_agency_listing.id,
      v_publication.id,
      p_sync_run_id,
      case when v_next_state = 'REMOVED' then 'PUBLICATION_REMOVED' else 'PUBLICATION_MISSING_PENDING' end,
      p_observed_at,
      v_publication.id || ':' || case when v_next_state = 'REMOVED' then 'PUBLICATION_REMOVED' else 'PUBLICATION_MISSING_PENDING' end || ':' || p_sync_run_id,
      1,
      'SYSTEM',
      jsonb_build_object('missingHealthyRunCount', v_next_count),
      '{}'::uuid[]
    );
    if v_event_id is not null then
      v_transitioned_count := v_transitioned_count + 1;
    end if;
    perform public.refresh_property_lifecycle_intelligence_atomic(
      v_agency_listing.property_id,
      p_observed_at
    );
  end loop;

  return jsonb_build_object(
    'missingCount', v_missing_count,
    'transitionedCount', v_transitioned_count
  );
end;
$$;


commit;
