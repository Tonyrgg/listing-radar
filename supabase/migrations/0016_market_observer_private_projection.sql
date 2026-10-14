-- Include private-only properties in the same Intelligence workspace, using V2 observations.
begin;
create view public.market_observer_intelligence with (security_invoker=true) as
select agency.*,agency.agency_listing_id::text row_id from public.market_observer_agency_listing_intelligence agency
union all
select private_row.*,pr.id::text row_id
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
  'reasons',op.reasons,'evidence_summary',op.evidence_summary
)) private_row
where pr.identity_status<>'MERGED' and not exists(select 1 from public.agency_listings where property_id=pr.id);
grant select on public.market_observer_intelligence to authenticated,service_role;

-- Bounded recomputation for an existing archive. The caller controls pages; source history remains immutable.
create function public.recompute_market_observer_intelligence(p_property_ids uuid[],p_as_of timestamptz default now())
returns integer language plpgsql security definer set search_path=public as $$
declare pid uuid; processed integer:=0;
begin
  if coalesce(cardinality(p_property_ids),0)>100 then raise exception 'Maximum batch size is 100'; end if;
  for pid in select id from public.properties where id=any(p_property_ids) and identity_status<>'MERGED' order by id loop
    perform public.refresh_property_lifecycle_intelligence_atomic(pid,p_as_of);
    processed:=processed+1;
  end loop;
  return processed;
end $$;
revoke all on function public.recompute_market_observer_intelligence(uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.recompute_market_observer_intelligence(uuid[],timestamptz) to service_role;
commit;
