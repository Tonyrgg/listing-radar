-- One chronological read model over the existing sources of truth.
-- Historical rows remain in their original tables; no snapshots are copied.
begin;

create table public.logbook_entries (
  id uuid primary key default gen_random_uuid(),
  event_category text not null check (event_category in
    ('MARKET','INTELLIGENCE','CONTACT','FIELD','PIPELINE','SYSTEM')),
  event_type text not null check (length(btrim(event_type)) > 0),
  source_type text not null default 'manual',
  property_id uuid references public.properties(id) on delete restrict,
  contact_id uuid references public.acquisition_contacts(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  lead_id uuid references public.acquisition_leads(id) on delete restrict,
  request_id uuid references public.property_requests(id) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  note text,
  outcome text,
  importance text not null default 'normal'
    check (importance in ('normal','attention','urgent')),
  next_action_type text,
  next_action_at timestamptz,
  action_completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  automatic boolean not null default false,
  dedupe_key text unique,
  sensitive boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint logbook_action_pair check
    ((next_action_at is null and next_action_type is null) or
     (next_action_at is not null and next_action_type is not null))
);
create index logbook_entries_time_idx on public.logbook_entries(occurred_at desc,id);
create index logbook_entries_property_idx on public.logbook_entries(property_id,occurred_at desc)
  where property_id is not null;
create index logbook_entries_contact_idx on public.logbook_entries(contact_id,occurred_at desc)
  where contact_id is not null;
create index logbook_entries_client_idx on public.logbook_entries(client_id,occurred_at desc)
  where client_id is not null;
create index logbook_entries_lead_idx on public.logbook_entries(lead_id,occurred_at desc)
  where lead_id is not null;
create index logbook_entries_action_idx on public.logbook_entries(next_action_at)
  where next_action_at is not null and action_completed_at is null;

create table public.monthly_focus (
  id uuid primary key default gen_random_uuid(),
  month_start date not null check (extract(day from month_start) = 1),
  lead_id uuid references public.acquisition_leads(id) on delete restrict,
  contact_id uuid references public.acquisition_contacts(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint monthly_focus_one_subject check
    (num_nonnulls(lead_id,contact_id,client_id,property_id) = 1)
);
create unique index monthly_focus_lead_unique on public.monthly_focus(month_start,lead_id)
  where lead_id is not null;
create unique index monthly_focus_contact_unique on public.monthly_focus(month_start,contact_id)
  where contact_id is not null;
create unique index monthly_focus_client_unique on public.monthly_focus(month_start,client_id)
  where client_id is not null;
create unique index monthly_focus_property_unique on public.monthly_focus(month_start,property_id)
  where property_id is not null;
create index monthly_focus_month_idx on public.monthly_focus(month_start,created_at);
create index acquisition_leads_contact_idx on public.acquisition_leads(contact_id)
  where contact_id is not null;
create index acquisition_appointments_lead_completed_idx
  on public.acquisition_appointments(lead_id,completed_at desc);

-- The ledger intentionally excludes routine sightings and duplicate wrappers:
-- an acquisition signal with event_id is the same market change as events;
-- system_signal and appointment activities mirror signals/appointments.
create view public.universal_logbook with (security_invoker = true) as
select 'market:' || e.id::text as id, 'MARKET'::text as event_category,
  lower(e.event_type) as event_type,
  coalesce(pp.source,agency.slug,lower(e.actor_type)) as source_type,
  e.id as source_id, e.property_id, coalesce(e.publication_id,e.agency_listing_id) as listing_id,
  al.contact_id, ac.client_id,
  al.id as lead_id, al.request_id,
  e.occurred_at, e.recorded_at as created_at, null::uuid as actor_id,
  e.event_type as title, null::text as description, null::text as outcome,
  case when e.event_type in ('PRICE_DROP','PRIVATE_PRICE_DROP','AGENCY_TO_PRIVATE')
    then 'attention' else 'normal' end::text as importance,
  false as requires_action, null::text as next_action_type,
  null::timestamptz as next_action_at, e.payload as metadata,
  e.actor_type <> 'USER' as automatic, false as sensitive,
  coalesce(nullif(loc.raw_text,''),nullif(b.display_name,''),'Immobile da verificare') as address,
  coalesce(loc.locality,'Bitonto') as locality, ac.full_name as person_name
from public.events e
join public.properties p on p.id = e.property_id
left join public.locations loc on loc.id = p.primary_location_id
left join public.buildings b on b.id = p.building_id
left join public.publications pub on pub.id = e.publication_id
left join public.agencies agency on agency.id = pub.agency_id
left join public.private_publications pp on pp.id = case
  when e.payload->>'privatePublicationId' ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then (e.payload->>'privatePublicationId')::uuid end
left join public.acquisition_signals linked_signal on linked_signal.event_id = e.id
left join lateral (
  select l.id,l.contact_id,l.request_id from public.acquisition_leads l
  where l.id = linked_signal.lead_id
    or (linked_signal.id is null and l.property_id = e.property_id
      and l.created_at <= e.recorded_at)
  order by case when l.id = linked_signal.lead_id then 0 else 1 end,
    l.created_at desc limit 1
) al on true
left join public.acquisition_contacts ac on ac.id = al.contact_id
where e.event_type in (
  'NEW_LISTING','PRICE_DROP','PRIVATE_PRICE_DROP','PRICE_INCREASE','PRICE_CHANGED',
  'PUBLICATION_CONTENT_CHANGED','PUBLICATION_REMOVED','DISAPPEARED_CONFIRMED',
  'PUBLICATION_REAPPEARED','PRIVATE_PUBLICATION_NEW','PRIVATE_PUBLICATION_REMOVED',
  'PRIVATE_PUBLICATION_REAPPEARED','AGENCY_SWITCH_DETECTED','AGENCY_TO_PRIVATE',
  'PRIVATE_RELIST','PRIVATE_RELIST_CONFLICT','SOURCE_MARKED_SOLD',
  'PUBLICATION_RELAUNCHED','POST_EXIT_CLASSIFIED','MANUAL_OVERRIDE_RECORDED',
  'PROPERTY_SALE_STATUS_OVERRIDDEN','AGENCY_OUTCOME_OVERRIDDEN'
)
union all
select 'signal:' || s.id::text, 'INTELLIGENCE'::text, s.signal_type,
  s.source_type, s.id, coalesce(s.property_id,l.property_id), null::uuid,
  l.contact_id, c.client_id, l.id, l.request_id, s.observed_at, s.created_at, null::uuid,
  s.signal_type, s.description, s.verification_status,
  case when l.priority = 'A' then 'attention' else 'normal' end::text,
  false, null::text, null::timestamptz, s.details, false, s.sensitive_source,
  l.address, l.locality, c.full_name
from public.acquisition_signals s
join public.acquisition_leads l on l.id = s.lead_id
left join public.acquisition_contacts c on c.id = l.contact_id
where s.event_id is null
union all
select 'activity:' || a.id::text,
  case when a.activity_type in ('phone_call','whatsapp','sms','email','in_person') then 'CONTACT'
       when a.activity_type = 'zone_visit' then 'FIELD'
       when a.activity_type in ('status_change','acquisition') then 'PIPELINE'
       else 'INTELLIGENCE' end::text,
  a.activity_type, l.source_type, a.id, l.property_id, null::uuid,
  l.contact_id, c.client_id, l.id, l.request_id, a.occurred_at, a.created_at, a.actor_id,
  a.activity_type, a.note, a.outcome, 'normal'::text, false,
  null::text, null::timestamptz, '{}'::jsonb, false,
  coalesce(c.sensitive_source,false),
  l.address, l.locality, c.full_name
from public.acquisition_activities a
join public.acquisition_leads l on l.id = a.lead_id
left join public.acquisition_contacts c on c.id = l.contact_id
where a.activity_type not in ('system_signal','appointment')
union all
select 'appointment:' || ap.id::text, 'PIPELINE'::text, 'appointment_booked'::text,
  l.source_type, ap.id, l.property_id, null::uuid, l.contact_id, c.client_id, l.id, l.request_id,
  ap.created_at, ap.created_at, null::uuid, 'Appuntamento di acquisizione fissato'::text,
  ap.motivation, null::text, 'attention'::text, ap.completed_at is null,
  'acquisition'::text,ap.scheduled_at,
  jsonb_build_object('scheduled_at',ap.scheduled_at), false, false,
  l.address, l.locality, c.full_name
from public.acquisition_appointments ap
join public.acquisition_leads l on l.id = ap.lead_id
left join public.acquisition_contacts c on c.id = l.contact_id
union all
select 'lead:' || l.id::text, 'PIPELINE'::text, 'opportunity_created'::text,
  l.source_type, l.id, l.property_id, null::uuid, l.contact_id, c.client_id, l.id, l.request_id,
  l.created_at, l.created_at, l.created_by, 'Opportunità aperta'::text,
  null::text, null::text, 'normal'::text, false,
  null::text,null::timestamptz,'{}'::jsonb, false, false,
  l.address, l.locality, c.full_name
from public.acquisition_leads l
left join public.acquisition_contacts c on c.id = l.contact_id
union all
select 'request:' || r.id::text, 'PIPELINE'::text, 'buyer_request_created'::text,
  coalesce(r.source,'manual'), r.id, r.property_to_sell_id, null::uuid,
  null::uuid, r.client_id, null::uuid, r.id, r.created_at, r.created_at, r.created_by,
  'Nuova richiesta cliente'::text, r.title, null::text, 'normal'::text,
  false, null::text, null::timestamptz,
  '{}'::jsonb, r.source <> 'manual', false,
  null::text, r.municipality, null::text
from public.property_requests r
union all
select 'manual:' || m.id::text, m.event_category, m.event_type,
  m.source_type, m.id, coalesce(m.property_id,l.property_id), null::uuid,
  coalesce(m.contact_id,l.contact_id),coalesce(m.client_id,c.client_id),
  m.lead_id, coalesce(m.request_id,l.request_id),
  m.occurred_at, m.created_at, m.created_by, m.title, m.note, m.outcome,
  m.importance, m.next_action_at is not null and m.action_completed_at is null,
  m.next_action_type,m.next_action_at,m.metadata, m.automatic, m.sensitive,
  coalesce(l.address,loc.raw_text), coalesce(l.locality,loc.locality),
  coalesce(c.full_name,buyer.full_name)
from public.logbook_entries m
left join public.acquisition_leads l on l.id = m.lead_id
left join public.properties p on p.id = coalesce(m.property_id,l.property_id)
left join public.locations loc on loc.id = p.primary_location_id
left join public.acquisition_contacts c on c.id = coalesce(m.contact_id,l.contact_id)
left join public.clients buyer on buyer.id = coalesce(m.client_id,c.client_id);

create view public.monthly_focus_overview with (security_invoker = true) as
select f.id,f.month_start,f.lead_id,f.contact_id,f.client_id,f.property_id,f.note,f.created_at,
  coalesce(l.address,c.full_name,buyer.full_name,loc.raw_text,'Immobile da verificare') as label,
  coalesce(l.locality,loc.locality) as locality,
  coalesce(l.priority,linked_lead.priority) as priority,
  coalesce(l.status,linked_lead.status) as status,
  coalesce(l.next_action_type,linked_lead.next_action_type) as next_action_type,
  coalesce(l.next_action_at,linked_lead.next_action_at) as next_action_at,
  (select max(v.occurred_at) from public.universal_logbook v
   where (f.lead_id is not null and v.lead_id = f.lead_id)
      or (f.contact_id is not null and v.contact_id = f.contact_id)
      or (f.client_id is not null and v.client_id = f.client_id)
      or (f.property_id is not null and v.property_id = f.property_id)) as last_event_at
from public.monthly_focus f
left join public.acquisition_leads l on l.id = f.lead_id
left join public.acquisition_contacts c on c.id = f.contact_id
left join public.clients buyer on buyer.id = f.client_id
left join public.properties p on p.id = f.property_id
left join public.locations loc on loc.id = p.primary_location_id
left join lateral (select al.priority,al.status,al.next_action_type,al.next_action_at
  from public.acquisition_leads al
  where (f.contact_id is not null and al.contact_id = f.contact_id)
    or (f.client_id is not null and exists (select 1 from public.acquisition_contacts ac
      where ac.id = al.contact_id and ac.client_id = f.client_id))
    or (f.property_id is not null and al.property_id = f.property_id)
  order by case when al.status in ('WON','FUTURE','NOT_INTERESTED','LOST') then 1 else 0 end,
    al.updated_at desc limit 1) linked_lead on true;

create function public.logbook_month_summary(p_month date) returns jsonb
language sql stable set search_path = public as $$
with bounds as (
  select date_trunc('month',p_month::timestamp) at time zone 'Europe/Rome' as first_at,
    (date_trunc('month',p_month::timestamp) + interval '1 month')
      at time zone 'Europe/Rome' as last_at
), month_events as materialized (
  select v.* from public.universal_logbook v,bounds b
  where v.occurred_at >= b.first_at and v.occurred_at < b.last_at
)
select jsonb_build_object(
  'events',count(*),
  'people',count(distinct coalesce('contact:'||contact_id::text,'client:'||client_id::text)),
  'properties',count(distinct property_id),
  'activities',count(*) filter (where id like 'activity:%' or id like 'manual:%'),
  'signals',count(*) filter (where id like 'signal:%'),
  'new_leads',count(*) filter (where event_type = 'opportunity_created'),
  'calls',count(*) filter (where event_type = 'phone_call'),
  'conversations',count(*) filter (where outcome = 'conversation'),
  'followups',count(*) filter (where outcome = 'follow_up_done'),
  'zone_visits',count(*) filter (where event_type = 'zone_visit'),
  'booked',count(*) filter (where event_type = 'appointment_booked'),
  'completed',count(*) filter (where event_type = 'acquisition'),
  'mandates',count(*) filter (where event_type = 'acquisition' and outcome = 'mandate'),
  'lost',count(*) filter (where event_type = 'status_change' and outcome = 'LOST'),
  'productive_days',count(distinct (occurred_at at time zone 'Europe/Rome')::date),
  'by_source',coalesce((select jsonb_agg(jsonb_build_object('name',source_type,'count',n)
      order by n desc,source_type) from (select source_type,count(*) n from month_events
      where source_type is not null group by source_type) grouped),'[]'::jsonb),
  'pipeline',jsonb_build_object(
    'open',(select count(*) from public.acquisition_leads
      where status not in ('WON','FUTURE','NOT_INTERESTED','LOST')),
    'a',(select count(*) from public.acquisition_leads
      where priority='A' and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')),
    'b',(select count(*) from public.acquisition_leads
      where priority='B' and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')),
    'overdue',(select count(*) from public.acquisition_leads where next_action_at < now()
      and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')),
    'without_action',(select count(*) from public.acquisition_leads where next_action_at is null
      and status not in ('WON','FUTURE','NOT_INTERESTED','LOST')))
) from month_events;
$$;

create function public.acquisition_stale(
  p_a_days integer default 3,p_b_days integer default 7,p_c_days integer default 14)
returns table(id uuid,address text,locality text,status text,priority text,
  next_action_type text,next_action_at timestamptz,last_movement_at timestamptz,reason text)
language sql stable set search_path = public as $$
select l.id,l.address,l.locality,l.status,l.priority,l.next_action_type,l.next_action_at,
  greatest(l.created_at,coalesce(activity.last_at,l.created_at),
    coalesce(signal.last_at,l.created_at),coalesce(appt.last_at,l.created_at),
    coalesce(manual.last_at,l.created_at)) as last_movement_at,
  case
    when l.next_action_at < now() then 'Azione scaduta'
    when l.next_action_at is null then 'Senza prossima azione'
    else 'Senza movimento'
  end as reason
from public.acquisition_leads l
left join lateral (select max(a.occurred_at) as last_at
  from public.acquisition_activities a where a.lead_id = l.id) activity on true
left join lateral (select max(s.observed_at) as last_at
  from public.acquisition_signals s where s.lead_id = l.id) signal on true
left join lateral (select max(a.completed_at) as last_at
  from public.acquisition_appointments a where a.lead_id = l.id) appt on true
left join lateral (select max(m.occurred_at) as last_at
  from public.logbook_entries m where m.lead_id = l.id) manual on true
where l.status not in ('WON','FUTURE','NOT_INTERESTED','LOST')
  and (l.next_action_at is null or l.next_action_at < now()
    or greatest(l.created_at,coalesce(activity.last_at,l.created_at),
      coalesce(signal.last_at,l.created_at),coalesce(appt.last_at,l.created_at),
      coalesce(manual.last_at,l.created_at))
      < now() - make_interval(days => case l.priority
        when 'A' then greatest(1,p_a_days)
        when 'B' then greatest(1,p_b_days)
        else greatest(1,p_c_days) end))
order by case when l.next_action_at < now() then 0
  when l.next_action_at is null then 1 else 2 end,
  l.next_action_at nulls last,l.id;
$$;

-- A strong buyer match is recorded once when it becomes meaningful. Routine
-- recalculation leaves the diary untouched; portfolio IDs stay in metadata
-- because they are not Property Lifecycle V2 IDs.
create function public.logbook_capture_buyer_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  client uuid;
  strong_new boolean;
  strong_old boolean;
  previous_status text;
begin
  strong_new := new.score >= 90 and new.classification = 'compatible';
  if tg_op = 'INSERT' then
    strong_old := false;
    previous_status := null;
  else
    strong_old := old.score >= 90 and old.classification = 'compatible';
    previous_status := old.status;
  end if;
  select r.client_id into client from public.property_requests r where r.id = new.request_id;
  if strong_new and not strong_old then
    insert into public.logbook_entries(event_category,event_type,source_type,
      request_id,client_id,title,note,metadata,automatic,dedupe_key,occurred_at)
    values ('INTELLIGENCE','buyer_match_found','buyer_match',new.request_id,client,
      'Abbinamento forte trovato',null,
      jsonb_build_object('portfolio_property_id',new.property_id,'score',new.score),
      true,'buyer-match:'||new.id||':strong',new.created_at)
    on conflict (dedupe_key) do nothing;
  end if;
  if new.status in ('proposed','interested','visit_scheduled','negotiation','completed')
    and new.status is distinct from previous_status then
    insert into public.logbook_entries(event_category,event_type,source_type,
      request_id,client_id,title,outcome,metadata,automatic,dedupe_key)
    values ('PIPELINE','buyer_match_status','buyer_match',new.request_id,client,
      'Abbinamento buyer aggiornato',new.status,
      jsonb_build_object('portfolio_property_id',new.property_id,'score',new.score),
      true,'buyer-match:'||new.id||':status:'||new.status)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger logbook_buyer_match after insert or update of score,classification,status
  on public.request_property_matches for each row
  execute function public.logbook_capture_buyer_match();

do $$ declare t text; begin
  foreach t in array array['logbook_entries','monthly_focus'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
      'authenticated read ' || t,t);
  end loop;
end $$;
-- These security-invoker views cross CRM tables that are deliberately not
-- exposed to the browser role. Private server pages authenticate first and
-- query them with the server-only service client.
grant select on public.property_requests,public.clients,public.properties,
  public.locations,public.buildings,public.events,public.publications,
  public.agencies,public.private_publications,public.request_property_matches,
  public.portfolio_properties,public.internal_zones,
  public.property_feature_values,public.feature_definitions
  to service_role;
-- 0001 was imported from a production schema without the default service
-- grants for the matching CRM. Fresh local projects need the same server
-- write capability used by the authenticated server actions.
grant select,insert,update,delete on public.clients,public.property_requests,
  public.portfolio_properties,public.request_property_matches,
  public.internal_zones,public.property_feature_values,
  public.feature_definitions,public.request_zones,
  public.request_feature_preferences,public.matching_activity_logs,
  public.app_settings
  to service_role;
revoke all on public.universal_logbook,public.monthly_focus_overview
  from public,anon,authenticated;
grant select on public.universal_logbook,public.monthly_focus_overview
  to service_role;
revoke all on function public.logbook_month_summary(date) from public,anon,authenticated;
grant execute on function public.logbook_month_summary(date) to service_role;
revoke all on function public.acquisition_stale(integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.acquisition_stale(integer,integer,integer) to service_role;
revoke all on function public.logbook_capture_buyer_match() from public,anon,authenticated;
grant execute on function public.logbook_capture_buyer_match() to service_role;

commit;
