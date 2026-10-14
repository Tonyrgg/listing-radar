-- Central intelligence, computed from observed publications. No mandate expiry inference.
begin;

create table public.market_observer_config (
  singleton boolean primary key default true check(singleton),
  weights jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.market_observer_config(weights) values ('{
  "ageThresholdDays":150,"age":25,"dropEach":5,"dropCap":15,
  "relistEach":5,"relistCap":15,"reductionCap":15,"reductionPerPercent":1,
  "unknownExit":85,"agencyChange":55,"pendingExit":50,"toPrivate":100
}');
alter table public.market_observer_config enable row level security;
grant select on public.market_observer_config to authenticated;
grant select,update on public.market_observer_config to service_role;
create policy "authenticated read market observer config" on public.market_observer_config for select to authenticated using(true);

-- Price history is per publication: different simultaneous asking prices are not a price change.
create view public.market_observer_publication_metrics with (security_invoker=true) as
select p.id publication_id,p.agency_listing_id,p.agency_id,p.source_key,p.external_id,p.canonical_url,
  p.state,p.source_status,p.portal_published_at,p.portal_modified_at,p.first_seen_at,p.last_seen_at,p.removed_at,
  first_price.price_amount first_asking_price,latest_price.price_amount latest_asking_price,
  first_price.observed_at first_price_observed_at,latest_price.observed_at latest_price_observed_at,
  case when first_price.price_amount>0 then
    round(100.0*(first_price.price_amount-latest_price.price_amount)/first_price.price_amount,2) end reduction_percent,
  first_price.price_amount-latest_price.price_amount reduction_amount,
  drops.drop_count,drops.drop_dates,drops.last_drop_at,drops.drop_intervals_days
from public.publications p
left join lateral (select price_amount,observed_at from public.snapshots where publication_id=p.id
  and price_amount is not null order by observed_at,id limit 1) first_price on true
left join lateral (select price_amount,observed_at from public.snapshots where publication_id=p.id
  and price_amount is not null order by observed_at desc,id desc limit 1) latest_price on true
left join lateral (select count(*)::integer drop_count,max(occurred_at) last_drop_at,
  coalesce(jsonb_agg(occurred_at order by occurred_at),'[]'::jsonb) drop_dates,
  coalesce(jsonb_agg(round(extract(epoch from (occurred_at-previous_at))/86400,2) order by occurred_at)
    filter(where previous_at is not null),'[]'::jsonb) drop_intervals_days
  from (select occurred_at,lag(occurred_at) over(order by occurred_at,id) previous_at
    from public.events where publication_id=p.id and event_type='PRICE_DROP') history) drops on true;
grant select on public.market_observer_publication_metrics to authenticated,service_role;

create function public.market_observer_assess_opportunity(
  p_sale_status text,p_agency_state text,p_age_days integer,p_drops integer,p_relaunches integer,p_reduction_percent numeric
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare w jsonb; components jsonb:='{}'; reasons jsonb:='[]'; score numeric:=0; level text; points numeric;
begin
  select weights into strict w from public.market_observer_config where singleton;
  if p_sale_status='SOLD_CONFIRMED' then
    return jsonb_build_object('score',0,'level','NONE','reasons',jsonb_build_array('sold_confirmed'),'components',components);
  end if;
  if p_agency_state='CLOSED_TO_PRIVATE' then
    components:=jsonb_build_object('agency_to_private',(w->>'toPrivate')::numeric);
    reasons:=jsonb_build_array('agency_to_private_confirmed');
  elsif p_agency_state='OFF_MARKET_NO_SALE_EVIDENCE' then
    components:=jsonb_build_object('unsold_exit',(w->>'unknownExit')::numeric);
    reasons:=jsonb_build_array('agency_exit_confirmed','no_sale_evidence','no_new_agency_evidence');
  elsif p_agency_state='CLOSED_SWITCHED' then
    components:=jsonb_build_object('agency_change',(w->>'agencyChange')::numeric);
    reasons:=jsonb_build_array('agency_switch_confirmed');
  elsif p_agency_state='EXIT_PENDING' then
    components:=jsonb_build_object('pending_exit',(w->>'pendingExit')::numeric);
    reasons:=jsonb_build_array('agency_exit_under_review');
  end if;
  if coalesce(p_age_days,0)>=(w->>'ageThresholdDays')::integer then
    components:=components||jsonb_build_object('observed_age',(w->>'age')::numeric);
    reasons:=reasons||jsonb_build_array('observed_market_age:'||p_age_days);
  end if;
  if p_drops>0 then
    points:=least((w->>'dropCap')::numeric,p_drops*(w->>'dropEach')::numeric);
    components:=components||jsonb_build_object('price_drops',points);
    reasons:=reasons||jsonb_build_array('price_drops:'||p_drops);
  end if;
  if p_relaunches>0 then
    components:=components||jsonb_build_object('relistings',least((w->>'relistCap')::numeric,p_relaunches*(w->>'relistEach')::numeric));
    reasons:=reasons||jsonb_build_array('relaunches:'||p_relaunches);
  end if;
  if p_reduction_percent>0 then
    components:=components||jsonb_build_object('price_reduction',least((w->>'reductionCap')::numeric,p_reduction_percent*(w->>'reductionPerPercent')::numeric));
    reasons:=reasons||jsonb_build_array('price_reduction_percent:'||round(p_reduction_percent,2));
  end if;
  select least(100,greatest(0,coalesce(sum(value::numeric),0))) into score from jsonb_each_text(components);
  level:=case when p_agency_state='CLOSED_TO_PRIVATE' and score>=90 then 'HOT'
    when score>=75 then 'HIGH' when score>=50 then 'INTERESTING' when score>0 then 'WATCH' else 'NONE' end;
  if score=0 then reasons:=jsonb_build_array('no_current_opportunity_signal'); end if;
  return jsonb_build_object('score',round(score,2),'level',level,'reasons',reasons,'components',components,'ruleVersion',2);
end $$;
revoke all on function public.market_observer_assess_opportunity(text,text,integer,integer,integer,numeric) from public,anon;
grant execute on function public.market_observer_assess_opportunity(text,text,integer,integer,integer,numeric) to authenticated,service_role;

create or replace function public.refresh_property_lifecycle_intelligence_atomic(
  p_property_id uuid,p_as_of timestamptz default now()
) returns void language plpgsql security definer set search_path=public as $$
declare pr record; active_count integer; active_private boolean; has_sold boolean; has_active boolean; has_strong_sold boolean;
  sold_conflict boolean; manual_sale text; sale text; property_state_value text; best_state text;
  age_days integer; market_anchor timestamptz; drops integer; reduction numeric; assessment jsonb; evidence_ids jsonb;
begin
  select * into strict pr from public.properties where id=p_property_id for update;
  select mo.override_value #>> '{}' into manual_sale from public.manual_overrides mo
    where mo.target_type='PROPERTY' and mo.target_id=p_property_id and mo.override_key='sale_status'
      and mo.effective_at<=p_as_of and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)
    order by mo.effective_at desc,mo.created_at desc limit 1;
  select coalesce(bool_or(p.state='SOLD_MARKED' or p.source_status='SOLD' or sold_media.sold),false),
    coalesce(bool_or(p.state in ('ACTIVE','MISSING_PENDING') and p.source_status<>'SOLD' and not coalesce(sold_media.sold,false)),false),
    coalesce(bool_or(coalesce(sold_media.sold,false) and p.source_status not in ('SOLD','UNKNOWN')),false)
    into has_sold,has_active,sold_conflict
    from public.publications p join public.agency_listings al on al.id=p.agency_listing_id
    left join lateral (select coalesce(bool_or(a->>'canonicalUrl' ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)'),false) sold
      from (select normalized_payload from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) s,
        jsonb_array_elements(coalesce(s.normalized_payload->'assets','[]')) a) sold_media on true
    where al.property_id=p_property_id;
  select exists(select 1 from public.private_publications where property_id=p_property_id and state='ACTIVE') into active_private;
  sale:=coalesce(manual_sale,case when has_sold and (has_active or active_private or sold_conflict) then 'PROBABLE_SOLD'
    when has_sold then 'SOLD_CONFIRMED' else 'UNKNOWN' end);
  select exists(select 1 from public.publications p join public.agency_listings al on al.id=p.agency_listing_id
    join lateral (select normalized_payload from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) s on true
    where al.property_id=p_property_id and (
      ((p.state='SOLD_MARKED' or p.source_status='SOLD') and coalesce((s.normalized_payload #>> '{status,confidence}')::numeric,0)>=0.85)
      or exists(select 1 from jsonb_array_elements(coalesce(s.normalized_payload->'assets','[]')) asset
        where asset->>'canonicalUrl' ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)')
    )) into has_strong_sold;
  if manual_sale is null and has_sold and not has_strong_sold then sale:='PROBABLE_SOLD'; end if;
  -- Never erase human decisions about the commercial relationship.
  update public.agency_listings al set state=case
      when exists(select 1 from public.publications where agency_listing_id=al.id and state in ('ACTIVE','MISSING_PENDING')) then 'ACTIVE'
      when exists(select 1 from public.publications where agency_listing_id=al.id and state='SOLD_MARKED') then 'CLOSED_SOLD' else al.state end
    where al.property_id=p_property_id and al.state in ('ACTIVE','EXIT_PENDING','CLOSED_SOLD','CLOSED_SWITCHED','CLOSED_TO_PRIVATE','OFF_MARKET_NO_SALE_EVIDENCE')
      and not exists(select 1 from public.manual_overrides mo where mo.target_type='AGENCY_LISTING' and mo.target_id=al.id
        and mo.override_key='state' and mo.effective_at<=p_as_of
        and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id));
  select count(distinct agency_id) into active_count from public.agency_listings where property_id=p_property_id and state='ACTIVE';
  property_state_value:=case when sale='SOLD_CONFIRMED' and active_count=0 and not active_private then 'SOLD'
    when active_count>0 and active_private then 'ACTIVE_AGENCY_AND_PRIVATE'
    when active_count>1 then 'ACTIVE_MULTI_AGENCY' when active_count=1 then 'ACTIVE_AGENCY'
    when active_private then 'ACTIVE_PRIVATE' else 'OFF_MARKET_UNKNOWN' end;
  if pr.sale_status is distinct from sale then
    perform public.insert_property_lifecycle_event_atomic(p_property_id,null,null,null,'SALE_STATUS_CHANGED',p_as_of,
      p_property_id||':SALE_STATUS:'||sale||':'||p_as_of,
      case when manual_sale is not null then 1 when sale='SOLD_CONFIRMED' then 0.98 when sale='PROBABLE_SOLD' then 0.65 else 0.2 end,
      case when manual_sale is not null then 'USER' else 'SYSTEM' end,
      jsonb_build_object('oldStatus',pr.sale_status,'newStatus',sale,'hasSoldEvidence',has_sold,
        'hasActivePublication',has_active,'hasActivePrivate',active_private,'manual',manual_sale is not null),
      array(select e.id from public.evidence e where e.property_id=p_property_id
        and e.evidence_kind in ('STATUS','SALE_MARK') order by e.observed_at desc limit 30));
  end if;
  if sale='PROBABLE_SOLD' and manual_sale is null then
    insert into public.review_queue(review_type,status,property_id,title,details,dedupe_key)
      values('LIFECYCLE','OPEN',p_property_id,'Vendita e pubblicazioni attive da verificare',
        jsonb_build_object('hasSoldEvidence',has_sold,'hasActivePublication',has_active,'hasActivePrivate',active_private),
        'sale-conflict:'||p_property_id||':v2')
      on conflict(dedupe_key) do update set status='OPEN',details=excluded.details,updated_at=now();
  end if;
  update public.properties set sale_status=sale,property_state=property_state_value where id=p_property_id;
  select least(pr.first_seen_at,min(p.portal_published_at)) into market_anchor
    from public.publications p join public.agency_listings al on al.id=p.agency_listing_id where al.property_id=p_property_id;
  age_days:=greatest(0,floor(extract(epoch from (p_as_of-market_anchor))/86400)::integer);
  -- Conservative cross-source count: mirrored portal changes must not multiply the score.
  -- Preserve every publication's full history; score the largest observed drop count.
  select coalesce(max(m.drop_count),0) into drops from public.market_observer_publication_metrics m
    join public.agency_listings al on al.id=m.agency_listing_id where al.property_id=p_property_id
      and (active_count=0 or al.state='ACTIVE');
  select max(m.reduction_percent) into reduction from public.market_observer_publication_metrics m
    join public.agency_listings al on al.id=m.agency_listing_id where al.property_id=p_property_id
      and (active_count=0 or al.state='ACTIVE');
  -- An old closed listing does not override the current multi-source market presence.
  select state into best_state from public.agency_listings where property_id=p_property_id
    and (active_count=0 or state='ACTIVE') order by case state
      when 'CLOSED_TO_PRIVATE' then 5 when 'OFF_MARKET_NO_SALE_EVIDENCE' then 4
      when 'CLOSED_SWITCHED' then 3 when 'EXIT_PENDING' then 2 else 1 end desc limit 1;
  assessment:=public.market_observer_assess_opportunity(sale,best_state,age_days,drops,pr.relaunch_count,reduction);
  select coalesce(jsonb_agg(id),'[]') into evidence_ids from
    (select id from public.evidence where property_id=p_property_id order by observed_at desc limit 30) e;
  insert into public.opportunities(property_id,opportunity_type,status,level,score,evidence_summary,reasons,rule_version,dedupe_key)
    values(p_property_id,'ACQUISITION',case when assessment->>'level'='NONE' then
      case when sale='SOLD_CONFIRMED' then 'DISMISSED' else 'EXPIRED' end else 'OPEN' end,
      assessment->>'level',(assessment->>'score')::numeric,
      jsonb_build_object('propertyState',property_state_value,'components',assessment->'components','ruleVersion',2,
        'marketAnchor',market_anchor,'ageDays',age_days,'priceDropCount',drops,'reductionPercent',reduction,
        'evidenceIds',evidence_ids,'asOf',p_as_of),assessment->'reasons',2,'acquisition:'||p_property_id||':v1')
    on conflict(dedupe_key) do update set
      status=case when opportunities.status in ('QUALIFIED','ACTIONED','DISMISSED') then opportunities.status else excluded.status end,
      level=excluded.level,score=excluded.score,evidence_summary=excluded.evidence_summary,reasons=excluded.reasons,
      rule_version=excluded.rule_version,updated_at=now();
end $$;

-- Linking is explicit and idempotent. It does not invent a contact or overwrite the user's next action.
alter table public.acquisition_signals
  add column opportunity_id uuid references public.opportunities(id) on delete restrict,
  add column agency_listing_id uuid references public.agency_listings(id) on delete restrict;
create unique index acquisition_market_opportunity_signal on public.acquisition_signals(opportunity_id) where opportunity_id is not null;
create function public.acquisition_link_market_opportunity(p_opportunity_id uuid,p_actor_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare op record; pr record; lead uuid; inserted integer; agency_listing uuid;
begin
  select * into strict op from public.opportunities where id=p_opportunity_id and opportunity_type='ACQUISITION' for update;
  select * into strict pr from public.properties where id=op.property_id for update;
  select s.lead_id into lead from public.acquisition_signals s where s.opportunity_id=op.id;
  if lead is not null then return lead; end if;
  if op.level='NONE' or pr.sale_status='SOLD_CONFIRMED' then raise exception 'No current acquisition opportunity'; end if;
  select id into lead from public.acquisition_leads where property_id=pr.id
    and (status not in ('WON','FUTURE','NOT_INTERESTED','LOST') or status='WON')
    order by case when status='WON' then 1 else 0 end,created_at desc limit 1;
  if lead is null then
    insert into public.acquisition_leads(property_id,address,locality,source_type,status,priority,next_action_type,next_action_note,created_by)
      values(pr.id,coalesce(nullif(pr.canonical_attributes->>'address',''),'Immobile da verificare'),
        coalesce(nullif(pr.canonical_attributes->>'locality',''),'Bitonto'),'market_observer','VERIFY',
        case when op.score>=75 then 'A' when op.score>=50 then 'B' else 'C' end,
        'verification','Verificare le evidenze di mercato e individuare il contatto.',p_actor_id)
      on conflict(property_id) where property_id is not null and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')
      do update set property_id=excluded.property_id returning id into lead;
  end if;
  select id into agency_listing from public.agency_listings where property_id=pr.id order by last_seen_at desc limit 1;
  insert into public.acquisition_signals(lead_id,property_id,source_type,signal_type,description,source_reference,details,dedupe_key,
      observed_at,opportunity_id,agency_listing_id)
    values(lead,pr.id,'market_observer','acquisition_opportunity','Opportunità da evidenze pubbliche',
      '/casa/'||pr.id,op.evidence_summary||jsonb_build_object('score',op.score,'reasons',op.reasons,'ruleVersion',op.rule_version),
      'market-opportunity:'||op.id,op.detected_at,op.id,agency_listing) on conflict(dedupe_key) do nothing;
  get diagnostics inserted=row_count;
  if inserted>0 then insert into public.acquisition_activities(lead_id,activity_type,outcome,note,actor_id)
    values(lead,'system_signal','market_observer','Opportunità collegata dall’Intelligence.',p_actor_id); end if;
  return lead;
end $$;
revoke all on function public.acquisition_link_market_opportunity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquisition_link_market_opportunity(uuid,uuid) to service_role;

create function public.renew_lifecycle_job(p_job_id uuid,p_worker_id text,p_lease_seconds integer default 300)
returns boolean language sql security definer set search_path=public as $$
  with renewed as (update public.lifecycle_jobs set lease_expires_at=now()+make_interval(secs=>greatest(60,least(1800,p_lease_seconds)))
    where id=p_job_id and worker_id=p_worker_id and status='RUNNING' and lease_expires_at>now() returning id)
  select exists(select 1 from renewed);
$$;
revoke all on function public.renew_lifecycle_job(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.renew_lifecycle_job(uuid,text,integer) to service_role;

-- Operational projection. Old date bounds remain estimates; market_anchor uses observed/source publication facts only.
create view public.market_observer_agency_listing_intelligence with (security_invoker=true) as
select al.id agency_listing_id,al.property_id,al.agency_id,a.name agency_name,al.state,
  al.first_seen_at,al.last_seen_at,al.estimated_acquisition_at,al.acquisition_confidence,
  coalesce(pr.canonical_attributes->>'address',pr.id::text) address,
  pr.canonical_attributes->>'locality' locality,pr.sale_status,pr.property_state,
  least(pr.first_seen_at,dates.published_at) earliest_market_evidence_at,
  case when pr.sale_status='SOLD_CONFIRMED' and al.state not in ('CLOSED_SWITCHED','CLOSED_WITHDRAWN','CLOSED_TO_PRIVATE') then dates.sold_observed_at end sold_at,
  al.exit_confirmed_at delisted_at,
  case when pr.sale_status='SOLD_CONFIRMED' and al.state not in ('CLOSED_SWITCHED','CLOSED_WITHDRAWN','CLOSED_TO_PRIVATE') then 'SOLD_CONFIRMED'
    when pr.sale_status='PROBABLE_SOLD' and exists(select 1 from public.publications where agency_listing_id=al.id and state='SOLD_MARKED') then 'SOLD_PROBABLE'
    when exists(select 1 from public.publications where agency_listing_id=al.id and state='ACTIVE' and source_status='NEGOTIATION') then 'UNDER_OFFER'
    when al.state='CLOSED_WITHDRAWN' then 'WITHDRAWN' when al.state='CLOSED_SWITCHED' then 'AGENCY_CHANGED'
    when al.state='CLOSED_TO_PRIVATE' then 'RELISTED' when al.state='OFF_MARKET_NO_SALE_EVIDENCE' then 'UNKNOWN_EXIT'
    when al.state='EXIT_PENDING' then 'MISSING_UNCONFIRMED' else 'ACTIVE' end exit_classification,
  case when pr.sale_status='SOLD_CONFIRMED' then 0.98 when pr.sale_status='PROBABLE_SOLD' then 0.65
    else al.outcome_confidence end exit_confidence,
  prices.first_asking_price,prices.latest_asking_price,prices.reduction_percent,prices.drop_count,
  prices.canonical_url price_source_url,op.score opportunity_score,op.reasons,op.evidence_summary
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
left join lateral (select * from public.market_observer_publication_metrics where agency_listing_id=al.id
  order by last_seen_at desc,publication_id limit 1) prices on true
left join public.opportunities op on op.property_id=pr.id and op.opportunity_type='ACQUISITION';
grant select on public.market_observer_agency_listing_intelligence to authenticated,service_role;
comment on view public.market_observer_agency_listing_intelligence is
  'Sold dates are first observed sold evidence, not deed dates. EXPIRED_POSSIBLE is never inferred from public listing age.';
create or replace function public.lifecycle_property_hydration(p_ids uuid[])
returns table (
  property_id uuid,
  agency_refs jsonb,
  latest_snapshot jsonb,
  latest_private jsonb,
  active_private_count integer
)
language sql
stable
as $$
  with wanted as (
    select distinct pid from unnest(p_ids) as elenco(pid)
  ),
  refs as (
    select
      al.property_id as pid,
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'slug', a.slug,
          'name', a.name,
          'listingId', al.id,
          'state', al.state,
          'reference', al.agency_reference,
          'firstSeenAt', al.first_seen_at,
          'lastSeenAt', al.last_seen_at
        )
        order by al.last_seen_at desc, al.id
      ) as refs
    from public.agency_listings al
    join public.agencies a on a.id = al.agency_id
    where al.property_id = any(p_ids)
    group by al.property_id
  ),
  snap as (
    select distinct on (al.property_id)
      al.property_id as pid,
      jsonb_build_object(
        'title', s.title,
        'price_amount', s.price_amount,
        'surface_sqm', s.surface_sqm,
        'rooms', s.rooms,
        'observed_at', coalesce(receipt.observed_at,s.observed_at)
      ) as snapshot
    from public.agency_listings al
    join public.publications p on p.agency_listing_id = al.id
    join lateral (select * from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) s on true
    left join lateral (select observed_at from public.publication_observation_receipts where publication_id=p.id
      order by observed_at desc limit 1) receipt on true
    where al.property_id = any(p_ids)
    order by al.property_id, coalesce(receipt.observed_at,s.observed_at) desc, s.observed_at desc, p.id
  ),
  priv as (
    select
      pp.property_id as pid,
      (array_agg(
        jsonb_build_object(
          'title', pp.title,
          'price_amount', pp.price_amount,
          'surface_sqm', pp.surface_sqm,
          'rooms', pp.rooms,
          'last_seen_at', pp.last_seen_at
        )
        order by pp.last_seen_at desc, pp.id
      ))[1] as latest,
      (count(*) filter (where pp.state = 'ACTIVE'))::integer as active_count
    from public.private_publications pp
    where pp.property_id = any(p_ids)
    group by pp.property_id
  )
  select
    wanted.pid,
    coalesce(refs.refs, '[]'::jsonb),
    snap.snapshot || jsonb_build_object('earliest_market_evidence_at',least(
      (select first_seen_at from public.properties where id=wanted.pid),
      (select min(p.portal_published_at) from public.publications p
        join public.agency_listings al on al.id=p.agency_listing_id where al.property_id=wanted.pid),
      (select min(first_public_evidence_at) from public.private_publications where property_id=wanted.pid)
    )),
    priv.latest || jsonb_build_object('earliest_market_evidence_at',least(
      (select first_seen_at from public.properties where id=wanted.pid),
      (select min(first_public_evidence_at) from public.private_publications where property_id=wanted.pid)
    )),
    coalesce(priv.active_count, 0)
  from wanted
  left join refs on refs.pid = wanted.pid
  left join snap on snap.pid = wanted.pid
  left join priv on priv.pid = wanted.pid;
$$;
commit;
