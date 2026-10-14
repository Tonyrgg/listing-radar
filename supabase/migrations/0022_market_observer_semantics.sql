-- Completes Market Observer semantics after already shared 0014-0021.
-- No historical observation mutation, compaction, new source or second domain.
begin;
alter table public.sync_runs add column inventory_observed_keys text[];
alter table public.agency_listings
  add column market_exit_classification text,
  add column market_exit_confidence numeric check(market_exit_confidence between 0 and 1),
  add column market_exit_evidence_ids uuid[] not null default '{}',
  add column market_exit_classified_at timestamptz,
  add column market_exit_classifier_version integer,
  add column market_exit_reasons jsonb not null default '[]',
  add column market_exit_provenance jsonb not null default '{}';
alter table public.market_observer_config add column policy jsonb not null default
  '{"missingGraceHours":24,"missingHealthyRunThreshold":2,"postExitDelayHours":48,"relistingMinGapHours":1}';
create function public.market_observer_setting(p_agency_id uuid,p_key text) returns integer
language sql stable set search_path=public as $$
  select greatest(1,least(case when p_key='missingHealthyRunThreshold' then 100 else 168 end,
    coalesce(case when a.settings->>p_key ~ '^[0-9]+$' then (a.settings->>p_key)::integer end,
      (c.policy->>p_key)::integer))) from public.market_observer_config c
  left join public.agencies a on a.id=p_agency_id where c.singleton;
$$;
revoke all on function public.market_observer_setting(uuid,text) from public,anon;
grant execute on function public.market_observer_setting(uuid,text) to authenticated,service_role;

-- The existing relationship is the sole projection. Episodes remain immutable events.
create function public.market_observer_refresh_agency_listing(p_id uuid,p_as_of timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare al record; manual_state text; manual_class text; manual_sale text; active boolean; pending boolean; sold boolean;
  negotiation boolean; strong_sold boolean; graphic_conflict boolean; next_state text; classification text; confidence numeric;
  reasons jsonb; ids uuid[]; provenance jsonb;
begin
  select * into strict al from public.agency_listings where id=p_id for update;
  select override_value #>> '{}' into manual_state from public.manual_overrides mo
    where target_type='AGENCY_LISTING' and target_id=p_id and override_key='state' and effective_at<=p_as_of
      and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)
    order by effective_at desc,created_at desc limit 1;
  select override_value #>> '{}' into manual_class from public.manual_overrides mo
    where target_type='AGENCY_LISTING' and target_id=p_id and override_key='exit_classification' and effective_at<=p_as_of
      and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)
    order by effective_at desc,created_at desc limit 1;
  select override_value #>> '{}' into manual_sale from public.manual_overrides mo
    where target_type='PROPERTY' and target_id=al.property_id and override_key='sale_status' and effective_at<=p_as_of
      and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)
    order by effective_at desc,created_at desc limit 1;
  select coalesce(bool_or(p.state in ('ACTIVE','MISSING_PENDING') and p.source_status<>'SOLD' and not graphic.sold),false),
    coalesce(bool_or(p.state='MISSING_PENDING'),false),
    coalesce(bool_or(p.state='SOLD_MARKED' or p.source_status='SOLD' or graphic.sold),false),
    coalesce(bool_or(p.state='ACTIVE' and p.source_status='NEGOTIATION'),false),
    coalesce(bool_or(((p.state='SOLD_MARKED' or p.source_status='SOLD')
      and coalesce((snap.normalized_payload #>> '{status,confidence}')::numeric,0)>=0.85) or graphic.sold),false),
    coalesce(bool_or(graphic.sold and p.source_status not in ('SOLD','UNKNOWN')),false)
    into active,pending,sold,negotiation,strong_sold,graphic_conflict
    from public.publications p
    left join lateral(select id,normalized_payload from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) snap on true
    left join lateral(select coalesce(bool_or(asset->>'canonicalUrl' ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)'
      or exists(select 1 from public.evidence e where e.snapshot_id=snap.id and e.claim_key='publication.soldGraphic' and e.confidence>=0.85)),false) sold
      from jsonb_array_elements(coalesce(snap.normalized_payload->'assets','[]')) asset) graphic on true
    where p.agency_listing_id=p_id;
  if manual_sale='NOT_SOLD_CONFIRMED' then sold:=false; strong_sold:=false; end if;
  next_state:=coalesce(manual_state,case when active then 'ACTIVE' when sold then 'CLOSED_SOLD' else al.state end);
  classification:=case when manual_state='CLOSED_WITHDRAWN' then 'WITHDRAWN'
    when manual_state='CLOSED_SWITCHED' then 'AGENCY_CHANGED' when manual_state='CLOSED_TO_PRIVATE' then 'RELISTED'
    when manual_state='CLOSED_SOLD' then 'SOLD_CONFIRMED'
    when manual_state='ACTIVE' then 'ACTIVE'
    when sold and (active or not strong_sold or graphic_conflict) then 'SOLD_PROBABLE' when sold then 'SOLD_CONFIRMED'
    when negotiation then 'UNDER_OFFER' when next_state='CLOSED_WITHDRAWN' then 'WITHDRAWN'
    when next_state='CLOSED_SWITCHED' then 'AGENCY_CHANGED' when next_state='CLOSED_TO_PRIVATE' then 'RELISTED'
    when next_state in ('OFF_MARKET_NO_SALE_EVIDENCE','CLOSED_SOLD') then 'UNKNOWN_EXIT'
    when next_state='EXIT_PENDING' or pending then 'MISSING_UNCONFIRMED' else 'ACTIVE' end;
  if manual_class in ('SOLD_CONFIRMED','SOLD_PROBABLE','UNDER_OFFER','WITHDRAWN','EXPIRED_POSSIBLE','RELISTED','AGENCY_CHANGED','UNKNOWN_EXIT') then classification:=manual_class; end if;
  if manual_class is null and manual_state is null and classification='ACTIVE' and exists(
    select 1 from public.events e where e.agency_listing_id=p_id and e.event_type='PUBLICATION_RELAUNCHED'
      and not exists(select 1 from public.events later where later.agency_listing_id=p_id and later.occurred_at>e.occurred_at
        and later.event_type in ('PUBLICATION_REMOVED','POST_EXIT_CLASSIFIED','AGENCY_SWITCH_DETECTED'))) then classification:='RELISTED'; end if;
  confidence:=case when manual_state is not null or manual_class is not null then 1
    when classification='SOLD_CONFIRMED' then 0.98 when classification='SOLD_PROBABLE' then 0.65
    when classification in ('ACTIVE','UNDER_OFFER') then 1 else coalesce(al.outcome_confidence,0.5) end;
  reasons:=jsonb_build_array(case when manual_state is not null or manual_class is not null then 'human_override'
    when classification='SOLD_PROBABLE' then 'sale_conflict_or_weak_evidence'
    when classification='SOLD_CONFIRMED' then 'explicit_sale_evidence'
    when classification='RELISTED' and active then 'publication_relaunched'
    when active then 'positive_publication' else 'relationship_state:'||next_state end);
  if al.state<>'ACTIVE' and next_state='ACTIVE' and al.state<>'EXIT_PENDING' and manual_state is null then
    perform public.insert_property_lifecycle_event_atomic(al.property_id,p_id,null,null,'AGENCY_LISTING_REACTIVATED',p_as_of,
      p_id||':REACTIVATED:'||p_as_of,1,'SYSTEM',jsonb_build_object('previousState',al.state,'previousClosedAt',al.closed_at,
        'previousExitConfirmedAt',al.exit_confirmed_at,'previousClassification',al.market_exit_classification,'previousReasons',al.market_exit_reasons),'{}');
  end if;
  select coalesce(array_agg(e.id order by e.id),'{}') into ids from public.evidence e join public.publications p on p.id=e.publication_id
    where p.agency_listing_id=p_id and (e.snapshot_id=(select id from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1)
      or (e.claim_key='publication.inventoryPresence' and e.observed_at=p.last_seen_at));
  select coalesce(jsonb_agg(jsonb_build_object('publicationId',p.id,'url',p.canonical_url,'state',p.state,
    'lastSeenAt',p.last_seen_at,'missingSince',p.missing_since,'removedAt',p.removed_at,
    'missingRunIds',coalesce((select jsonb_agg(mc.sync_run_id order by mc.sync_run_id) from public.missing_observation_commits mc
      join public.sync_runs sr on sr.id=mc.sync_run_id where mc.publication_id=p.id and p.missing_since is not null and sr.started_at>=p.missing_since),'[]')) order by p.id),'[]') into provenance
    from public.publications p where p.agency_listing_id=p_id;
  update public.agency_listings set state=next_state,
    state_confidence=confidence,state_reason=jsonb_build_object('classification',classification,'reasons',reasons,'classifierVersion',3),
    closed_at=case when next_state='ACTIVE' then null else closed_at end,
    exit_confirmed_at=case when next_state='ACTIVE' then null else exit_confirmed_at end,
    market_exit_classified_at=case when market_exit_classification is distinct from classification
      or market_exit_confidence is distinct from confidence or market_exit_reasons is distinct from reasons or market_exit_evidence_ids is distinct from ids
      then p_as_of else coalesce(market_exit_classified_at,p_as_of) end,
    market_exit_classification=classification,market_exit_confidence=confidence,market_exit_evidence_ids=ids,
    market_exit_classifier_version=3,market_exit_reasons=reasons,market_exit_provenance=jsonb_build_object('publications',provenance),
    monitoring_phase=case when next_state='ACTIVE' then 'NONE' else monitoring_phase end,
    next_check_at=case when next_state='ACTIVE' then null else next_check_at end,
    post_exit_check_due_at=case when next_state='ACTIVE' then null else post_exit_check_due_at end
    where id=p_id;
end $$;
revoke all on function public.market_observer_refresh_agency_listing(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.market_observer_refresh_agency_listing(uuid,timestamptz) to service_role;

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

  -- Delayed observations must not rewind presence, price, state or the current cycle.
  if v_existing_publication.id is not null and v_observed_at < v_existing_publication.last_seen_at then
    raise exception 'OBSERVATION_PRECEDES_LAST_SEEN';
  end if;

  -- Versions are immutable. A positive unchanged observation only advances presence.
  if v_existing_publication.id is not null and p_failure_point is null then
    select * into v_previous_snapshot from public.snapshots
      where publication_id = v_existing_publication.id order by observed_at desc, id desc limit 1;
    if v_previous_snapshot.content_hash = p_listing->>'contentHash'
      and v_previous_snapshot.price_amount is not distinct from v_price_after
      and v_previous_snapshot.source_status is not distinct from v_status
      and not exists(select 1 from jsonb_array_elements(coalesce(p_processed_assets,'[]')) asset
        where asset->>'classification'='SOLD_GRAPHIC' and not exists(select 1 from public.evidence e
          where e.snapshot_id=v_previous_snapshot.id and e.claim_key='publication.soldGraphic'))
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
      'zone', p_listing #>> '{location,zoneName}',
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
      'zone', coalesce(property.canonical_attributes->'zone', p_listing #> '{location,zoneName}'),
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
        where asset->>'canonicalUrl' ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)'
        or exists(select 1 from jsonb_array_elements(coalesce(p_processed_assets,'[]')) processed
          where processed->>'canonicalUrl'=asset->>'canonicalUrl' and processed->>'classification'='SOLD_GRAPHIC'))
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
    if v_existing_publication.state in ('MISSING_PENDING', 'REMOVED') and v_status in ('ACTIVE','NEGOTIATION') then
      perform public.insert_property_lifecycle_event_atomic(
        v_property_id, v_agency_listing_id, v_publication_id, p_sync_run_id,
        'PUBLICATION_REAPPEARED', v_observed_at,
        v_publication_id || ':PUBLICATION_REAPPEARED:' || p_sync_run_id,
        1, 'SYSTEM', jsonb_build_object('sourceStatus', v_status), v_evidence_ids
      );
    end if;
    if v_existing_publication.state='REMOVED' and v_status in ('ACTIVE','NEGOTIATION')
      and v_existing_publication.removed_at is not null
      and v_observed_at >= v_existing_publication.removed_at + make_interval(hours=>public.market_observer_setting(p_agency_id,'relistingMinGapHours'))
      and not exists(select 1 from public.publications where agency_listing_id=v_agency_listing_id and id<>v_publication_id
        and state in ('ACTIVE','MISSING_PENDING','SOLD_MARKED')) then
      v_event_id:=public.insert_property_lifecycle_event_atomic(v_property_id,v_agency_listing_id,v_publication_id,p_sync_run_id,
        'PUBLICATION_RELAUNCHED',v_observed_at,v_publication_id||':RELAUNCH:'||p_sync_run_id,1,'SYSTEM',
        jsonb_build_object('previousRemovedAt',v_existing_publication.removed_at,'samePublication',true),v_evidence_ids);
      if v_event_id is not null then update public.properties set relaunch_count=relaunch_count+1 where id=v_property_id; end if;
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
    if v_status in ('ACTIVE','NEGOTIATION') and cardinality(v_prior_publication_ids)>0
      and not exists(select 1 from public.publications where id=any(v_prior_publication_ids)
        and state in ('ACTIVE','MISSING_PENDING','SOLD_MARKED'))
      and exists(select 1 from public.publications where id=any(v_prior_publication_ids) and state='REMOVED')
      and v_observed_at >= (select max(removed_at) from public.publications where id=any(v_prior_publication_ids))
        + make_interval(hours=>public.market_observer_setting(p_agency_id,'relistingMinGapHours')) then
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
    when v_status in ('ACTIVE','NEGOTIATION') and v_existing_agency_listing.state in ('EXIT_PENDING','OFF_MARKET_NO_SALE_EVIDENCE','CLOSED_SWITCHED','CLOSED_TO_PRIVATE')
      and not exists(select 1 from public.manual_overrides mo where mo.target_type='AGENCY_LISTING'
        and mo.target_id=v_agency_listing_id and mo.override_key='state' and mo.effective_at<=v_observed_at
        and not exists(select 1 from public.manual_overrides s where s.supersedes_id=mo.id)) then 'ACTIVE'
    else v_existing_agency_listing.state
  end;
  if v_next_agency_state='ACTIVE' and v_existing_agency_listing.state in
    ('OFF_MARKET_NO_SALE_EVIDENCE','CLOSED_SWITCHED','CLOSED_TO_PRIVATE','CLOSED_SOLD') and v_manual_state is null then
    perform public.insert_property_lifecycle_event_atomic(v_property_id,v_agency_listing_id,v_publication_id,p_sync_run_id,
      'AGENCY_LISTING_REACTIVATED',v_observed_at,v_agency_listing_id||':REACTIVATED:'||p_sync_run_id,1,'SYSTEM',
      jsonb_build_object('previousState',v_existing_agency_listing.state,'previousClosedAt',v_existing_agency_listing.closed_at,
        'previousExitConfirmedAt',v_existing_agency_listing.exit_confirmed_at,'previousClassification',v_existing_agency_listing.market_exit_classification,
        'previousReasons',v_existing_agency_listing.market_exit_reasons),v_evidence_ids);
  end if;
  update public.agency_listings set
    state = v_next_agency_state,
    last_seen_at = greatest(last_seen_at, v_observed_at),
    closed_at = case when v_next_agency_state='ACTIVE' then null
      when v_next_agency_state='CLOSED_SOLD' then coalesce(closed_at,v_observed_at) else closed_at end,
    exit_confirmed_at = case when v_next_agency_state='ACTIVE' then null else exit_confirmed_at end,
    state_confidence = (p_listing #>> '{status,confidence}')::numeric,
    state_reason = jsonb_build_object('sourceStatus', v_status),
    monitoring_phase = case when v_next_agency_state = 'ACTIVE' then 'NONE' else monitoring_phase end,
    post_exit_check_due_at = case when v_next_agency_state = 'ACTIVE' then null else post_exit_check_due_at end,
    next_check_at = case when v_next_agency_state = 'ACTIVE' then null else next_check_at end,
    check_attempt = case when v_next_agency_state = 'ACTIVE' then 0 else check_attempt end
  where id = v_agency_listing_id;

  if v_next_agency_state='EXIT_PENDING' and v_existing_agency_listing.state='ACTIVE' then
    update public.agency_listings set monitoring_phase='WAITING_CONFIRMATION',
      next_check_at=v_observed_at+make_interval(hours=>public.market_observer_setting(p_agency_id,'postExitDelayHours')),post_exit_check_due_at=v_observed_at+make_interval(hours=>public.market_observer_setting(p_agency_id,'postExitDelayHours')),check_attempt=0
      where id=v_agency_listing_id;
    insert into public.lifecycle_jobs(job_type,agency_id,payload,run_after,dedupe_key)
      values('POST_EXIT_CHECK',p_agency_id,jsonb_build_object('agencyListingId',v_agency_listing_id,'publicationId',v_publication_id),
        v_observed_at+make_interval(hours=>public.market_observer_setting(p_agency_id,'postExitDelayHours')),'POST_EXIT_EXPLICIT:'||v_publication_id||':'||p_sync_run_id) on conflict do nothing;
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
    select p.* from public.publications p where p.agency_id=p_agency_id
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
    where p.agency_id = p_agency_id
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

  -- A sold mark on any publication belongs to this relationship, regardless of the queued publication.
  v_explicit_sold := exists(select 1 from public.publications p
    where p.agency_listing_id=p_agency_listing_id and (p.state='SOLD_MARKED' or p.source_status='SOLD'));
  v_reappeared := exists(select 1 from public.publications
    where agency_listing_id=p_agency_listing_id and state in ('ACTIVE','MISSING_PENDING'));
  -- A stored absence growing older is not a new observation. Require a newer complete healthy scan.
  if v_manual_state is null and not v_reappeared and not v_explicit_sold and not v_switched and not v_private then
    if v_listing.next_check_at is not null and p_checked_at>=v_listing.next_check_at and exists(
      select 1 from public.publications pub where pub.agency_listing_id=p_agency_listing_id
      and not exists(select 1 from public.sync_runs sr join public.agencies a on a.id=sr.agency_id
        where sr.agency_id=v_listing.agency_id and sr.status='SUCCEEDED' and sr.health_state='HEALTHY'
          and sr.inventory_complete and sr.absence_evaluation_allowed and sr.inventory_observed_keys is not null
          and sr.started_at>=v_listing.next_check_at and sr.finished_at>=sr.started_at and sr.finished_at<=p_checked_at
          and lower(regexp_replace(substring(pub.canonical_url from '^https?://([^/]+)'),'^www\.',''))=
              lower(regexp_replace(substring(a.inventory_url from '^https?://([^/]+)'),'^www\.',''))
          and not(pub.source_key=any(sr.inventory_observed_keys)) and pub.last_seen_at<sr.started_at
          and not exists(select 1 from public.sync_runs newer where newer.agency_id=sr.agency_id and newer.started_at>sr.started_at))
      and not exists(select 1 from public.publication_observation_receipts r join public.snapshots s on s.id=r.snapshot_id
        where r.publication_id=pub.id and r.observed_at>=v_listing.next_check_at and r.observed_at<=p_checked_at
          and s.source_status='REMOVED' and coalesce((s.normalized_payload #>> '{status,confidence}')::numeric,0)>=0.85)
    ) then raise exception 'POST_EXIT_FRESH_HEALTHY_SCAN_REQUIRED'; end if;
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
      'attempt', v_listing.check_attempt + 1, 'classifierVersion',3
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
    left join lateral (select coalesce(bool_or(a->>'canonicalUrl' ~* '(^|[/_.-])(venduto|venduta|venduti|vendute|sold)([/_.-]|$)' or exists(select 1 from public.evidence e where e.snapshot_id=s.id and e.claim_key='publication.soldGraphic' and e.confidence>=0.85)),false) sold
      from (select id,normalized_payload from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) s,
        jsonb_array_elements(coalesce(s.normalized_payload->'assets','[]')) a) sold_media on true
    where al.property_id=p_property_id;
  select exists(select 1 from public.private_publications where property_id=p_property_id and state='ACTIVE') into active_private;
  sale:=coalesce(manual_sale,case when has_sold and (has_active or active_private or sold_conflict) then 'PROBABLE_SOLD'
    when has_sold then 'SOLD_CONFIRMED' else 'UNKNOWN' end);
  select exists(select 1 from public.publications p join public.agency_listings al on al.id=p.agency_listing_id
    join lateral (select normalized_payload from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) s on true
    where al.property_id=p_property_id and (
      ((p.state='SOLD_MARKED' or p.source_status='SOLD') and coalesce((s.normalized_payload #>> '{status,confidence}')::numeric,0)>=0.85)
      or exists(select 1 from public.evidence e where e.snapshot_id=(select id from public.snapshots where publication_id=p.id order by observed_at desc,id desc limit 1) and e.claim_key='publication.soldGraphic' and e.confidence>=0.85)
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
  perform public.market_observer_refresh_agency_listing(id,p_as_of) from public.agency_listings where property_id=p_property_id;
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
  select least(pr.first_seen_at,min(p.portal_published_at),
    (select min(first_public_evidence_at) from public.private_publications where property_id=p_property_id)) into market_anchor
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

create or replace function public.acquisition_link_market_opportunity(p_opportunity_id uuid,p_actor_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare op record; pr record; lead uuid; inserted integer; agency_listing uuid;
begin
  select * into strict op from public.opportunities where id=p_opportunity_id and opportunity_type='ACQUISITION' for update;
  select * into strict pr from public.properties where id=op.property_id for update;
  select s.lead_id into lead from public.acquisition_signals s where s.opportunity_id=op.id;
  if lead is not null then
    select id into agency_listing from public.agency_listings where property_id=pr.id order by (state='ACTIVE') desc,last_seen_at desc,id limit 1;
    update public.acquisition_signals set agency_listing_id=agency_listing,details=details||op.evidence_summary||jsonb_build_object('score',op.score,
      'reasons',op.reasons,'ruleVersion',op.rule_version,'engine','MARKET_OBSERVER',
      'sourceAgencyId',(select agency_id from public.agency_listings where id=agency_listing)) where opportunity_id=op.id;
    return lead;
  end if;
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
  select id into agency_listing from public.agency_listings where property_id=pr.id
    order by (state='ACTIVE') desc,last_seen_at desc,id limit 1;
  insert into public.acquisition_signals(lead_id,property_id,source_type,signal_type,description,source_reference,details,dedupe_key,
      observed_at,opportunity_id,agency_listing_id)
    values(lead,pr.id,'market_observer','acquisition_opportunity','Opportunità da evidenze pubbliche',
      '/casa/'||pr.id,op.evidence_summary||jsonb_build_object('score',op.score,'reasons',op.reasons,'ruleVersion',op.rule_version,
        'engine','MARKET_OBSERVER','sourceAgencyId',(select agency_id from public.agency_listings where id=agency_listing)),
      'market-opportunity:'||op.id,op.detected_at,op.id,agency_listing) on conflict(dedupe_key) do nothing;
  get diagnostics inserted=row_count;
  if inserted>0 then insert into public.acquisition_activities(lead_id,activity_type,outcome,note,actor_id)
    values(lead,'system_signal','market_observer','Opportunità collegata dall’Intelligence.',p_actor_id); end if;
  return lead;
end $$;
commit;
