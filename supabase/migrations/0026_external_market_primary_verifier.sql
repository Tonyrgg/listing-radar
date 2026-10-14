-- Add a certified primary detail source, keeping inventory/missing disabled.
-- No archive duplication, backfill, agency attribution or rollout activation.
begin;
alter table public.market_observer_sources drop constraint market_observer_sources_source_key_check;
alter table public.market_observer_sources add constraint market_observer_sources_source_key_check
  check(source_key in ('WIKICASA','IMMOBILIARE','CASA','REMAX','IDEALISTA','SEARCH_INDEX'));
insert into public.market_observer_sources(source_key) values('REMAX');

create or replace function public.persist_market_external_observation_atomic(p_source_key text,p_agency_id uuid,p_listing jsonb,
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
    or (p_source_key='REMAX' and p_listing#>>'{source,canonicalUrl}' ~ '^https://stella-polare\.remax\.it/vendita-[a-z-]+/(bitonto|palombaio|mariotto)/[a-z0-9-]+-[0-9]+-[0-9]+/?$')
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

-- Only targeted, configured known URLs; never a replacement for inventory.
create or replace function public.queue_market_external_exit_verifiers() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.state in ('EXIT_PENDING','OFF_MARKET_NO_SALE_EVIDENCE') and new.state is distinct from old.state then
    insert into public.lifecycle_jobs(job_type,agency_id,payload,priority,dedupe_key)
    select 'VERIFY_MARKET_PUBLICATION',new.agency_id,
      jsonb_build_object('source',s.source_key,'publicationId',p.id,'trigger','EXIT_CANDIDATE'),50,
      'market-exit-verifier:'||p.id||':'||new.state||':'||coalesce(new.post_exit_check_due_at,now())::text
    from public.publications p
    join (values
      ('IMMOBILIARE','^https://(www\.)?immobiliare\.it/annunci/[0-9]+/?$'),
      ('REMAX','^https://stella-polare\.remax\.it/vendita-[a-z-]+/(bitonto|palombaio|mariotto)/[a-z0-9-]+-[0-9]+-[0-9]+/?$')
    ) known(source_key,url_pattern) on p.canonical_url ~ known.url_pattern
    join public.market_observer_sources s on s.source_key=known.source_key and s.enabled
    where p.agency_listing_id=new.id
    on conflict do nothing;
  end if;
  return new;
end $$;
commit;
