begin;

alter table public.sync_runs
  add column observation_commit_count integer not null default 0
    check (observation_commit_count >= 0),
  add column observation_failure_count integer not null default 0
    check (observation_failure_count >= 0);

create table public.adapter_health_baselines (
  agency_id uuid primary key references public.agencies(id) on delete restrict,
  successful_run_count integer not null default 0 check (successful_run_count >= 0),
  recent_inventory_counts integer[] not null default '{}'::integer[],
  rolling_median numeric,
  variability numeric check (variability is null or variability >= 0),
  schema_fingerprint text,
  schema_version integer not null default 0 check (schema_version >= 0),
  pending_schema_fingerprint text,
  pending_schema_run_count integer not null default 0
    check (pending_schema_run_count >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  consecutive_healthy_runs integer not null default 0
    check (consecutive_healthy_runs >= 0),
  last_success_at timestamptz,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.adapter_health_baselines enable row level security;
grant select on table public.adapter_health_baselines to authenticated;
grant select, insert, update, delete on table public.adapter_health_baselines to service_role;

create policy "authenticated read adapter health baselines"
  on public.adapter_health_baselines
  for select
  to authenticated
  using (true);

alter table public.agency_listings
  add column monitoring_phase text not null default 'NONE'
    check (monitoring_phase in ('NONE', 'WAITING_CONFIRMATION', 'EVIDENCE_REVIEW', 'COMPLETE')),
  add column post_exit_check_due_at timestamptz,
  add column next_check_at timestamptz,
  add column check_attempt integer not null default 0 check (check_attempt >= 0),
  add column last_check_at timestamptz,
  add constraint agency_listings_post_exit_schedule_check check (
    (monitoring_phase in ('NONE', 'COMPLETE') and next_check_at is null)
    or (monitoring_phase in ('WAITING_CONFIRMATION', 'EVIDENCE_REVIEW') and next_check_at is not null)
  );

create index agency_listings_post_exit_due_idx
  on public.agency_listings (next_check_at, monitoring_phase)
  where monitoring_phase in ('WAITING_CONFIRMATION', 'EVIDENCE_REVIEW');

create unique index post_exit_checks_job_unique_idx
  on public.post_exit_checks (job_id)
  where job_id is not null;

create or replace function public.record_adapter_health_observation(
  p_agency_id uuid,
  p_sync_run_id uuid,
  p_state text,
  p_observed_count integer,
  p_expected_count integer,
  p_parse_error_count integer,
  p_structure_fingerprint text,
  p_reasons jsonb,
  p_diagnostics jsonb,
  p_response_status integer,
  p_baseline jsonb,
  p_observed_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('HEALTHY', 'DEGRADED', 'FAILED', 'STRUCTURE_CHANGED') then
    raise exception 'Invalid adapter health state %', p_state;
  end if;

  insert into public.adapter_health (
    agency_id,
    sync_run_id,
    state,
    checked_at,
    response_status,
    observed_count,
    expected_count,
    parse_error_count,
    structure_fingerprint,
    reasons,
    diagnostics
  ) values (
    p_agency_id,
    p_sync_run_id,
    p_state,
    p_observed_at,
    p_response_status,
    p_observed_count,
    p_expected_count,
    p_parse_error_count,
    p_structure_fingerprint,
    coalesce(p_reasons, '[]'::jsonb),
    coalesce(p_diagnostics, '{}'::jsonb) || jsonb_build_object('baseline', p_baseline)
  );

  insert into public.adapter_health_baselines (
    agency_id,
    successful_run_count,
    recent_inventory_counts,
    rolling_median,
    variability,
    schema_fingerprint,
    schema_version,
    pending_schema_fingerprint,
    pending_schema_run_count,
    consecutive_failures,
    consecutive_healthy_runs,
    last_success_at,
    last_observed_at,
    updated_at
  ) values (
    p_agency_id,
    coalesce((p_baseline->>'successfulRunCount')::integer, 0),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(p_baseline->'recentInventoryCounts', '[]'::jsonb))::integer),
      '{}'::integer[]
    ),
    (p_baseline->>'rollingMedian')::numeric,
    (p_baseline->>'variability')::numeric,
    p_baseline->>'schemaFingerprint',
    coalesce((p_baseline->>'schemaVersion')::integer, 0),
    p_baseline->>'pendingSchemaFingerprint',
    coalesce((p_baseline->>'pendingSchemaRunCount')::integer, 0),
    coalesce((p_baseline->>'consecutiveFailures')::integer, 0),
    coalesce((p_baseline->>'consecutiveHealthyRuns')::integer, 0),
    case when p_state = 'HEALTHY' then p_observed_at else null end,
    p_observed_at,
    now()
  )
  on conflict (agency_id) do update set
    successful_run_count = excluded.successful_run_count,
    recent_inventory_counts = excluded.recent_inventory_counts,
    rolling_median = excluded.rolling_median,
    variability = excluded.variability,
    schema_fingerprint = excluded.schema_fingerprint,
    schema_version = excluded.schema_version,
    pending_schema_fingerprint = excluded.pending_schema_fingerprint,
    pending_schema_run_count = excluded.pending_schema_run_count,
    consecutive_failures = excluded.consecutive_failures,
    consecutive_healthy_runs = excluded.consecutive_healthy_runs,
    last_success_at = case
      when p_state = 'HEALTHY' then p_observed_at
      else adapter_health_baselines.last_success_at
    end,
    last_observed_at = excluded.last_observed_at,
    updated_at = now();
end;
$$;

create or replace function public.record_observation_commit_failure(p_sync_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sync_runs
  set observation_failure_count = observation_failure_count + 1
  where id = p_sync_run_id;
$$;

create or replace function public.refresh_property_lifecycle_intelligence_atomic(
  p_property_id uuid,
  p_as_of timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property record;
  v_active_agencies integer;
  v_active_private boolean;
  v_property_state text;
  v_price_drops integer;
  v_age_days integer;
  v_best_state text;
  v_level text;
  v_score numeric;
  v_reasons jsonb;
begin
  select * into strict v_property
  from public.properties
  where id = p_property_id
  for update;

  select count(distinct agency_id) into v_active_agencies
  from public.agency_listings
  where property_id = p_property_id and state = 'ACTIVE';

  select exists(
    select 1 from public.private_publications
    where property_id = p_property_id and state = 'ACTIVE'
  ) into v_active_private;

  v_property_state := case
    when v_property.sale_status = 'SOLD_CONFIRMED' and v_active_agencies = 0 and not v_active_private then 'SOLD'
    when v_active_agencies > 1 and v_active_private then 'ACTIVE_AGENCY_AND_PRIVATE'
    when v_active_agencies > 1 then 'ACTIVE_MULTI_AGENCY'
    when v_active_agencies = 1 and v_active_private then 'ACTIVE_AGENCY_AND_PRIVATE'
    when v_active_agencies = 1 then 'ACTIVE_AGENCY'
    when v_active_private then 'ACTIVE_PRIVATE'
    else 'OFF_MARKET_UNKNOWN'
  end;

  update public.properties
  set property_state = v_property_state, updated_at = now()
  where id = p_property_id;

  select count(*) into v_price_drops
  from public.events
  where property_id = p_property_id and event_type = 'PRICE_DROP';

  if v_property.true_market_start_upper_bound is not null then
    v_age_days := greatest(0, floor(extract(epoch from (p_as_of - v_property.true_market_start_upper_bound)) / 86400)::integer);
  else
    v_age_days := null;
  end if;

  select state into v_best_state
  from public.agency_listings
  where property_id = p_property_id
  order by case state
    when 'CLOSED_SOLD' then 6
    when 'CLOSED_TO_PRIVATE' then 5
    when 'OFF_MARKET_NO_SALE_EVIDENCE' then 4
    when 'CLOSED_SWITCHED' then 3
    when 'EXIT_PENDING' then 2
    else 1
  end desc
  limit 1;

  if v_property.sale_status = 'SOLD_CONFIRMED' or v_best_state = 'CLOSED_SOLD' then
    v_level := 'NONE'; v_score := 0; v_reasons := '["sold_confirmed"]'::jsonb;
  elsif v_best_state = 'CLOSED_TO_PRIVATE' then
    v_level := 'HOT'; v_score := 100; v_reasons := '["agency_to_private_confirmed"]'::jsonb;
  elsif v_best_state = 'OFF_MARKET_NO_SALE_EVIDENCE' then
    v_level := 'HIGH'; v_score := 85;
    v_reasons := '["agency_exit_confirmed","no_sale_evidence","no_new_agency_evidence"]'::jsonb;
  elsif v_best_state = 'CLOSED_SWITCHED' then
    v_level := 'INTERESTING'; v_score := 55; v_reasons := '["agency_switch_confirmed"]'::jsonb;
  elsif v_best_state = 'EXIT_PENDING' then
    v_level := 'INTERESTING'; v_score := 50; v_reasons := '["agency_exit_under_review"]'::jsonb;
  else
    v_score := 0;
    v_reasons := '[]'::jsonb;
    if coalesce(v_age_days, 0) >= 150 then
      v_score := v_score + 25;
      v_reasons := v_reasons || '["true_market_age_at_least_150_days"]'::jsonb;
    end if;
    if v_price_drops > 0 then
      v_score := v_score + least(15, v_price_drops * 5);
      v_reasons := v_reasons || jsonb_build_array('price_drops:' || v_price_drops);
    end if;
    if v_property.relaunch_count > 0 then
      v_score := v_score + least(15, v_property.relaunch_count * 5);
      v_reasons := v_reasons || jsonb_build_array('relaunches:' || v_property.relaunch_count);
    end if;
    if v_score > 0 then
      v_level := 'WATCH';
    else
      v_level := 'NONE';
      v_reasons := '["no_current_opportunity_signal"]'::jsonb;
    end if;
  end if;

  insert into public.opportunities (
    property_id, opportunity_type, status, level, score,
    evidence_summary, reasons, rule_version, dedupe_key
  ) values (
    p_property_id,
    'ACQUISITION',
    case when v_level = 'NONE' then case when v_property.sale_status = 'SOLD_CONFIRMED' then 'DISMISSED' else 'EXPIRED' end else 'OPEN' end,
    v_level,
    v_score,
    jsonb_build_object('propertyState', v_property_state),
    v_reasons,
    1,
    'acquisition:' || p_property_id || ':v1'
  )
  on conflict (dedupe_key) do update set
    status = excluded.status,
    level = excluded.level,
    score = excluded.score,
    evidence_summary = excluded.evidence_summary,
    reasons = excluded.reasons,
    updated_at = now();
end;
$$;

revoke all on function public.record_adapter_health_observation(uuid, uuid, text, integer, integer, integer, text, jsonb, jsonb, integer, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_adapter_health_observation(uuid, uuid, text, integer, integer, integer, text, jsonb, jsonb, integer, jsonb, timestamptz)
  to service_role;

revoke all on function public.record_observation_commit_failure(uuid)
  from public, anon, authenticated;
grant execute on function public.record_observation_commit_failure(uuid) to service_role;

revoke all on function public.refresh_property_lifecycle_intelligence_atomic(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_property_lifecycle_intelligence_atomic(uuid, timestamptz)
  to service_role;

comment on table public.adapter_health_baselines is
  'Baseline progressiva per agenzia; contiene soltanto osservazioni healthy realmente accumulate.';
comment on column public.agency_listings.next_check_at is
  'Scadenza durevole del prossimo controllo Post-Exit, indipendente dalla memoria del worker.';
comment on column public.sync_runs.observation_failure_count is
  'Numero di observation la cui transazione DB è fallita e non ha prodotto stato parziale.';

commit;
