-- Acquisition workflow is separate from market-scoring opportunities.
-- No historical rows are rewritten or removed.
begin;

alter table public.property_requests
  add column needs_to_sell_first text not null default 'unknown'
    check (needs_to_sell_first in ('yes', 'no', 'unknown')),
  add column property_to_sell_id uuid references public.properties(id) on delete set null,
  add column sale_situation_notes text;

create table public.acquisition_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  role text not null default 'owner',
  studio text,
  zones text,
  contact_source text,
  contact_status text not null default 'unreviewed',
  do_not_contact boolean not null default false,
  sensitive_source boolean not null default false,
  contact_review_required boolean not null default false,
  contact_review_at timestamptz,
  notes text,
  client_id uuid references public.clients(id) on delete set null,
  possible_duplicate_of uuid references public.acquisition_contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.acquisition_leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete restrict,
  contact_id uuid references public.acquisition_contacts(id) on delete set null,
  request_id uuid references public.property_requests(id) on delete set null,
  address text not null,
  locality text not null default 'Bitonto',
  source_type text not null,
  status text not null default 'NEW' check (status in
    ('NEW','VERIFY','TO_CONTACT','CONTACTED','CONVERSATION','FOLLOW_UP',
     'ACQUISITION_BOOKED','ACQUISITION_DONE','WON','FUTURE','NOT_INTERESTED','LOST')),
  priority text not null default 'C' check (priority in ('A','B','C')),
  next_action_type text,
  next_action_at timestamptz,
  next_action_note text,
  possible_duplicate_of uuid references public.acquisition_leads(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index acquisition_one_live_lead_per_property
  on public.acquisition_leads(property_id)
  where property_id is not null and status not in ('WON','FUTURE','NOT_INTERESTED','LOST');
create index acquisition_daily_queue on public.acquisition_leads(next_action_at, priority)
  where status not in ('WON','FUTURE','NOT_INTERESTED','LOST');
create index acquisition_address_lookup on public.acquisition_leads(locality, lower(address));
create index acquisition_request_idx on public.acquisition_leads(request_id);

create table public.acquisition_lead_requests (
  lead_id uuid not null references public.acquisition_leads(id) on delete restrict,
  request_id uuid not null references public.property_requests(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (lead_id, request_id)
);
create index acquisition_lead_requests_request_idx on public.acquisition_lead_requests(request_id);

create table public.acquisition_signals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.acquisition_leads(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  event_id uuid unique references public.events(id) on delete restrict,
  source_type text not null,
  signal_type text not null,
  description text,
  source_reference text,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  sensitive_source boolean not null default false,
  contact_review_required boolean not null default false,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','rejected')),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index acquisition_signals_lead_idx on public.acquisition_signals(lead_id, observed_at desc);
create index acquisition_signals_source_idx on public.acquisition_signals(source_type, signal_type, observed_at desc);

create table public.acquisition_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.acquisition_leads(id) on delete restrict,
  activity_type text not null check (activity_type in
    ('phone_call','whatsapp','sms','email','in_person','zone_visit','verification',
     'note','appointment','acquisition','status_change','system_signal')),
  outcome text,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index acquisition_activities_lead_idx on public.acquisition_activities(lead_id, occurred_at desc);
create index acquisition_activities_type_idx on public.acquisition_activities(activity_type, occurred_at desc);

create table public.acquisition_appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.acquisition_leads(id) on delete restrict,
  scheduled_at timestamptz not null,
  motivation text,
  selling_timing text,
  asking_price numeric,
  estimated_price numeric,
  obstacles text,
  competitors text,
  outcome text check (outcome in ('mandate','follow_up','not_ready','lost','reconsider')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index acquisition_appointments_date_idx on public.acquisition_appointments(scheduled_at);
create unique index acquisition_one_open_appointment_per_lead
  on public.acquisition_appointments(lead_id) where completed_at is null;

create view public.acquisition_today_queue with (security_invoker = true) as
select l.id,l.address,l.locality,l.status,l.priority,l.next_action_type,
  l.next_action_at,l.source_type,l.created_at,
  case
    when l.status = 'ACQUISITION_BOOKED' and l.next_action_at <
      (((now() at time zone 'Europe/Rome')::date + 1)::timestamp at time zone 'Europe/Rome') then 0
    when l.next_action_at < now() then 1
    when l.priority = 'A' then 2
    when l.next_action_at <
      (((now() at time zone 'Europe/Rome')::date + 1)::timestamp at time zone 'Europe/Rome') then 3
    when l.priority = 'B' then 4
    else 5
  end as queue_rank
from public.acquisition_leads l
where l.status not in ('WON','FUTURE','NOT_INTERESTED','LOST')
  and (l.next_action_at <
      (((now() at time zone 'Europe/Rome')::date + 1)::timestamp at time zone 'Europe/Rome')
    or l.next_action_at is null or l.priority = 'A'
    or (l.priority = 'B' and l.next_action_at <= now() + interval '72 hours'));
grant select on public.acquisition_today_queue to authenticated, service_role;

create function public.acquisition_kpis(p_since timestamptz) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'new_signals', (select count(*) from public.acquisition_signals where created_at >= p_since),
      'verified_signals', (select count(*) from public.acquisition_signals
        where created_at >= p_since and verification_status = 'verified'),
      'new_leads', (select count(*) from public.acquisition_leads where created_at >= p_since),
      'contact_attempts', (select count(*) from public.acquisition_activities
        where occurred_at >= p_since and activity_type in ('phone_call','whatsapp','sms','email')),
      'conversations', (select count(*) from public.acquisition_activities
        where occurred_at >= p_since and outcome = 'conversation'),
      'followups_done', (select count(*) from public.acquisition_activities
        where occurred_at >= p_since and outcome = 'follow_up_done'),
      'booked', (select count(*) from public.acquisition_appointments where created_at >= p_since),
      'completed', (select count(*) from public.acquisition_appointments where completed_at >= p_since),
      'mandates', (select count(*) from public.acquisition_appointments
        where completed_at >= p_since and outcome = 'mandate')
    ),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('name',source_type,'count',n)
      order by n desc,source_type) from (select source_type,count(*) as n
        from public.acquisition_signals where created_at >= p_since group by source_type) grouped),'[]'::jsonb),
    'signal_types', coalesce((select jsonb_agg(jsonb_build_object('name',signal_type,'count',n)
      order by n desc,signal_type) from (select signal_type,count(*) as n
        from public.acquisition_signals where created_at >= p_since group by signal_type) grouped),'[]'::jsonb),
    'mandates_by_source', coalesce((select jsonb_agg(jsonb_build_object('name',source_type,'count',n)
      order by n desc,source_type) from (select l.source_type,count(*) as n
        from public.acquisition_appointments a join public.acquisition_leads l on l.id = a.lead_id
        where a.completed_at >= p_since and a.outcome = 'mandate'
        group by l.source_type) grouped),'[]'::jsonb)
  );
$$;
revoke all on function public.acquisition_kpis(timestamptz) from public, anon, authenticated;
grant execute on function public.acquisition_kpis(timestamptz) to service_role;

create trigger set_acquisition_contacts_updated_at before update on public.acquisition_contacts
  for each row execute function public.set_updated_at();
create trigger set_acquisition_leads_updated_at before update on public.acquisition_leads
  for each row execute function public.set_updated_at();

-- Only the private market can automatically create commercial leads. Agency
-- events continue to exist as market intelligence without suggesting contact.
create function public.acquisition_capture_market_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lead_id uuid;
  signal_priority text;
  display_address text;
  display_locality text;
  signal_inserted integer;
begin
  if new.event_type not in ('PRIVATE_PRICE_DROP','PRIVATE_PUBLICATION_NEW','PRIVATE_PUBLICATION_REMOVED',
      'PRIVATE_PUBLICATION_REAPPEARED','AGENCY_TO_PRIVATE','PRIVATE_RELIST') then
    return new;
  end if;
  if new.event_type <> 'AGENCY_TO_PRIVATE' and not exists (
    select 1 from public.private_publications pp where pp.property_id = new.property_id
  ) then return new; end if;
  select coalesce(nullif(l.raw_text,''), nullif(p.display_name,''), 'Immobile ' || new.property_id::text),
    case
      when lower(coalesce(l.locality,'')) = 'palombaio' then 'Palombaio'
      when lower(coalesce(l.locality,'')) = 'mariotto' then 'Mariotto'
      else 'Bitonto'
    end
    into display_address, display_locality
    from public.properties pr
    left join public.locations l on l.id = pr.primary_location_id
    left join public.buildings p on p.id = pr.building_id
    where pr.id = new.property_id;
  signal_priority := case when new.event_type in ('AGENCY_TO_PRIVATE','PRIVATE_PUBLICATION_REAPPEARED') then 'A' else 'B' end;
  -- A won mandate stays the same commercial case. Later market observations
  -- enrich its history instead of reopening a duplicate lead automatically.
  if not exists (select 1 from public.acquisition_leads
      where property_id = new.property_id and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')) then
    select id into lead_id from public.acquisition_leads
      where property_id = new.property_id and status = 'WON'
      order by created_at desc limit 1;
  end if;
  if lead_id is null then
    insert into public.acquisition_leads(property_id,address,locality,source_type,priority,status)
      values(new.property_id,coalesce(display_address,'Immobile da verificare'),
        coalesce(display_locality,'Bitonto'),'fsbo_radar',signal_priority,'NEW')
      on conflict (property_id) where property_id is not null
        and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')
      do update set priority = case
        when public.acquisition_leads.priority = 'A' or excluded.priority = 'A' then 'A'
        when public.acquisition_leads.priority = 'B' or excluded.priority = 'B' then 'B'
        else 'C' end
      returning id into lead_id;
  end if;
  insert into public.acquisition_signals
    (lead_id,property_id,event_id,source_type,signal_type,description,dedupe_key,observed_at)
    values(lead_id,new.property_id,new.id,'fsbo_radar',lower(new.event_type),
      'Evento Property Lifecycle V2','event:' || new.id,new.occurred_at)
    on conflict (dedupe_key) do nothing;
  get diagnostics signal_inserted = row_count;
  if signal_inserted > 0 then
    insert into public.acquisition_activities(lead_id,activity_type,outcome,note,occurred_at)
      values(lead_id,'system_signal',lower(new.event_type),'Evento Property Lifecycle V2',new.occurred_at);
  end if;
  return new;
end;
$$;
create trigger acquisition_market_event after insert on public.events
  for each row execute function public.acquisition_capture_market_event();

create function public.acquisition_private_publication_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.state = 'ACTIVE' then
    insert into public.events(property_id,event_type,occurred_at,actor_type,dedupe_key,payload)
    values(new.property_id,'PRIVATE_PUBLICATION_NEW',new.first_seen_at,'SYSTEM',
      'private:' || new.id || ':NEW',jsonb_build_object('privatePublicationId',new.id))
    on conflict (dedupe_key) do nothing;
  elsif tg_op = 'UPDATE' and old.price_amount is not null and new.price_amount is not null
    and new.price_amount < old.price_amount and new.state = 'ACTIVE' then
    insert into public.events(property_id,event_type,occurred_at,actor_type,dedupe_key,payload)
    values(new.property_id,'PRIVATE_PRICE_DROP',new.last_seen_at,'SYSTEM',
      'private:' || new.id || ':PRICE:' || new.price_amount::text || ':' || new.last_seen_at::text,
      jsonb_build_object('privatePublicationId',new.id,'oldPrice',old.price_amount,'newPrice',new.price_amount))
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger acquisition_private_publication after insert or update of price_amount,state
  on public.private_publications for each row execute function public.acquisition_private_publication_change();

do $$ declare t text; begin
  foreach t in array array['acquisition_contacts','acquisition_leads','acquisition_lead_requests','acquisition_signals',
    'acquisition_activities','acquisition_appointments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
      'authenticated read ' || t,t);
  end loop;
end $$;
revoke all on function public.acquisition_capture_market_event() from public, anon, authenticated;
grant execute on function public.acquisition_capture_market_event() to service_role;
revoke all on function public.acquisition_private_publication_change() from public, anon, authenticated;
grant execute on function public.acquisition_private_publication_change() to service_role;

commit;
