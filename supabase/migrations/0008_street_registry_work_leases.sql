-- Makes the street queue safe for long-running, restartable Property Worker runs.
-- Additive/repeatable: no registry rows are removed and no inventory data changes.

create or replace function public.claim_street_registry_work(
  p_worker_id text,
  p_zone_id uuid default null,
  p_order_scope text default 'city',
  p_lease_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_item_id uuid;
  v_row jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'Identificativo Worker mancante';
  end if;
  if p_order_scope not in ('city', 'zone') then
    raise exception 'Ordinamento non valido: %', p_order_scope;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 21600 then
    raise exception 'Durata lease non valida: %', p_lease_seconds;
  end if;

  -- A desktop that restarted must recover its own live claim, not consume a
  -- second street. Renewing here does not increment attempts.
  select work.id
  into v_work_item_id
  from public.street_registry_work_items work
  where work.workflow = 'owner_network'
    and work.work_status = 'in_progress'
    and work.worker_id = btrim(p_worker_id)
    and work.lease_expires_at >= now()
  order by work.last_started_at desc nulls last, work.id
  limit 1
  for update skip locked;

  if v_work_item_id is not null then
    update public.street_registry_work_items
    set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where id = v_work_item_id;

    select to_jsonb(queue)
    into v_row
    from public.street_registry_worker_queue queue
    where queue.work_item_id = v_work_item_id;
    return v_row;
  end if;

  -- Items that exhausted their attempts must not remain forever as an
  -- unclaimable to_recheck row.
  update public.street_registry_work_items work
  set work_status = 'failed',
      worker_id = null,
      lease_expires_at = null,
      last_completed_at = now(),
      last_error = coalesce(work.last_error, '{}'::jsonb) || jsonb_build_object(
        'message', 'Tentativi Street Registry esauriti',
        'failed_at', now()
      )
  where work.workflow = 'owner_network'
    and work.attempts >= work.max_attempts
    and (
      work.work_status in ('pending', 'to_recheck')
      or (work.work_status = 'in_progress' and work.lease_expires_at < now())
    );

  select work.id
  into v_work_item_id
  from public.street_registry_work_items work
  join public.street_registry_streets street
    on street.id = work.street_id
  left join public.street_registry_street_zones link
    on link.street_id = street.id
    and link.is_primary
  where work.workflow = 'owner_network'
    and street.record_status = 'active'
    and work.attempts < work.max_attempts
    and (
      work.work_status in ('pending', 'to_recheck')
      or (work.work_status = 'in_progress' and work.lease_expires_at < now())
    )
    and (p_zone_id is null or link.zone_id = p_zone_id)
  order by
    work.priority desc,
    case when p_order_scope = 'zone' then link.zone_rank else street.city_rank end
      asc nulls last,
    street.official_code asc
  limit 1
  for update of work skip locked;

  if v_work_item_id is null then
    return null;
  end if;

  update public.street_registry_work_items
  set work_status = 'in_progress',
      worker_id = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1,
      last_started_at = now(),
      last_error = null
  where id = v_work_item_id;

  select to_jsonb(queue)
  into v_row
  from public.street_registry_worker_queue queue
  where queue.work_item_id = v_work_item_id;

  return v_row;
end;
$$;

create or replace function public.renew_street_registry_work(
  p_work_item_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'Identificativo Worker mancante';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 21600 then
    raise exception 'Durata lease non valida: %', p_lease_seconds;
  end if;

  update public.street_registry_work_items
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_work_item_id
    and workflow = 'owner_network'
    and work_status = 'in_progress'
    and worker_id = btrim(p_worker_id);

  if not found then
    raise exception 'La lavorazione via non appartiene a questo Worker';
  end if;

  select to_jsonb(queue)
  into v_row
  from public.street_registry_worker_queue queue
  where queue.work_item_id = p_work_item_id;
  return v_row;
end;
$$;

revoke all on function public.renew_street_registry_work(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.renew_street_registry_work(uuid, text, integer)
  to service_role;

comment on function public.renew_street_registry_work(uuid, text, integer) is
  'Renews an owner_network lease only when the work item is still owned by the requesting Property Worker.';
