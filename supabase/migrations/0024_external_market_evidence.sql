-- External sources enrich the existing V2 archive. Observation-only rollout; no portal missing.
begin;
create table public.market_observer_sources (
  source_key text primary key check(source_key in ('WIKICASA','IMMOBILIARE','CASA','IDEALISTA','SEARCH_INDEX')),
  enabled boolean not null default false,
  projections_enabled boolean not null default false,
  missing_enabled boolean not null default false check(not missing_enabled),
  inventory_roots text[] not null default '{}',
  health_baseline jsonb not null default '{}',
  policy_version text not null default 'external_market_evidence_v1',
  updated_at timestamptz not null default now()
);
insert into public.market_observer_sources(source_key,inventory_roots) values
  ('WIKICASA',array['https://www.wikicasa.it/vendita-case/bitonto/']),
  ('IMMOBILIARE','{}'),('CASA','{}'),('IDEALISTA','{}'),('SEARCH_INDEX','{}');

alter table public.agencies add column market_role text not null default 'UNKNOWN'
  check(market_role in ('OUR_AGENCY','COMPETITOR','PRIVATE','UNKNOWN'));
-- Explicit curated mappings, never brand-name inference. In particular, not every Tecnocasa branch is ours.
create table public.market_observer_agency_identities (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.market_observer_sources(source_key),
  external_agency_id text,
  normalized_name text,
  agency_id uuid not null references public.agencies(id),
  provenance jsonb not null default '{}',
  confirmed_at timestamptz not null default now(),
  check(external_agency_id is not null or normalized_name is not null)
);
create unique index market_agency_external_identity on public.market_observer_agency_identities(source_key,external_agency_id)
  where external_agency_id is not null;
create unique index market_agency_name_identity on public.market_observer_agency_identities(source_key,normalized_name)
  where normalized_name is not null;

create table public.market_observer_source_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.market_observer_sources(source_key),
  job_id uuid references public.lifecycle_jobs(id),
  started_at timestamptz not null default now(), finished_at timestamptz,
  state text not null default 'RUNNING' check(state in ('RUNNING','HEALTHY','DEGRADED','FAILED')),
  inventory_complete boolean not null default false,
  baseline_ready boolean not null default false,
  absence_evaluation_allowed boolean not null default false check(not absence_evaluation_allowed),
  discovered_count integer not null default 0, detail_fetch_count integer not null default 0,
  confirmed_seen_count integer not null default 0, review_count integer not null default 0,
  diagnostics jsonb not null default '{}'
);
create index market_source_run_latest on public.market_observer_source_runs(source_key,started_at desc);
create index market_source_run_running on public.market_observer_source_runs(source_key) where state='RUNNING';
create function public.start_market_external_source_run(p_source_key text,p_job_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare run_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('external-source-lease:'||p_source_key,0));
  if not exists(select 1 from public.market_observer_sources where source_key=p_source_key and enabled) then raise exception 'Source disabled'; end if;
  if not exists(select 1 from public.lifecycle_jobs where id=p_job_id and status='RUNNING' and lease_expires_at>now()) then raise exception 'Source job lease required'; end if;
  if exists(select 1 from public.market_observer_source_runs r join public.lifecycle_jobs j on j.id=r.job_id
    where r.source_key=p_source_key and r.state='RUNNING' and j.status='RUNNING' and j.lease_expires_at>now() and j.id<>p_job_id) then
    raise exception 'EXTERNAL_SOURCE_BUSY'; end if;
  update public.market_observer_source_runs set state='FAILED',finished_at=now(),diagnostics=diagnostics||'{"leaseRecovered":true}'
    where source_key=p_source_key and state='RUNNING';
  insert into public.market_observer_source_runs(source_key,job_id) values(p_source_key,p_job_id) returning id into run_id;
  return run_id;
end $$;
alter table public.publications add column external_source_key text references public.market_observer_sources(source_key);
alter table public.publications add column external_inventory_marker text;
alter table public.publications add column external_detail_at timestamptz;
alter table public.publications add column external_projection_enabled boolean;
create index publications_external_source on public.publications(external_source_key,external_id);
-- Additive metadata on evidence; append-only evidence contents remain protected.
create index evidence_external_dates on public.evidence(property_id,source_recorded_at)
  where claim_key in ('publication.historicalMarketEvidence','publication.datePublished');
create index evidence_external_hash on public.evidence(property_id,publication_id,evidence_hash) where metadata ? 'source';

alter table public.lifecycle_jobs drop constraint lifecycle_jobs_job_type_check;
alter table public.lifecycle_jobs add constraint lifecycle_jobs_job_type_check check(job_type in
  ('SYNC_AGENCY','SYNC_ALL','DEEP_SYNC_AGENCY','DEEP_SYNC_ALL','BOOTSTRAP_AGENCY','BOOTSTRAP_ALL',
   'POST_EXIT_CHECK','BUILDING_DATA_SYNC','SYNC_PRIVATE_RADAR','SYNC_MARKET_SOURCE','VERIFY_MARKET_PUBLICATION'));

create function public.market_external_claims_atomic(p_property_id uuid,p_publication_id uuid,p_sync_run_id uuid,
  p_source_key text,p_claims jsonb,p_observed_at timestamptz) returns uuid[] language plpgsql security definer set search_path=public as $$
declare c jsonb; h text; eid uuid; ids uuid[]:='{}'; recorded timestamptz; threshold numeric;
begin
  if not exists(select 1 from public.market_observer_sources where source_key=p_source_key and enabled) then
    raise exception 'External source disabled'; end if;
  if p_publication_id is not null and not exists(select 1 from public.publications p join public.agency_listings al on al.id=p.agency_listing_id
    where p.id=p_publication_id and al.property_id=p_property_id) then raise exception 'Evidence ownership mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('external-evidence:'||p_property_id::text,0));
  for c in select value from jsonb_array_elements(p_claims) loop
    if c->>'observedAt' is distinct from p_observed_at::text and (c->>'observedAt')::timestamptz<>p_observed_at then
      raise exception 'Evidence observation timestamp mismatch'; end if;
    recorded:=nullif(c->>'sourceRecordedAt','')::timestamptz;
    if recorded>p_observed_at then raise exception 'Future evidence date'; end if;
    if c->>'sourceUrl' !~ '^https://' then raise exception 'Evidence requires public HTTPS provenance'; end if;
    threshold:=case when c#>>'{metadata,retrievalMethod}'='INDEX_CAPTURE' then 0.65 else 1 end;
    if (c->>'confidence')::numeric>threshold then raise exception 'Evidence exceeds retrieval confidence ceiling'; end if;
    h:=encode(extensions.digest(jsonb_build_object('source',p_source_key,'url',c->>'sourceUrl','key',c->>'claimKey',
      'value',case when jsonb_typeof(c->'normalizedValue')='object' then (c->'normalizedValue')-'soldObservedAt'-'changeUpperBound' else c->'normalizedValue' end,
      'recorded',recorded,'method',c->>'extractionMethod','metadata',c->'metadata')::text,'sha256'),'hex');
    select id into eid from public.evidence e where property_id=p_property_id and publication_id is not distinct from p_publication_id
      and metadata ? 'source' and metadata->>'source'=p_source_key and (
        evidence_hash=h or (claim_key=c->>'claimKey' and source_url=c->>'sourceUrl' and extraction_method=c->>'extractionMethod'
          and source_recorded_at is not distinct from recorded and confidence=(c->>'confidence')::numeric
          and metadata->>'policyVersion'=c#>>'{metadata,policyVersion}'
          and metadata=coalesce(c->'metadata','{}')||jsonb_build_object('source',p_source_key)
          and (case when jsonb_typeof(normalized_value)='object' then normalized_value-'soldObservedAt'-'changeUpperBound' else normalized_value end)=
            (case when jsonb_typeof(c->'normalizedValue')='object' then (c->'normalizedValue')-'soldObservedAt'-'changeUpperBound' else c->'normalizedValue' end)))
      order by observed_at,id limit 1;
    if eid is null then
      insert into public.evidence(property_id,publication_id,sync_run_id,evidence_kind,source_url,extraction_method,claim_key,
        raw_value,normalized_value,confidence,observed_at,source_recorded_at,evidence_hash,metadata)
      values(p_property_id,p_publication_id,p_sync_run_id,c->>'kind',c->>'sourceUrl',c->>'extractionMethod',c->>'claimKey',
        c->>'rawValue',c->'normalizedValue',(c->>'confidence')::numeric,p_observed_at,recorded,h,
        coalesce(c->'metadata','{}')||jsonb_build_object('source',p_source_key)) returning id into eid;
    end if;
    ids:=array_append(ids,eid); eid:=null;
  end loop;
  return ids;
end $$;

create function public.persist_market_external_observation_atomic(p_source_key text,p_agency_id uuid,p_listing jsonb,
  p_identity_decision jsonb,p_claims jsonb,p_marker text default null,p_processed_assets jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=public as $$
declare config record; sr uuid; result jsonb; pub uuid; prop uuid; ids uuid[]; original jsonb:=p_listing;
  observed timestamptz:=(p_listing->>'observedAt')::timestamptz; previous record;
begin
  select * into strict config from public.market_observer_sources where source_key=p_source_key for share;
  if not config.enabled then raise exception 'External source disabled'; end if;
  if p_source_key='SEARCH_INDEX' then raise exception 'Historical evidence is not a live publication'; end if;
  if not ((p_source_key='WIKICASA' and p_listing#>>'{source,canonicalUrl}' ~ '^https://(www\.)?wikicasa\.it/annuncio/[0-9]+/?$')
    or (p_source_key='IMMOBILIARE' and p_listing#>>'{source,canonicalUrl}' ~ '^https://(www\.)?immobiliare\.it/annunci/[0-9]+/?$')
    or (p_source_key='CASA' and p_listing#>>'{source,canonicalUrl}' ~ '^https://(www\.)?casa\.it/immobili/[0-9]+/?$')
    or (p_source_key='IDEALISTA' and p_listing#>>'{source,canonicalUrl}' ~ '^https://(www\.)?idealista\.it/immobile/[0-9]+/?$')) then
    raise exception 'Unapproved publication source URL'; end if;
  if p_listing#>>'{provenance,method}'<>'PRIMARY_HTTP' then raise exception 'Only direct primary observations may assert current presence'; end if;
  if exists(select 1 from jsonb_array_elements(p_claims) c where c->>'sourceUrl' is distinct from p_listing#>>'{source,canonicalUrl}'
    or c#>>'{metadata,source}' is distinct from p_source_key or c#>>'{metadata,policyVersion}' is distinct from config.policy_version) then
    raise exception 'External evidence provenance mismatch'; end if;
  if p_listing#>>'{location,scope}'<>'IN_SCOPE' then raise exception 'External observation outside verified scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('external-publication:'||p_source_key||':'||(p_listing#>>'{source,externalId}'),0));
  select p.* into previous from public.publications p where
    (p.external_source_key=p_source_key and p.external_id=p_listing#>>'{source,externalId}')
    or regexp_replace(p.canonical_url,'/$','')=regexp_replace(p_listing#>>'{source,canonicalUrl}','/$','')
    order by p.id limit 1 for update;
  if previous.id is not null and previous.agency_id<>p_agency_id then raise exception 'Publication agency change requires review'; end if;
  if previous.last_seen_at>observed then raise exception 'Observation precedes last seen'; end if;
  if previous.id is not null then
    p_listing:=jsonb_set(p_listing,'{source,sourceKey}',to_jsonb(previous.source_key));
  end if;
  -- Unavailability is a verifier fact, never a substitute for a complete healthy inventory.
  if exists(select 1 from jsonb_array_elements(p_claims) c where c->>'claimKey'='publication.externalStatus'
    and c#>>'{normalizedValue,status}'='REMOVED') then
    if previous.id is null then raise exception 'EXTERNAL_UNAVAILABLE_REVIEW_REQUIRED'; end if;
    select property_id into prop from public.agency_listings where id=previous.agency_listing_id;
    ids:=public.market_external_claims_atomic(prop,previous.id,null,p_source_key,p_claims,observed);
    return jsonb_build_object('propertyId',prop,'publicationId',previous.id,'agencyListingId',previous.agency_listing_id,
      'createdProperty',false,'createdPublication',false,'evidenceIds',ids,'presenceUnchanged',true);
  end if;
  if not config.projections_enabled then
    p_listing:=jsonb_set(p_listing,'{source,portalPublishedAt}','null');
    p_listing:=jsonb_set(p_listing,'{source,soldAt}','null');
    p_listing:=jsonb_set(p_listing,'{status}',jsonb_build_object('value','UNKNOWN','sourceLabel',null,'confidence',0.2,'evidence','[]'::jsonb));
    p_listing:=jsonb_set(p_listing,'{marketStart}',jsonb_build_object('lowerBound',null,'upperBound',observed,
      'method','CRAWLER_FIRST_SEEN','confidence',0.2,'evidence','[]'::jsonb));
    -- Interpretation is part of the snapshot identity, so enabling it cannot be swallowed by deduplication.
    p_listing:=jsonb_set(p_listing,'{contentHash}',to_jsonb(encode(extensions.digest((p_listing->>'contentHash')||':observation-only','sha256'),'hex')));
  end if;
  insert into public.sync_runs(agency_id,adapter_key,mode,started_at,diagnostics)
    values(p_agency_id,'external:'||lower(p_source_key),'SYNC',observed,jsonb_build_object('source',p_source_key,'observationOnly',true)) returning id into sr;
  result:=public.persist_property_lifecycle_observation_atomic(p_agency_id,sr,p_listing,p_identity_decision,p_processed_assets,
    encode(extensions.digest((p_listing->'location')::text,'sha256'),'hex'),null,null,null);
  pub:=(result->>'publicationId')::uuid; prop:=(result->>'propertyId')::uuid;
  -- Enriching a known primary publication must not revoke its existing inventory ownership.
  update public.publications set external_source_key=case when previous.id is not null and previous.external_source_key is null
      and lower(regexp_replace(substring(previous.canonical_url from '^https?://([^/]+)'),'^www\.',''))=
        (select lower(regexp_replace(substring(inventory_url from '^https?://([^/]+)'),'^www\.','')) from public.agencies where id=p_agency_id)
    then null else p_source_key end,external_inventory_marker=p_marker,
    external_detail_at=observed,external_projection_enabled=config.projections_enabled where id=pub;
  ids:=public.market_external_claims_atomic(prop,pub,sr,p_source_key,p_claims,observed);
  update public.sync_runs set status='SUCCEEDED',finished_at=now(),health_state='HEALTHY',inventory_complete=false,
    absence_evaluation_allowed=false,discovered_count=1,normalized_count=1,in_scope_count=1 where id=sr;
  if config.projections_enabled then perform public.refresh_property_lifecycle_intelligence_atomic(prop,observed); end if;
  return result||jsonb_build_object('evidenceIds',ids,'syncRunId',sr,'projectionsEnabled',config.projections_enabled);
end $$;

create function public.confirm_market_external_presence_atomic(p_source_key text,p_external_id text,p_marker text,p_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare pub record;
begin
  if not exists(select 1 from public.market_observer_sources where source_key=p_source_key and enabled) then raise exception 'Source disabled'; end if;
  select p.*,al.property_id into pub from public.publications p join public.agency_listings al on al.id=p.agency_listing_id
    where p.external_source_key=p_source_key and p.external_id=p_external_id for update of p;
  if pub.id is null then raise exception 'Unknown publication'; end if;
  if pub.external_inventory_marker is distinct from p_marker or p_marker is null or pub.state<>'ACTIVE' then raise exception 'Detail required'; end if;
  update public.publications set last_seen_at=greatest(last_seen_at,p_at) where id=pub.id;
  update public.agency_listings set last_seen_at=greatest(last_seen_at,p_at) where id=pub.agency_listing_id;
  update public.properties set last_seen_at=greatest(last_seen_at,p_at) where id=pub.property_id;
  -- A lightweight fact, not another full snapshot. Its timestamp demonstrates positive catalog presence.
  insert into public.evidence(property_id,publication_id,evidence_kind,source_url,extraction_method,claim_key,normalized_value,
    confidence,observed_at,evidence_hash,metadata) values(pub.property_id,pub.id,'PRESENCE',pub.canonical_url,
      'EXTERNAL_INVENTORY_V1','publication.inventoryPresence','{"present":true,"detailFieldsRead":false}',0.95,p_at,
      encode(extensions.digest(pub.id||':external-seen:'||p_at::text,'sha256'),'hex'),jsonb_build_object('source',p_source_key))
    on conflict do nothing;
end $$;

create function public.queue_market_external_exit_verifiers() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.state in ('EXIT_PENDING','OFF_MARKET_NO_SALE_EVIDENCE') and new.state is distinct from old.state
    and exists(select 1 from public.market_observer_sources where source_key='IMMOBILIARE' and enabled) then
    insert into public.lifecycle_jobs(job_type,agency_id,payload,priority,dedupe_key)
    select 'VERIFY_MARKET_PUBLICATION',new.agency_id,
      jsonb_build_object('source','IMMOBILIARE','publicationId',p.id,'trigger','EXIT_CANDIDATE'),50,
      'market-exit-verifier:'||p.id||':'||new.state||':'||coalesce(new.post_exit_check_due_at,now())::text
    from public.publications p where p.agency_listing_id=new.id
      and p.canonical_url ~ '^https://(www\.)?immobiliare\.it/annunci/[0-9]+/?$'
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger market_external_exit_verifiers after update of state on public.agency_listings
  for each row execute function public.queue_market_external_exit_verifiers();

create function public.market_observer_earliest_evidence(p_property_id uuid)
returns timestamptz language sql stable set search_path=public as $$
  select least(p.first_seen_at,
    (select min(pub.portal_published_at) from public.publications pub join public.agency_listings al on al.id=pub.agency_listing_id
      where al.property_id=p.id and (pub.external_source_key is null or exists(select 1 from public.market_observer_sources s
        where s.source_key=pub.external_source_key and s.projections_enabled))),
    (select min(e.source_recorded_at) from public.evidence e join public.market_observer_sources s on s.source_key=e.metadata->>'source'
      where e.property_id=p.id and s.projections_enabled and e.claim_key in ('publication.datePublished','publication.historicalMarketEvidence')
        and e.confidence>=0.6 and e.source_recorded_at<=e.observed_at),
    (select min(first_public_evidence_at) from public.private_publications where property_id=p.id))
  from public.properties p where p.id=p_property_id
$$;

create view public.market_observer_external_price_evidence with(security_invoker=true) as
select e.id,e.property_id,e.publication_id,e.source_url,e.observed_at,e.source_recorded_at,e.claim_key,e.confidence,
  (e.normalized_value->>'amount')::integer amount,(e.normalized_value->>'currentAmount')::integer current_amount,
  nullif(e.normalized_value->>'changeDate','')::timestamptz change_date,
  case when e.claim_key='publication.previousAskingPrice' and e.normalized_value->>'changeDate' is null then 'UNKNOWN'
    when e.source_recorded_at is not null then 'DAY' else 'OBSERVED' end date_precision,e.metadata
from public.evidence e join public.market_observer_sources s on s.source_key=e.metadata->>'source'
where s.projections_enabled and e.claim_key in ('publication.askingPrice','publication.previousAskingPrice')
  and e.normalized_value->>'amount' ~ '^[0-9]+$';

create view public.market_observer_evidence_contradictions with(security_invoker=true) as
select property_id,publication_id,'PUBLICATION_DATE_DISAGREEMENT'::text reason,
  array_agg(id order by source_recorded_at,id) evidence_ids,min(source_recorded_at) earliest_claim,max(source_recorded_at) latest_claim
from public.evidence where claim_key in ('publication.datePublished','publication.historicalMarketEvidence') and source_recorded_at is not null
group by property_id,publication_id having count(distinct source_recorded_at)>1;
-- Cross-source disagreement is visible separately from same-publication corrections.
create view public.market_observer_cross_source_dates with(security_invoker=true) as
select property_id,count(distinct source_recorded_at) distinct_dates,array_agg(id order by source_recorded_at,id) evidence_ids,
  min(source_recorded_at) earliest_claim,max(source_recorded_at) latest_claim
from public.evidence where claim_key in ('publication.datePublished','publication.historicalMarketEvidence') and source_recorded_at is not null
group by property_id;

alter table public.market_observer_sources enable row level security;
alter table public.market_observer_agency_identities enable row level security;
alter table public.market_observer_source_runs enable row level security;
create policy external_sources_read on public.market_observer_sources for select to authenticated using(true);
create policy external_agency_identity_read on public.market_observer_agency_identities for select to authenticated using(true);
create policy external_source_runs_read on public.market_observer_source_runs for select to authenticated using(true);
grant select on public.market_observer_sources,public.market_observer_agency_identities,public.market_observer_source_runs,
  public.market_observer_external_price_evidence,public.market_observer_evidence_contradictions,public.market_observer_cross_source_dates to authenticated;
grant all on public.market_observer_sources,public.market_observer_agency_identities,public.market_observer_source_runs to service_role;
grant select on public.market_observer_external_price_evidence,public.market_observer_evidence_contradictions,public.market_observer_cross_source_dates to service_role;
revoke all on function public.persist_market_external_observation_atomic(text,uuid,jsonb,jsonb,jsonb,text,jsonb),
  public.start_market_external_source_run(text,uuid),
  public.market_external_claims_atomic(uuid,uuid,uuid,text,jsonb,timestamptz),
  public.confirm_market_external_presence_atomic(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.persist_market_external_observation_atomic(text,uuid,jsonb,jsonb,jsonb,text,jsonb),
  public.start_market_external_source_run(text,uuid),
  public.market_external_claims_atomic(uuid,uuid,uuid,text,jsonb,timestamptz),
  public.confirm_market_external_presence_atomic(text,text,text,timestamptz) to service_role;
commit;
