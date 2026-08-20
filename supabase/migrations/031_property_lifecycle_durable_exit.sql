begin;

create table public.missing_observation_commits (
  sync_run_id uuid not null references public.sync_runs(id) on delete restrict,
  publication_id uuid not null references public.publications(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (sync_run_id, publication_id)
);

alter table public.missing_observation_commits enable row level security;
grant select on table public.missing_observation_commits to authenticated;
grant select, insert, update, delete on table public.missing_observation_commits to service_role;
create policy "authenticated read missing observation commits"
  on public.missing_observation_commits for select to authenticated using (true);

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

  perform pg_advisory_xact_lock(hashtextextended('missing:' || p_agency_id::text, 0));

  for v_publication in
    select p.* from public.publications p
    where p.agency_id = p_agency_id
      and p.state in ('ACTIVE', 'MISSING_PENDING')
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
      when v_next_count >= p_missing_threshold then 'REMOVED'
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
      v_publication.id || ':' || case when v_next_state = 'REMOVED' then 'PUBLICATION_REMOVED' else 'PUBLICATION_MISSING_PENDING' end || ':' || v_next_count,
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
  v_reappeared := v_publication.state = 'ACTIVE';
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

revoke all on function public.apply_missing_observations_atomic(uuid, uuid, text[], timestamptz, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_missing_observations_atomic(uuid, uuid, text[], timestamptz, integer, integer, text)
  to service_role;

revoke all on function public.run_post_exit_check_atomic(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.run_post_exit_check_atomic(uuid, uuid, uuid, timestamptz)
  to service_role;

comment on table public.missing_observation_commits is
  'Chiave idempotente per impedire doppi missing event o doppi incrementi nello stesso sync run.';
comment on function public.run_post_exit_check_atomic(uuid, uuid, uuid, timestamptz) is
  'Controllo Post-Exit transazionale guidato dalla scadenza durevole sull agency listing.';

commit;
