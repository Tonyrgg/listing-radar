-- Market Observer reliability. Additive, no historical deletion or invented mandate dates.
begin;
alter table public.publications
  add column portal_published_at timestamptz,
  add column portal_modified_at timestamptz;
alter table public.agency_listings
  add column estimated_acquisition_at timestamptz,
  add column acquisition_confidence numeric check(acquisition_confidence between 0 and 1),
  add column acquisition_evidence_id uuid references public.evidence(id) on delete restrict;
comment on column public.agency_listings.estimated_acquisition_at is
  'Unknown without mandate-specific evidence. Never inferred from portal publication, photo dates, first_seen or created_at.';
comment on column public.publications.portal_published_at is 'Date explicitly declared by the source, not the start of a mandate.';

-- Receipt of each observation is distinct from a new content version. Reuses the existing immutable snapshot.
create table public.publication_observation_receipts (
  sync_run_id uuid not null references public.sync_runs(id) on delete restrict,
  publication_id uuid not null references public.publications(id) on delete restrict,
  snapshot_id uuid not null references public.snapshots(id) on delete restrict,
  observed_at timestamptz not null,
  changed boolean not null,
  primary key(sync_run_id,publication_id)
);
create index publication_receipts_latest on public.publication_observation_receipts(publication_id,observed_at desc);
alter table public.publication_observation_receipts enable row level security;
grant select on public.publication_observation_receipts to authenticated;
grant select,insert on public.publication_observation_receipts to service_role;
create policy "authenticated read observation receipts" on public.publication_observation_receipts for select to authenticated using(true);
insert into public.publication_observation_receipts(sync_run_id,publication_id,snapshot_id,observed_at,changed)
  select sync_run_id,publication_id,id,observed_at,true from public.snapshots on conflict do nothing;

-- Only explicit publication claims qualify. Media dates, HTTP headers and technical timestamps do not.
update public.publications p set portal_published_at=dates.value
from (select publication_id,min(source_recorded_at) value from public.evidence
  where claim_key in ('publication.datePublished','publication.publishUp','publication.articlePublishedDate')
    and source_recorded_at is not null group by publication_id) dates
where p.id=dates.publication_id and p.portal_published_at is null;

create or replace function public.persist_property_lifecycle_observation_atomic(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_listing jsonb,
  p_identity_decision jsonb,
  p_processed_assets jsonb,
  p_location_normalized_key text,
  p_building jsonb default null,
  p_media_market_start jsonb default null,
  p_failure_point text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_key text := p_listing #>> '{source,sourceKey}';
  v_observed_at timestamptz := (p_listing->>'observedAt')::timestamptz;
  v_status text := p_listing #>> '{status,value}';
  v_location_id uuid;
  v_building_id uuid;
  v_property_id uuid;
  v_agency_listing_id uuid;
  v_publication_id uuid;
  v_snapshot_id uuid;
  v_existing_publication record;
  v_existing_property record;
  v_existing_agency_listing record;
  v_previous_snapshot record;
  v_created_property boolean := false;
  v_created_publication boolean := false;
  v_prior_publication_ids uuid[] := '{}'::uuid[];
  v_evidence_ids uuid[] := '{}'::uuid[];
  v_claim jsonb;
  v_asset jsonb;
  v_processed jsonb;
  v_evidence_id uuid;
  v_event_id uuid;
  v_initial_state text;
  v_next_agency_state text;
  v_other_active_count integer;
  v_manual_sale_status text;
  v_sale_status text;
  v_sale_conflict boolean := false;
  v_sold_graphic boolean := false;
  v_identity_outcome text := p_identity_decision->>'outcome';
  v_identity_score numeric := coalesce((p_identity_decision->>'score')::numeric, 0);
  v_candidate jsonb;
  v_candidate_property_id uuid;
  v_candidate_count integer := 0;
  v_photo_urls_before text[];
  v_photo_urls_after text[];
  v_plan_urls_before text[];
  v_plan_urls_after text[];
  v_image_hashes_before text[];
  v_image_hashes_after text[];
  v_plan_hashes_before text[];
  v_plan_hashes_after text[];
  v_changed boolean;
  v_price_before integer;
  v_price_after integer := nullif(p_listing #>> '{commercial,priceAmount}', '')::integer;
  v_media_anchor timestamptz;
  v_current_anchor timestamptz;
  v_manual_state text;
  v_other record;
begin
  if nullif(v_source_key, '') is null then
    raise exception 'Observation source key is required';
  end if;
  if not exists (
    select 1 from public.sync_runs
    where id = p_sync_run_id and agency_id = p_agency_id and status = 'RUNNING'
  ) then
    raise exception 'Running sync % does not belong to agency %', p_sync_run_id, p_agency_id;
  end if;

  -- Keep existing primary keys, namespace supplemental source IDs to prevent cross-portal collisions.
  if lower(regexp_replace(substring(p_listing #>> '{source,canonicalUrl}' from '^https?://([^/]+)'),'^www\.','')) <>
    (select lower(regexp_replace(substring(inventory_url from '^https?://([^/]+)'),'^www\.','')) from public.agencies where id=p_agency_id)
    and v_source_key not like lower(regexp_replace(substring(p_listing #>> '{source,canonicalUrl}' from '^https?://([^/]+)'),'^www\.',''))||':%' then
    v_source_key:=lower(regexp_replace(substring(p_listing #>> '{source,canonicalUrl}' from '^https?://([^/]+)'),'^www\.',''))||':'||v_source_key;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_agency_id::text || ':' || v_source_key, 0));

  select p.*, al.property_id
  into v_existing_publication
  from public.publications p
  join public.agency_listings al on al.id = p.agency_listing_id
  where p.agency_id = p_agency_id and p.source_key = v_source_key
  for update of p, al;

  if v_existing_publication.id is not null then
    select s.id into v_snapshot_id
    from public.snapshots s
    join public.publication_observation_receipts r on r.snapshot_id = s.id
    where r.sync_run_id = p_sync_run_id
      and r.publication_id = v_existing_publication.id;
    if v_snapshot_id is not null then
      return jsonb_build_object(
        'propertyId', v_existing_publication.property_id,
        'agencyListingId', v_existing_publication.agency_listing_id,
        'publicationId', v_existing_publication.id,
        'snapshotId', v_snapshot_id,
        'createdProperty', false,
        'createdPublication', false,
        'replayed', true
      );
    end if;
  end if;

  -- Versions are immutable. A positive unchanged observation only advances presence.
  if v_existing_publication.id is not null and p_failure_point is null then
    select * into v_previous_snapshot from public.snapshots
      where publication_id = v_existing_publication.id order by observed_at desc, id desc limit 1;
    if v_previous_snapshot.content_hash = p_listing->>'contentHash'
      and (v_existing_publication.state in ('ACTIVE','SOLD_MARKED') or
        (v_existing_publication.state='REMOVED' and v_status='REMOVED'))
      and not exists(select 1 from jsonb_array_elements(coalesce(p_processed_assets,'[]'::jsonb)) asset
        where asset->>'classification'<>'SOLD_GRAPHIC' and not exists(
          select 1 from public.image_fingerprints f where f.snapshot_id=v_previous_snapshot.id
            and f.canonical_url=asset->>'canonicalUrl' and f.algorithm='SHA256' and f.fingerprint=asset->>'sha256'
          union all select 1 from public.floorplan_fingerprints f where f.snapshot_id=v_previous_snapshot.id
            and f.canonical_url=asset->>'canonicalUrl' and f.algorithm='SHA256' and f.fingerprint=asset->>'sha256'))
      and (p_media_market_start is null or exists(select 1 from public.evidence e
        where e.publication_id=v_existing_publication.id and e.extraction_method=p_media_market_start->>'method'
          and e.source_recorded_at=(p_media_market_start->>'sourceRecordedAt')::timestamptz)) then
      update public.publications set last_seen_at = greatest(last_seen_at,v_observed_at)
        where id = v_existing_publication.id;
      update public.agency_listings set last_seen_at = greatest(last_seen_at,v_observed_at)
        where id = v_existing_publication.agency_listing_id;
      update public.properties set last_seen_at = greatest(last_seen_at,v_observed_at)
        where id = v_existing_publication.property_id;
      insert into public.publication_observation_receipts(sync_run_id,publication_id,snapshot_id,observed_at,changed)
        values(p_sync_run_id,v_existing_publication.id,v_previous_snapshot.id,v_observed_at,false);
      update public.sync_runs set observation_commit_count = observation_commit_count + 1 where id=p_sync_run_id;
      perform public.refresh_property_lifecycle_intelligence_atomic(v_existing_publication.property_id,v_observed_at);
      return jsonb_build_object('propertyId',v_existing_publication.property_id,
        'agencyListingId',v_existing_publication.agency_listing_id,'publicationId',v_existing_publication.id,
        'snapshotId',v_previous_snapshot.id,'createdProperty',false,'createdPublication',false,'changed',false);
    end if;
  end if;

  insert into public.locations (
    raw_text, municipality, locality, postal_code, street_name, street_number,
    latitude, longitude, scope_state, resolution_method, resolution_confidence,
    precision_level, evidence_source, normalized_key, metadata
  ) values (
    p_listing #>> '{location,rawText}',
    p_listing #>> '{location,municipality}',
    p_listing #>> '{location,locality}',
    p_listing #>> '{location,postalCode}',
    p_listing #>> '{location,streetName}',
    p_listing #>> '{location,streetNumber}',
    nullif(p_listing #>> '{location,latitude}', '')::double precision,
    nullif(p_listing #>> '{location,longitude}', '')::double precision,
    p_listing #>> '{location,scope}',
    p_listing #>> '{location,resolutionMethod}',
    (p_listing #>> '{location,resolutionConfidence}')::numeric,
    p_listing #>> '{location,precision}',
    p_listing->>'adapterKey',
    p_location_normalized_key,
    jsonb_build_object('reasons', coalesce(p_listing #> '{location,reasons}', '[]'::jsonb))
  )
  on conflict (normalized_key) do update set
    raw_text = excluded.raw_text,
    municipality = excluded.municipality,
    locality = excluded.locality,
    postal_code = excluded.postal_code,
    street_name = excluded.street_name,
    street_number = excluded.street_number,
    latitude = case when locations.manually_verified then locations.latitude else excluded.latitude end,
    longitude = case when locations.manually_verified then locations.longitude else excluded.longitude end,
    scope_state = case when locations.manually_verified then locations.scope_state else excluded.scope_state end,
    resolution_method = case when locations.manually_verified then locations.resolution_method else excluded.resolution_method end,
    resolution_confidence = case when locations.manually_verified then locations.resolution_confidence else excluded.resolution_confidence end,
    precision_level = case when locations.manually_verified then locations.precision_level else excluded.precision_level end,
    evidence_source = excluded.evidence_source,
    metadata = excluded.metadata
  returning id into v_location_id;

  if p_building is not null then
    insert into public.buildings (
      location_id, normalized_key, display_name, attributes, first_seen_at, last_seen_at
    ) values (
      v_location_id,
      p_building->>'normalizedKey',
      p_building->>'displayName',
      jsonb_build_object(
        'municipality', p_building->>'municipality',
        'locality', p_building->>'locality',
        'streetName', p_building->>'streetName',
        'streetNumber', p_building->>'streetNumber'
      ),
      v_observed_at,
      v_observed_at
    )
    on conflict (normalized_key) do update set
      location_id = excluded.location_id,
      display_name = excluded.display_name,
      attributes = buildings.attributes || excluded.attributes,
      last_seen_at = excluded.last_seen_at
    returning id into v_building_id;
  end if;

  if v_existing_publication.id is not null then
    v_property_id := v_existing_publication.property_id;
    v_agency_listing_id := v_existing_publication.agency_listing_id;
    v_identity_outcome := 'AUTO_MATCH';
    v_identity_score := 1;
  elsif v_identity_outcome = 'AUTO_MATCH' and nullif(p_identity_decision->>'propertyId', '') is not null then
    v_property_id := (p_identity_decision->>'propertyId')::uuid;
    if not exists (select 1 from public.properties where id = v_property_id and identity_status <> 'MERGED') then
      raise exception 'Identity target % is not an active property', v_property_id;
    end if;
  else
    insert into public.properties (
      primary_location_id, building_id, property_type, identity_status,
      true_market_start_lower_bound, true_market_start_upper_bound,
      true_market_start_method, true_market_start_confidence,
      first_public_evidence_at, first_seen_at, last_seen_at, canonical_attributes
    ) values (
      v_location_id,
      v_building_id,
      p_listing #>> '{commercial,propertyType}',
      case when v_identity_outcome = 'REVIEW_REQUIRED' then 'REVIEW' else 'PROVISIONAL' end,
      nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
      nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
      p_listing #>> '{marketStart,method}',
      (p_listing #>> '{marketStart,confidence}')::numeric,
      coalesce(
        nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
        nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
        v_observed_at
      ),
      v_observed_at,
      v_observed_at,
      jsonb_build_object(
        'address', coalesce(
          nullif(trim(concat_ws(' ', p_listing #>> '{location,streetName}', p_listing #>> '{location,streetNumber}')), ''),
          p_listing #>> '{location,rawText}'
        ),
        'locality', p_listing #>> '{location,locality}',
        'surfaceSqm', p_listing #> '{commercial,surfaceSqm}',
        'rooms', p_listing #> '{commercial,rooms}',
        'floor', p_listing #> '{commercial,floor}',
        'priceAmount', p_listing #> '{commercial,priceAmount}',
        'propertyType', p_listing #> '{commercial,propertyType}',
        'description', p_listing #> '{commercial,description}',
        'latitude', p_listing #> '{location,latitude}',
        'longitude', p_listing #> '{location,longitude}',
        'coordinatePrecision', p_listing #> '{location,precision}'
      )
    ) returning id into v_property_id;
    v_created_property := true;
  end if;

  select * into strict v_existing_property
  from public.properties where id = v_property_id for update;

  v_current_anchor := coalesce(
    v_existing_property.true_market_start_lower_bound,
    v_existing_property.true_market_start_upper_bound,
    'infinity'::timestamptz
  );
  if coalesce(
    nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
    nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
    'infinity'::timestamptz
  ) < v_current_anchor then
    update public.properties set
      true_market_start_lower_bound = nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
      true_market_start_upper_bound = nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
      true_market_start_method = p_listing #>> '{marketStart,method}',
      true_market_start_confidence = (p_listing #>> '{marketStart,confidence}')::numeric
    where id = v_property_id;
  end if;

  update public.properties property set
    primary_location_id = case
      when property.primary_location_id is null then v_location_id
      when property.primary_location_id = v_location_id then v_location_id
      when exists(select 1 from public.locations where id = property.primary_location_id and manually_verified) then property.primary_location_id
      when (
        select case precision_level
          when 'EXACT_ADDRESS' then 4 when 'EXACT_COORDINATES' then 3
          when 'STREET_ONLY' then 2 when 'APPROXIMATE_AREA' then 1 else 0 end
        from public.locations where id = v_location_id
      ) > (
        select case precision_level
          when 'EXACT_ADDRESS' then 4 when 'EXACT_COORDINATES' then 3
          when 'STREET_ONLY' then 2 when 'APPROXIMATE_AREA' then 1 else 0 end
        from public.locations where id = property.primary_location_id
      ) then v_location_id
      else property.primary_location_id
    end,
    building_id = coalesce(property.building_id, v_building_id),
    property_type = coalesce(property.property_type, p_listing #>> '{commercial,propertyType}'),
    first_public_evidence_at = least(
      coalesce(property.first_public_evidence_at, 'infinity'::timestamptz),
      coalesce(
        nullif(p_listing #>> '{marketStart,lowerBound}', '')::timestamptz,
        nullif(p_listing #>> '{marketStart,upperBound}', '')::timestamptz,
        v_observed_at
      )
    ),
    last_seen_at = greatest(property.last_seen_at, v_observed_at),
    canonical_attributes = property.canonical_attributes || jsonb_build_object(
      'address', coalesce(
        property.canonical_attributes->'address',
        to_jsonb(coalesce(
          nullif(trim(concat_ws(' ', p_listing #>> '{location,streetName}', p_listing #>> '{location,streetNumber}')), ''),
          p_listing #>> '{location,rawText}'
        ))
      ),
      'locality', coalesce(property.canonical_attributes->'locality', p_listing #> '{location,locality}'),
      'surfaceSqm', p_listing #> '{commercial,surfaceSqm}',
      'rooms', p_listing #> '{commercial,rooms}',
      'floor', p_listing #> '{commercial,floor}',
      'priceAmount', p_listing #> '{commercial,priceAmount}',
      'propertyType', p_listing #> '{commercial,propertyType}',
        'description', p_listing #> '{commercial,description}',
        'latitude', p_listing #> '{location,latitude}',
        'longitude', p_listing #> '{location,longitude}',
        'coordinatePrecision', p_listing #> '{location,precision}'
    )
  where property.id = v_property_id;

  if v_agency_listing_id is null then
    select * into v_existing_agency_listing
    from public.agency_listings
    where agency_id = p_agency_id and property_id = v_property_id
    for update;
    if v_existing_agency_listing.id is null then
      insert into public.agency_listings (
        agency_id, property_id, agency_reference, first_seen_at, last_seen_at
      ) values (
        p_agency_id, v_property_id, p_listing #>> '{source,agencyReference}',
        v_observed_at, v_observed_at
      ) returning id into v_agency_listing_id;
    else
      v_agency_listing_id := v_existing_agency_listing.id;
      update public.agency_listings set
        agency_reference = coalesce(p_listing #>> '{source,agencyReference}', agency_reference),
        last_seen_at = greatest(last_seen_at, v_observed_at)
      where id = v_agency_listing_id;
    end if;
  end if;

  if v_existing_publication.id is null then
    select coalesce(array_agg(id order by first_seen_at), '{}'::uuid[])
    into v_prior_publication_ids
    from public.publications where agency_listing_id = v_agency_listing_id;

    v_initial_state := case when v_status = 'SOLD' then 'SOLD_MARKED'
      when v_status='REMOVED' and (p_listing #>> '{status,confidence}')::numeric>=0.85 then 'REMOVED' else 'ACTIVE' end;
    insert into public.publications (
      agency_id, agency_listing_id, source_key, external_id, canonical_url,
      transaction_type, state, source_status, first_seen_at, last_seen_at
    ) values (
      p_agency_id, v_agency_listing_id, v_source_key,
      p_listing #>> '{source,externalId}', p_listing #>> '{source,canonicalUrl}',
      p_listing #>> '{source,transactionType}', v_initial_state, v_status,
      v_observed_at, v_observed_at
    ) returning id into v_publication_id;
    v_created_publication := true;
  else
    v_publication_id := v_existing_publication.id;
    update public.publications set
      external_id = p_listing #>> '{source,externalId}',
      canonical_url = p_listing #>> '{source,canonicalUrl}',
      state = case when v_status = 'SOLD' then 'SOLD_MARKED'
        when v_status='REMOVED' and (p_listing #>> '{status,confidence}')::numeric>=0.85 then 'REMOVED' else 'ACTIVE' end,
      source_status = v_status,
      missing_healthy_run_count = 0,
      missing_since = null,
      removed_at = case when v_status='REMOVED' and (p_listing #>> '{status,confidence}')::numeric>=0.85
        then coalesce(removed_at,v_observed_at) when v_status = 'SOLD' then removed_at else null end,
      last_seen_at = greatest(last_seen_at, v_observed_at)
    where id = v_publication_id;
  end if;

  if p_failure_point = 'AFTER_PUBLICATION' then
    raise exception 'Injected observation failure AFTER_PUBLICATION';
  end if;

  if v_created_publication then
    for v_candidate in
      select value from jsonb_array_elements(coalesce(p_identity_decision->'candidates', '[]'::jsonb))
      where (value->>'rank')::integer <= 10
    loop
      v_candidate_property_id := (v_candidate->>'propertyId')::uuid;
      if exists(select 1 from public.properties where id = v_candidate_property_id) then
        insert into public.property_match_candidates (
          publication_id, candidate_property_id, evaluation_version, candidate_rank,
          score, outcome, feature_scores, contradictions
        ) values (
          v_publication_id, v_candidate_property_id, 1,
          (v_candidate->>'rank')::integer,
          (v_candidate->>'score')::numeric,
          case when v_identity_outcome = 'AUTO_MATCH' and (v_candidate->>'rank')::integer = 1
            then 'AUTO_MATCH' else v_identity_outcome end,
          coalesce(v_candidate->'features', '{}'::jsonb),
          coalesce(v_candidate->'contradictions', '[]'::jsonb)
        ) on conflict (publication_id, candidate_property_id, evaluation_version)
        do update set
          candidate_rank = excluded.candidate_rank,
          score = excluded.score,
          outcome = excluded.outcome,
          feature_scores = excluded.feature_scores,
          contradictions = excluded.contradictions;
        v_candidate_count := v_candidate_count + 1;
      end if;
    end loop;

    if v_identity_outcome = 'REVIEW_REQUIRED' then
      insert into public.review_queue (
        review_type, status, property_id, publication_id, title, details, dedupe_key
      ) values (
        'IDENTITY', 'OPEN', v_property_id, v_publication_id,
        'Ambiguous property identity',
        jsonb_build_object(
          'score', v_identity_score,
          'margin', coalesce((p_identity_decision->>'margin')::numeric, 0),
          'candidates', coalesce(p_identity_decision->'candidates', '[]'::jsonb)
        ),
        'identity:' || v_publication_id || ':v1'
      ) on conflict (dedupe_key) do update set
        status = 'OPEN', details = excluded.details, updated_at = now();
    end if;
  end if;

  select id, price_amount, content_hash, normalized_payload
  into v_previous_snapshot
  from public.snapshots
  where publication_id = v_publication_id
  order by observed_at desc
  limit 1;

  insert into public.snapshots (
    publication_id, sync_run_id, contract_version, observed_at, content_hash,
    normalized_payload, title, description, price_amount, price_currency,
    surface_sqm, rooms, source_status, availability, extraction_warnings
  ) values (
    v_publication_id, p_sync_run_id, (p_listing->>'contractVersion')::integer,
    v_observed_at, p_listing->>'contentHash', p_listing,
    p_listing #>> '{commercial,title}', p_listing #>> '{commercial,description}',
    v_price_after, p_listing #>> '{commercial,priceCurrency}',
    nullif(p_listing #>> '{commercial,surfaceSqm}', '')::numeric,
    nullif(p_listing #>> '{commercial,rooms}', '')::numeric,
    v_status, v_status not in ('SOLD', 'REMOVED'),
    coalesce(p_listing->'extractionWarnings', '[]'::jsonb)
  ) returning id into v_snapshot_id;

  for v_claim in
    select value from jsonb_array_elements(
      coalesce(p_listing #> '{status,evidence}', '[]'::jsonb)
      || coalesce(p_listing #> '{marketStart,evidence}', '[]'::jsonb)
      || case when v_price_after is not null then jsonb_build_array(jsonb_build_object(
        'kind','PRICE','claimKey','publication.askingPrice',
        'sourceUrl',p_listing #>> '{source,canonicalUrl}','extractionMethod','SOURCE_PRICE_FIELD_V1',
        'rawValue',v_price_after::text,'normalizedValue',jsonb_build_object('amount',v_price_after,'currency',p_listing #>> '{commercial,priceCurrency}'),
        'confidence',1,'observedAt',v_observed_at,'sourceRecordedAt',null,
        'metadata',jsonb_build_object('externalId',p_listing #>> '{source,externalId}')
      )) else '[]'::jsonb end
      || (select coalesce(jsonb_agg(jsonb_build_object(
        'kind','SALE_MARK','claimKey','publication.soldGraphic','sourceUrl',p_listing #>> '{source,canonicalUrl}',
        'extractionMethod','DEDICATED_SOLD_GRAPHIC_V1','rawValue',asset->>'canonicalUrl',
        'normalizedValue',jsonb_build_object('assetUrl',asset->>'canonicalUrl'),
        'confidence',0.9,'observedAt',v_observed_at,'sourceRecordedAt',null,'metadata','{}'::jsonb
      )),'[]'::jsonb) from jsonb_array_elements(coalesce(p_listing->'assets','[]'::jsonb)) asset
        where asset->>'canonicalUrl' ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)')
      || jsonb_build_array(jsonb_build_object(
        'kind', 'LOCATION',
        'claimKey', 'publication.location',
        'sourceUrl', p_listing #>> '{source,canonicalUrl}',
        'extractionMethod', p_listing #>> '{location,resolutionMethod}',
        'rawValue', p_listing #> '{location,rawText}',
        'normalizedValue', jsonb_build_object(
          'municipality', p_listing #> '{location,municipality}',
          'locality', p_listing #> '{location,locality}',
          'postalCode', p_listing #> '{location,postalCode}',
          'streetName', p_listing #> '{location,streetName}',
          'precision', p_listing #> '{location,precision}',
          'scope', p_listing #> '{location,scope}'
        ),
        'confidence', p_listing #> '{location,resolutionConfidence}',
        'observedAt', p_listing->'observedAt',
        'sourceRecordedAt', null,
        'metadata', jsonb_build_object('reasons', p_listing #> '{location,reasons}')
      ))
    )
  loop
    insert into public.evidence (
      property_id, publication_id, snapshot_id, sync_run_id, evidence_kind,
      source_url, extraction_method, claim_key, raw_value, normalized_value,
      confidence, observed_at, source_recorded_at, evidence_hash, metadata
    ) values (
      v_property_id, v_publication_id, v_snapshot_id, p_sync_run_id,
      v_claim->>'kind', v_claim->>'sourceUrl', v_claim->>'extractionMethod',
      v_claim->>'claimKey', v_claim->>'rawValue', v_claim->'normalizedValue',
      (v_claim->>'confidence')::numeric,
      coalesce(nullif(v_claim->>'observedAt', '')::timestamptz, v_observed_at),
      nullif(v_claim->>'sourceRecordedAt', '')::timestamptz,
      encode(extensions.digest((v_claim - 'observedAt')::text, 'sha256'), 'hex'),
      coalesce(v_claim->'metadata', '{}'::jsonb)
    ) returning id into v_evidence_id;
    v_evidence_ids := array_append(v_evidence_ids, v_evidence_id);
  end loop;

  if p_media_market_start is not null then
    insert into public.evidence (
      property_id, publication_id, snapshot_id, sync_run_id, evidence_kind,
      source_url, extraction_method, claim_key, raw_value, normalized_value,
      confidence, observed_at, source_recorded_at, evidence_hash, metadata
    ) values (
      v_property_id, v_publication_id, v_snapshot_id, p_sync_run_id,
      'MARKET_START_BOUND', p_media_market_start->>'sourceUrl',
      p_media_market_start->>'method', p_media_market_start->>'claimKey',
      p_media_market_start->>'rawValue', p_media_market_start->'normalizedValue',
      (p_media_market_start->>'confidence')::numeric, v_observed_at,
      (p_media_market_start->>'sourceRecordedAt')::timestamptz,
      encode(extensions.digest((p_media_market_start - 'observedAt')::text, 'sha256'), 'hex'),
      coalesce(p_media_market_start->'metadata', '{}'::jsonb)
    ) returning id into v_evidence_id;
    v_evidence_ids := array_append(v_evidence_ids, v_evidence_id);
    v_media_anchor := (p_media_market_start->>'sourceRecordedAt')::timestamptz;
    select coalesce(true_market_start_lower_bound, true_market_start_upper_bound, 'infinity'::timestamptz)
      into v_current_anchor from public.properties where id = v_property_id;
    if v_media_anchor < v_current_anchor then
      update public.properties set
        true_market_start_lower_bound = null,
        true_market_start_upper_bound = v_media_anchor,
        true_market_start_method = p_media_market_start->>'method',
        true_market_start_confidence = (p_media_market_start->>'confidence')::numeric,
        first_public_evidence_at = least(coalesce(first_public_evidence_at, v_media_anchor), v_media_anchor)
      where id = v_property_id;
    end if;
  end if;

  if p_failure_point = 'AFTER_SNAPSHOT' then
    raise exception 'Injected observation failure AFTER_SNAPSHOT';
  end if;

  for v_asset in
    select value from jsonb_array_elements(coalesce(p_listing->'assets', '[]'::jsonb))
  loop
    select value into v_processed
    from jsonb_array_elements(coalesce(p_processed_assets, '[]'::jsonb))
    where value->>'canonicalUrl' = v_asset->>'canonicalUrl'
    limit 1;
    v_sold_graphic := v_sold_graphic
      or coalesce(v_processed->>'classification', '') = 'SOLD_GRAPHIC'
      or (v_asset->>'canonicalUrl') ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)';

    if coalesce(v_processed->>'classification', v_asset->>'kind') = 'FLOORPLAN' then
      insert into public.floorplan_fingerprints (
        property_id, publication_id, snapshot_id, canonical_url, algorithm,
        fingerprint, width, height, source_recorded_at, metadata
      )
      select v_property_id, v_publication_id, v_snapshot_id,
        v_asset->>'canonicalUrl', algorithm, fingerprint,
        nullif(v_processed->>'width', '')::integer,
        nullif(v_processed->>'height', '')::integer,
        nullif(coalesce(v_processed->>'sourceRecordedAt', v_asset->>'sourceRecordedAt'), '')::timestamptz,
        coalesce(v_asset->'metadata', '{}'::jsonb) || jsonb_build_object(
          'classification', coalesce(v_processed->>'classification', v_asset->>'kind'),
          'format', v_processed->'format', 'contentType', v_processed->'contentType',
          'etag', v_processed->'etag', 'lastModified', v_processed->'lastModified',
          'exif', v_processed->'exif'
        )
      from (values
        (case when v_processed is null then 'SOURCE_URL_SHA256' else 'SHA256' end,
         case when v_processed is null then encode(extensions.digest(v_asset->>'canonicalUrl', 'sha256'), 'hex') else v_processed->>'sha256' end),
        ('DHASH64', case when v_processed is null then null else v_processed->>'perceptualHash' end)
      ) valueset(algorithm, fingerprint)
      where fingerprint is not null;
    elsif coalesce(v_processed->>'classification', 'IMAGE') <> 'SOLD_GRAPHIC' then
      insert into public.image_fingerprints (
        property_id, publication_id, snapshot_id, canonical_url, algorithm,
        fingerprint, width, height, source_recorded_at, metadata
      )
      select v_property_id, v_publication_id, v_snapshot_id,
        v_asset->>'canonicalUrl', algorithm, fingerprint,
        nullif(v_processed->>'width', '')::integer,
        nullif(v_processed->>'height', '')::integer,
        nullif(coalesce(v_processed->>'sourceRecordedAt', v_asset->>'sourceRecordedAt'), '')::timestamptz,
        coalesce(v_asset->'metadata', '{}'::jsonb) || jsonb_build_object(
          'classification', coalesce(v_processed->>'classification', 'IMAGE'),
          'format', v_processed->'format', 'contentType', v_processed->'contentType',
          'etag', v_processed->'etag', 'lastModified', v_processed->'lastModified',
          'exif', v_processed->'exif'
        )
      from (values
        (case when v_processed is null then 'SOURCE_URL_SHA256' else 'SHA256' end,
         case when v_processed is null then encode(extensions.digest(v_asset->>'canonicalUrl', 'sha256'), 'hex') else v_processed->>'sha256' end),
        ('DHASH64', case when v_processed is null then null else v_processed->>'perceptualHash' end)
      ) valueset(algorithm, fingerprint)
      where fingerprint is not null;
    end if;
    v_processed := null;
  end loop;

  if p_failure_point = 'DURING_EVENT_GENERATION' then
    raise exception 'Injected observation failure DURING_EVENT_GENERATION';
  end if;

  if v_existing_publication.id is not null then
    if v_existing_publication.state in ('MISSING_PENDING', 'REMOVED') and v_status <> 'SOLD' then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_REAPPEARED', v_observed_at,
        v_publication_id || ':PUBLICATION_REAPPEARED:' || p_sync_run_id,
        1, 'SYSTEM', jsonb_build_object('sourceStatus', v_status), v_evidence_ids
      );
    end if;
    if v_status <> v_existing_publication.source_status and v_status <> 'UNKNOWN' then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'SOURCE_STATUS_CHANGED', v_observed_at,
        v_publication_id || ':SOURCE_STATUS_CHANGED:' || p_sync_run_id,
        1, 'SYSTEM', jsonb_build_object('sourceStatus', v_status), v_evidence_ids
      );
    end if;
  end if;

  if v_previous_snapshot.id is not null then
    v_price_before := v_previous_snapshot.price_amount;
    if nullif(v_previous_snapshot.normalized_payload #>> '{source,portalModifiedAt}','') is not null
      and nullif(p_listing #>> '{source,portalModifiedAt}','')::timestamptz >
        (v_previous_snapshot.normalized_payload #>> '{source,portalModifiedAt}')::timestamptz then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id,v_agency_listing_id,v_publication_id,p_sync_run_id,'PUBLICATION_REFRESHED',v_observed_at,
        v_publication_id||':REFRESH:'||p_sync_run_id,1,'SYSTEM',
        jsonb_build_object('sourceModifiedAt',p_listing #>> '{source,portalModifiedAt}',
          'previousSourceModifiedAt',v_previous_snapshot.normalized_payload #>> '{source,portalModifiedAt}'),v_evidence_ids);
    end if;
    if v_previous_snapshot.content_hash <> (p_listing->>'contentHash') then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_CONTENT_CHANGED', v_observed_at,
        v_publication_id || ':PUBLICATION_CONTENT_CHANGED:' || v_previous_snapshot.id || ':' || (p_listing->>'contentHash'),
        1, 'SYSTEM', jsonb_build_object('previousSnapshotId', v_previous_snapshot.id, 'snapshotId', v_snapshot_id), v_evidence_ids
      );
    end if;
    if v_price_before is distinct from v_price_after and v_price_before is not null and v_price_after is not null then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        case when v_price_after < v_price_before then 'PRICE_DROP' else 'PRICE_INCREASE' end,
        v_observed_at,
        v_publication_id || ':' || case when v_price_after < v_price_before then 'PRICE_DROP' else 'PRICE_INCREASE' end || ':' || v_previous_snapshot.id || ':' || v_price_after,
        1, 'SYSTEM', jsonb_build_object(
          'oldPrice', v_price_before, 'newPrice', v_price_after,
          'absoluteDelta', abs(v_price_after - v_price_before),
          'percentageDelta', case when v_price_before>0 then round((abs(v_price_after - v_price_before)::numeric / v_price_before) * 100, 2) else null end,
          'currency', p_listing #>> '{commercial,priceCurrency}'
        ), v_evidence_ids
      );
    end if;

    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_photo_urls_before
      from jsonb_array_elements(coalesce(v_previous_snapshot.normalized_payload->'assets', '[]'::jsonb))
      where value->>'kind' = 'IMAGE';
    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_photo_urls_after
      from jsonb_array_elements(coalesce(p_listing->'assets', '[]'::jsonb))
      where value->>'kind' = 'IMAGE';
    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_plan_urls_before
      from jsonb_array_elements(coalesce(v_previous_snapshot.normalized_payload->'assets', '[]'::jsonb))
      where value->>'kind' = 'FLOORPLAN';
    select coalesce(array_agg(value->>'canonicalUrl' order by value->>'canonicalUrl'), '{}'::text[])
      into v_plan_urls_after
      from jsonb_array_elements(coalesce(p_listing->'assets', '[]'::jsonb))
      where value->>'kind' = 'FLOORPLAN';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_image_hashes_before from public.image_fingerprints
      where snapshot_id = v_previous_snapshot.id and algorithm = 'DHASH64';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_image_hashes_after from public.image_fingerprints
      where snapshot_id = v_snapshot_id and algorithm = 'DHASH64';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_plan_hashes_before from public.floorplan_fingerprints
      where snapshot_id = v_previous_snapshot.id and algorithm = 'DHASH64';
    select coalesce(array_agg(fingerprint order by fingerprint), '{}'::text[])
      into v_plan_hashes_after from public.floorplan_fingerprints
      where snapshot_id = v_snapshot_id and algorithm = 'DHASH64';

    v_changed := v_photo_urls_before <> v_photo_urls_after
      or (cardinality(v_image_hashes_before) > 0 and cardinality(v_image_hashes_after) > 0 and v_image_hashes_before <> v_image_hashes_after);
    if v_changed then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PHOTO_CHANGED', v_observed_at,
        v_publication_id || ':PHOTO_CHANGED:' || v_previous_snapshot.id || ':' || v_snapshot_id,
        1, 'SYSTEM', jsonb_build_object('previousSnapshotId', v_previous_snapshot.id, 'snapshotId', v_snapshot_id), v_evidence_ids
      );
    end if;
    v_changed := v_plan_urls_before <> v_plan_urls_after
      or (cardinality(v_plan_hashes_before) > 0 and cardinality(v_plan_hashes_after) > 0 and v_plan_hashes_before <> v_plan_hashes_after);
    if v_changed then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'FLOORPLAN_CHANGED', v_observed_at,
        v_publication_id || ':FLOORPLAN_CHANGED:' || v_previous_snapshot.id || ':' || v_snapshot_id,
        1, 'SYSTEM', jsonb_build_object('previousSnapshotId', v_previous_snapshot.id, 'snapshotId', v_snapshot_id), v_evidence_ids
      );
    end if;
  end if;

  if v_created_property then
    perform public.insert_property_lifecycle_event_atomic(
      v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
      'PROPERTY_DISCOVERED', v_observed_at, v_property_id || ':PROPERTY_DISCOVERED',
      1, 'SYSTEM', jsonb_build_object('identityOutcome', v_identity_outcome), v_evidence_ids
    );
  end if;
  if v_created_publication then
    perform public.insert_property_lifecycle_event_atomic(
      v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
      'PUBLICATION_DISCOVERED', v_observed_at, v_publication_id || ':PUBLICATION_DISCOVERED',
      1, 'SYSTEM', jsonb_build_object('sourceKey', v_source_key), v_evidence_ids
    );
    if cardinality(v_prior_publication_ids) > 0 and (
      not exists(select 1 from public.publications where id=any(v_prior_publication_ids) and state in ('ACTIVE','MISSING_PENDING'))
      or exists(select 1 from public.publications where id=any(v_prior_publication_ids)
        and lower(substring(canonical_url from '^https?://([^/]+)')) =
            lower(substring(p_listing #>> '{source,canonicalUrl}' from '^https?://([^/]+)')))
    ) then
      v_event_id := public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_RELAUNCHED', v_observed_at, v_publication_id || ':PUBLICATION_RELAUNCHED',
        1, 'SYSTEM', jsonb_build_object('priorPublicationIds', v_prior_publication_ids), v_evidence_ids
      );
      if v_event_id is not null then
        update public.properties set relaunch_count = relaunch_count + 1 where id = v_property_id;
      end if;
    end if;
  end if;
  if v_status = 'SOLD' and (v_created_publication or coalesce(v_existing_publication.source_status, '') <> 'SOLD') then
    perform public.insert_property_lifecycle_event_atomic(
      v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
      'SOURCE_MARKED_SOLD', v_observed_at,
      v_publication_id || ':SOURCE_MARKED_SOLD:' || p_sync_run_id,
      (p_listing #>> '{status,confidence}')::numeric, 'ADAPTER', '{}'::jsonb, v_evidence_ids
    );
  end if;
  if v_status='REMOVED' and (p_listing #>> '{status,confidence}')::numeric>=0.85 then
    update public.publications set removed_at=coalesce(removed_at,v_observed_at) where id=v_publication_id;
    if v_created_publication or v_existing_publication.state<>'REMOVED' then
      perform public.insert_property_lifecycle_event_atomic(v_property_id,v_agency_listing_id,v_publication_id,p_sync_run_id,
        'PUBLICATION_REMOVED',v_observed_at,v_publication_id||':EXPLICIT_REMOVAL:'||p_sync_run_id,
        (p_listing #>> '{status,confidence}')::numeric,'SYSTEM',jsonb_build_object('explicitSourceRemoval',true),v_evidence_ids);
    end if;
  end if;

  if p_failure_point = 'DURING_LIFECYCLE_UPDATE' then
    raise exception 'Injected observation failure DURING_LIFECYCLE_UPDATE';
  end if;

  select count(*) into v_other_active_count
  from public.publications
  where agency_listing_id = v_agency_listing_id
    and id <> v_publication_id
    and state in ('ACTIVE', 'MISSING_PENDING');
  select * into v_existing_agency_listing from public.agency_listings where id = v_agency_listing_id for update;
  select mo.override_value #>> '{}' into v_manual_state from public.manual_overrides mo
    where mo.target_type='AGENCY_LISTING' and mo.target_id=v_agency_listing_id and mo.override_key='state'
      and mo.effective_at<=v_observed_at and not exists(select 1 from public.manual_overrides newer where newer.supersedes_id=mo.id)
    order by mo.effective_at desc,mo.created_at desc limit 1;
  v_next_agency_state := case
    when v_manual_state is not null then v_manual_state
    when v_status='REMOVED' and (p_listing #>> '{status,confidence}')::numeric>=0.85
      and v_other_active_count=0 and v_existing_agency_listing.state='ACTIVE' then 'EXIT_PENDING'
    when v_status = 'SOLD' and v_other_active_count = 0 then 'CLOSED_SOLD'
    when v_status <> 'SOLD' and v_existing_agency_listing.state in ('EXIT_PENDING','OFF_MARKET_NO_SALE_EVIDENCE','CLOSED_SWITCHED','CLOSED_TO_PRIVATE')
      and not exists(select 1 from public.manual_overrides mo where mo.target_type='AGENCY_LISTING'
        and mo.target_id=v_agency_listing_id and mo.override_key='state' and mo.effective_at<=v_observed_at
        and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)) then 'ACTIVE'
    else v_existing_agency_listing.state
  end;
  update public.agency_listings set
    state = v_next_agency_state,
    last_seen_at = greatest(last_seen_at, v_observed_at),
    closed_at = case when v_next_agency_state = 'CLOSED_SOLD' then v_observed_at else null end,
    state_confidence = (p_listing #>> '{status,confidence}')::numeric,
    state_reason = jsonb_build_object('sourceStatus', v_status),
    monitoring_phase = case when v_next_agency_state = 'ACTIVE' then 'NONE' else monitoring_phase end,
    post_exit_check_due_at = case when v_next_agency_state = 'ACTIVE' then null else post_exit_check_due_at end,
    next_check_at = case when v_next_agency_state = 'ACTIVE' then null else next_check_at end,
    check_attempt = case when v_next_agency_state = 'ACTIVE' then 0 else check_attempt end
  where id = v_agency_listing_id;

  if v_next_agency_state='EXIT_PENDING' and v_existing_agency_listing.state='ACTIVE' then
    update public.agency_listings set monitoring_phase='WAITING_CONFIRMATION',
      next_check_at=v_observed_at+interval '48 hours',post_exit_check_due_at=v_observed_at+interval '48 hours',check_attempt=0
      where id=v_agency_listing_id;
    insert into public.lifecycle_jobs(job_type,agency_id,payload,run_after,dedupe_key)
      values('POST_EXIT_CHECK',p_agency_id,jsonb_build_object('agencyListingId',v_agency_listing_id,'publicationId',v_publication_id),
        v_observed_at+interval '48 hours','POST_EXIT_EXPLICIT:'||v_publication_id||':'||p_sync_run_id) on conflict do nothing;
  end if;

  if v_created_publication and not v_created_property then
    for v_other in
      select * from public.agency_listings
      where property_id = v_property_id and agency_id <> p_agency_id
      for update
    loop
      select mo.override_value #>> '{}'
      into v_manual_state
      from public.manual_overrides mo
      where mo.target_type = 'AGENCY_LISTING'
        and mo.target_id = v_other.id
        and mo.override_key = 'state'
        and mo.effective_at <= v_observed_at
        and not exists(select 1 from public.manual_overrides superseding where superseding.supersedes_id = mo.id)
      order by mo.effective_at desc, mo.created_at desc
      limit 1;
      if v_other.state in ('EXIT_PENDING', 'OFF_MARKET_NO_SALE_EVIDENCE') and v_manual_state is null then
        update public.agency_listings set
          state = 'CLOSED_SWITCHED', closed_at = v_observed_at,
          exit_confirmed_at = v_observed_at, outcome_source = 'CROSS_AGENCY_IDENTITY_V1',
          outcome_confidence = v_identity_score, monitoring_phase = 'COMPLETE',
          post_exit_check_due_at = null, next_check_at = null
        where id = v_other.id;
        perform public.insert_property_lifecycle_event_atomic(
          v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
          'AGENCY_SWITCH_DETECTED', v_observed_at,
          v_publication_id || ':AGENCY_SWITCH_DETECTED:' || v_other.id,
          v_identity_score, 'SYSTEM', jsonb_build_object('previousAgencyListingIds', jsonb_build_array(v_other.id)), v_evidence_ids
        );
      elsif v_other.state = 'ACTIVE' then
        perform public.insert_property_lifecycle_event_atomic(
          v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
          'MULTI_AGENCY_PUBLICATION_OBSERVED', v_observed_at,
          v_publication_id || ':MULTI_AGENCY_PUBLICATION_OBSERVED:' || v_other.id,
          v_identity_score, 'SYSTEM', jsonb_build_object('otherAgencyListingIds', jsonb_build_array(v_other.id)), v_evidence_ids
        );
      end if;
      v_manual_state := null;
    end loop;
  end if;

  update public.publications set
    portal_published_at = coalesce(portal_published_at, nullif(p_listing #>> '{source,portalPublishedAt}','')::timestamptz),
    portal_modified_at = coalesce(nullif(p_listing #>> '{source,portalModifiedAt}','')::timestamptz, portal_modified_at)
    where id=v_publication_id;
  insert into public.publication_observation_receipts(sync_run_id,publication_id,snapshot_id,observed_at,changed)
    values(p_sync_run_id,v_publication_id,v_snapshot_id,v_observed_at,true);
  perform public.refresh_property_lifecycle_intelligence_atomic(v_property_id, v_observed_at);
  update public.sync_runs
  set observation_commit_count = observation_commit_count + 1
  where id = p_sync_run_id;

  return jsonb_build_object(
    'propertyId', v_property_id,
    'agencyListingId', v_agency_listing_id,
    'publicationId', v_publication_id,
    'snapshotId', v_snapshot_id,
    'createdProperty', v_created_property,
    'createdPublication', v_created_publication,
    'replayed', false,
    'candidateCount', v_candidate_count
  );
end;
$$;

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
  if p_missing_threshold < 2 then
    p_missing_threshold := 2;
  end if;
  if p_post_exit_delay_hours < 1 then
    raise exception 'Post-exit delay must be at least one hour';
  end if;
  if not exists (
    select 1 from public.sync_runs
    where id = p_sync_run_id and agency_id = p_agency_id and status = 'RUNNING'
  ) then
    raise exception 'Running sync % does not belong to agency %', p_sync_run_id, p_agency_id;
  end if;

  -- The database enforces the same guard as the caller, even for direct RPC calls.
  if not exists(select 1 from public.adapter_health h where h.sync_run_id=p_sync_run_id
    and h.agency_id=p_agency_id and h.state='HEALTHY'
    and h.diagnostics->>'sourceComplete'='true' and h.diagnostics->>'baselineReady'='true') then
    return jsonb_build_object('missingCount',0,'transitionedCount',0);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('missing:' || p_agency_id::text, 0));

  -- A verified catalog link is positive presence even when its detail failed.
  -- It resets absence, without pretending that price or other detail fields were read.
  for v_publication in
    select p.* from public.publications p where p.agency_id=p_agency_id
      and p.state in ('MISSING_PENDING','REMOVED') and p.source_status<>'REMOVED'
      and p.source_key=any(coalesce(p_observed_source_keys,'{}'::text[]))
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
    where p.agency_id = p_agency_id
      and p.state in ('ACTIVE', 'MISSING_PENDING')
      and lower(regexp_replace(substring(p.canonical_url from '^https?://([^/]+)'),'^www\.','')) =
        (select lower(regexp_replace(substring(inventory_url from '^https?://([^/]+)'),'^www\.','')) from public.agencies where id=p_agency_id)
      -- Inventory completeness is scoped to this source, never to all portals of the agency.

      and not (p.source_key = any(coalesce(p_observed_source_keys, '{}'::text[])))
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
          greatest(1,least(168,coalesce((select nullif(settings->>'missingGraceHours','')::integer
            from public.agencies where id=p_agency_id),24)))) then 'REMOVED'
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

create or replace function public.run_post_exit_check_atomic(
  p_job_id uuid,
  p_agency_listing_id uuid,
  p_publication_id uuid default null,
  p_checked_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_publication record;
  v_existing_outcome text;
  v_switched boolean;
  v_private boolean;
  v_manual_state text;
  v_explicit_sold boolean;
  v_reappeared boolean;
  v_due boolean;
  v_outcome text;
  v_state text;
  v_confidence numeric;
  v_next_check timestamptz;
begin
  select outcome into v_existing_outcome
  from public.post_exit_checks where job_id = p_job_id;
  if v_existing_outcome is not null then
    return v_existing_outcome;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('post-exit:' || p_agency_listing_id::text, 0));
  select * into strict v_listing
  from public.agency_listings
  where id = p_agency_listing_id
  for update;

  if p_publication_id is not null then
    select * into strict v_publication
    from public.publications
    where id = p_publication_id and agency_listing_id = p_agency_listing_id
    for update;
  else
    select * into strict v_publication
    from public.publications
    where agency_listing_id = p_agency_listing_id
    order by last_seen_at desc
    limit 1
    for update;
  end if;

  select exists(
    select 1 from public.agency_listings
    where property_id = v_listing.property_id
      and agency_id <> v_listing.agency_id
      and state = 'ACTIVE'
  ) into v_switched;
  select exists(
    select 1 from public.private_publications
    where property_id = v_listing.property_id and state = 'ACTIVE'
  ) into v_private;
  select mo.override_value #>> '{}'
  into v_manual_state
  from public.manual_overrides mo
  where mo.target_type = 'AGENCY_LISTING'
    and mo.target_id = p_agency_listing_id
    and mo.override_key = 'state'
    and mo.effective_at <= p_checked_at
    and not exists(select 1 from public.manual_overrides superseding where superseding.supersedes_id = mo.id)
  order by mo.effective_at desc, mo.created_at desc
  limit 1;

  v_explicit_sold := v_publication.state = 'SOLD_MARKED' or v_publication.source_status = 'SOLD';
  v_reappeared := exists(select 1 from public.publications
    where agency_listing_id=p_agency_listing_id and state in ('ACTIVE','MISSING_PENDING'));
  -- A stored absence growing older is not a new observation. Require a newer complete healthy scan.
  if v_manual_state is null and not v_reappeared and not v_explicit_sold and not v_switched and not v_private then
    if not exists(select 1 from public.sync_runs sr
      where sr.agency_id=v_listing.agency_id and sr.status='SUCCEEDED'
        and sr.health_state='HEALTHY' and sr.inventory_complete and sr.absence_evaluation_allowed
        and sr.finished_at >= v_listing.next_check_at
        and not exists(select 1 from public.sync_runs newer where newer.agency_id=sr.agency_id
          and newer.started_at>sr.started_at and (newer.status<>'SUCCEEDED' or newer.health_state<>'HEALTHY'))) then
      raise exception 'POST_EXIT_FRESH_HEALTHY_SCAN_REQUIRED';
    end if;
  end if;
  v_due := v_listing.next_check_at is not null and p_checked_at >= v_listing.next_check_at;

  if v_manual_state is not null and v_manual_state <> 'EXIT_PENDING' then
    v_state := v_manual_state;
    v_outcome := case when v_manual_state = 'ACTIVE' then 'REAPPEARED' else v_manual_state end;
    v_confidence := 1;
  elsif v_reappeared then
    v_state := 'ACTIVE'; v_outcome := 'REAPPEARED'; v_confidence := 1;
  elsif v_explicit_sold then
    v_state := 'CLOSED_SOLD'; v_outcome := 'CLOSED_SOLD'; v_confidence := 0.95;
  elsif v_switched then
    v_state := 'CLOSED_SWITCHED'; v_outcome := 'CLOSED_SWITCHED'; v_confidence := 0.95;
  elsif v_private then
    v_state := 'CLOSED_TO_PRIVATE'; v_outcome := 'CLOSED_TO_PRIVATE'; v_confidence := 0.95;
  elsif not v_due then
    v_state := 'EXIT_PENDING'; v_outcome := 'NEEDS_VERIFICATION'; v_confidence := 0.5;
  else
    v_state := 'OFF_MARKET_NO_SALE_EVIDENCE';
    v_outcome := 'OFF_MARKET_NO_SALE_EVIDENCE';
    v_confidence := 0.85;
  end if;

  insert into public.post_exit_checks (
    agency_listing_id, publication_id, job_id, checked_at,
    technical_disappearance_confirmed, explicit_sale_evidence,
    switched_agency_evidence, private_relist_evidence, reappearance_evidence,
    outcome, confidence, evidence_summary
  ) values (
    p_agency_listing_id, v_publication.id, p_job_id, p_checked_at,
    v_publication.state = 'REMOVED', v_explicit_sold, v_switched, v_private,
    v_reappeared, v_outcome, v_confidence,
    jsonb_build_object(
      'manualOutcome', v_manual_state,
      'dueAt', v_listing.next_check_at,
      'attempt', v_listing.check_attempt + 1
    )
  );

  if v_outcome = 'NEEDS_VERIFICATION' then
    v_next_check := coalesce(v_listing.next_check_at, p_checked_at + interval '48 hours');
    update public.agency_listings set
      monitoring_phase = 'WAITING_CONFIRMATION',
      post_exit_check_due_at = coalesce(post_exit_check_due_at, v_next_check),
      next_check_at = v_next_check,
      check_attempt = check_attempt + 1,
      last_check_at = p_checked_at
    where id = p_agency_listing_id;
    insert into public.lifecycle_jobs (
      job_type, agency_id, payload, run_after, dedupe_key
    ) values (
      'POST_EXIT_CHECK',
      v_listing.agency_id,
      jsonb_build_object(
        'agencyListingId', p_agency_listing_id,
        'publicationId', v_publication.id
      ),
      v_next_check,
      'POST_EXIT_RECHECK:' || p_agency_listing_id || ':' || (v_listing.check_attempt + 1)
    ) on conflict do nothing;
  else
    update public.agency_listings set
      state = v_state,
      closed_at = case when v_state = 'ACTIVE' then null else p_checked_at end,
      exit_confirmed_at = case when v_state = 'ACTIVE' then null else p_checked_at end,
      outcome_source = case when v_manual_state is not null then 'MANUAL_OVERRIDE' else 'POST_EXIT_MONITOR_V2' end,
      outcome_confidence = v_confidence,
      monitoring_phase = case when v_state = 'ACTIVE' then 'NONE' else 'COMPLETE' end,
      post_exit_check_due_at = null,
      next_check_at = null,
      check_attempt = check_attempt + 1,
      last_check_at = p_checked_at
    where id = p_agency_listing_id;
  end if;

  perform public.insert_property_lifecycle_event_atomic(
    v_listing.property_id,
    p_agency_listing_id,
    v_publication.id,
    null,
    case when v_outcome = 'REAPPEARED' then 'PUBLICATION_REAPPEARED' else 'POST_EXIT_CLASSIFIED' end,
    p_checked_at,
    p_agency_listing_id || ':POST_EXIT:' || p_job_id,
    v_confidence,
    'SYSTEM',
    jsonb_build_object('outcome', v_outcome),
    '{}'::uuid[]
  );
  perform public.refresh_property_lifecycle_intelligence_atomic(v_listing.property_id, p_checked_at);
  return v_outcome;
end;
$$;
commit;
