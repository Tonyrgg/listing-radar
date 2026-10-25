-- Dedicated owner-private workbench. No changes to legacy listings or acquisition data.
begin;
create table public.seller_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check(kind in ('INBOUND','VERIFICATION')),
  external_id text not null check(length(external_id) between 1 and 200),
  signature text not null,
  title text not null check(length(title) between 1 and 300),
  submission jsonb not null default '{}'::jsonb,
  status text not null default 'NEW' check(status in
    ('NEW','IN_REVIEW','TO_CALL','CONTACTED','APPOINTMENT','VALUATION','MANDATE','NURTURE','CLOSED','DO_NOT_CONTACT')),
  next_action text not null check(next_action in ('VERIFY','CALL','FOLLOW_UP','VISIT','NONE')),
  next_action_at timestamptz,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,kind,external_id),
  check ((status in ('CLOSED','DO_NOT_CONTACT','MANDATE') and next_action='NONE' and next_action_at is null)
    or (status not in ('CLOSED','DO_NOT_CONTACT','MANDATE') and next_action<>'NONE' and next_action_at is not null)),
  check(kind='INBOUND' or next_action in ('VERIFY','NONE'))
);
create index seller_cases_queue on public.seller_cases(owner_id,next_action_at) where next_action<>'NONE';
create table public.seller_case_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.seller_cases(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  revision integer not null,
  status text not null,
  next_action text not null,
  next_action_at timestamptz,
  note text not null check(length(note) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(case_id,revision)
);
create table public.seller_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.seller_cases(id) on delete restrict,
  channel text not null check(channel in ('OPERATOR','WHATSAPP')),
  status text not null default 'BLOCKED' check(status in ('BLOCKED','SENT','CANCELLED')),
  reason text not null default 'PROVIDER_NOT_CONFIGURED',
  created_at timestamptz not null default now(),
  unique(case_id,channel)
);
alter table public.seller_cases enable row level security;
alter table public.seller_case_history enable row level security;
alter table public.seller_delivery_outbox enable row level security;
create policy seller_cases_owner on public.seller_cases for select to authenticated using(owner_id=auth.uid());
create policy seller_history_owner on public.seller_case_history for select to authenticated using
  (exists(select 1 from public.seller_cases c where c.id=case_id and c.owner_id=auth.uid()));
create policy seller_outbox_owner on public.seller_delivery_outbox for select to authenticated using
  (exists(select 1 from public.seller_cases c where c.id=case_id and c.owner_id=auth.uid()));
revoke all on public.seller_cases,public.seller_case_history,public.seller_delivery_outbox from anon,authenticated;
grant select on public.seller_cases,public.seller_case_history,public.seller_delivery_outbox to authenticated;
grant all on public.seller_cases,public.seller_case_history,public.seller_delivery_outbox to service_role;

create function public.receive_seller_submission(p_owner uuid,p_external text,p_signature text,p_submission jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.seller_cases; inserted_id uuid;
begin
  if p_submission->>'callbackRequested' is distinct from 'true'
    or coalesce(length(p_submission->>'name'),0) not between 1 and 160
    or coalesce(p_submission->>'phone','') !~ '^\+?[0-9]{8,15}$'
    or coalesce(length(p_submission->>'privacyVersion'),0) not between 1 and 80
    or coalesce(p_submission->>'formVersion','') <> 'seller_v1'
    or coalesce(p_submission->'answers'->>'locality','') not in ('Bitonto','Palombaio','Mariotto','Bitonto_other')
    or coalesce(p_submission->>'whatsappOptIn','') not in ('true','false')
    or length(p_submission::text)>12000 or p_signature !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid submission' using errcode='22023'; end if;
  insert into public.seller_cases(owner_id,kind,external_id,signature,title,submission,next_action,next_action_at)
    values(p_owner,'INBOUND',p_external,p_signature,'Richiesta di confronto — '||(p_submission->'answers'->>'locality'),p_submission,'CALL',now())
    on conflict(owner_id,kind,external_id) do nothing returning id into inserted_id;
  select * into strict c from public.seller_cases where owner_id=p_owner and kind='INBOUND' and external_id=p_external for update;
  if c.signature<>p_signature then raise exception 'Conflicting replay' using errcode='23505'; end if;
  if inserted_id is not null then
    insert into public.seller_case_history(case_id,actor_id,revision,status,next_action,next_action_at,note)
      values(c.id,p_owner,0,'NEW','CALL',c.next_action_at,'Richiesta ricevuta; recapito e ruolo ancora da verificare.');
    insert into public.seller_delivery_outbox(case_id,channel) values(c.id,'OPERATOR');
    if p_submission->>'whatsappOptIn'='true' then
      insert into public.seller_delivery_outbox(case_id,channel) values(c.id,'WHATSAPP');
    end if;
  end if;
  return jsonb_build_object('id',c.id,'duplicate',inserted_id is null);
end $$;
revoke all on function public.receive_seller_submission(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.receive_seller_submission(uuid,text,text,jsonb) to service_role;

create function public.plan_seller_verification(p_external text,p_signature text,p_title text,p_context jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
  if p_external !~ '^news:[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' then
    raise exception 'Invalid candidate'; end if;
  perform public.assert_public_news_candidate(substring(p_external from 6)::uuid);
  if not exists(select 1 from public.public_record_news_feedback where
    candidate_id=substring(p_external from 6)::uuid and user_id=auth.uid()
    and status='INTERESTING' and source_signature=p_signature) then
    raise exception 'Review changed; reload the candidate' using errcode='40001'; end if;
  if length(p_context::text)>12000 then raise exception 'Context too large'; end if;
  insert into public.seller_cases(owner_id,kind,external_id,signature,title,submission,next_action,next_action_at)
    values(auth.uid(),'VERIFICATION',p_external,p_signature,p_title,p_context,'VERIFY',now())
    on conflict(owner_id,kind,external_id) do nothing returning id into result;
  if result is null then
    select id into strict result from public.seller_cases where owner_id=auth.uid() and kind='VERIFICATION' and external_id=p_external;
  else
    insert into public.seller_case_history(case_id,actor_id,revision,status,next_action,next_action_at,note)
      values(result,auth.uid(),0,'NEW','VERIFY',now(),'Verifica pianificata esplicitamente; nessun venditore o recapito inferito.');
  end if;
  return result;
end $$;
revoke all on function public.plan_seller_verification(text,text,text,jsonb) from public,anon;
grant execute on function public.plan_seller_verification(text,text,text,jsonb) to authenticated;

create function public.review_seller_case(p_id uuid,p_revision integer,p_status text,p_action text,p_at timestamptz,p_note text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.seller_cases;
begin
  select * into c from public.seller_cases where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Case not available' using errcode='42501'; end if;
  if c.revision<>p_revision then raise exception 'Reload case' using errcode='40001'; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Outcome required'; end if;
  if c.status='DO_NOT_CONTACT' and p_status<>'DO_NOT_CONTACT' then raise exception 'Contact suppression is permanent in this workflow'; end if;
  if c.kind='VERIFICATION' and p_status not in ('NEW','IN_REVIEW','CLOSED','DO_NOT_CONTACT') then
    raise exception 'A document review is not a commercial contact'; end if;
  update public.seller_cases set status=p_status,next_action=p_action,next_action_at=p_at,
    revision=revision+1,updated_at=now() where id=c.id returning * into c;
  insert into public.seller_case_history(case_id,actor_id,revision,status,next_action,next_action_at,note)
    values(c.id,auth.uid(),c.revision,p_status,p_action,p_at,trim(p_note));
  if p_status in ('CLOSED','DO_NOT_CONTACT','MANDATE') then
    update public.seller_delivery_outbox set status='CANCELLED',reason='CASE_CLOSED' where case_id=c.id and status='BLOCKED';
  end if;
  return c.revision;
end $$;
revoke all on function public.review_seller_case(uuid,integer,text,text,timestamptz,text) from public,anon;
grant execute on function public.review_seller_case(uuid,integer,text,text,timestamptz,text) to authenticated;

create function public.seller_workbench_metrics() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'received',(select count(*) from seller_cases where kind='INBOUND'),
    'verifications',(select count(*) from seller_cases where kind='VERIFICATION'),
    'contacted',(select count(distinct h.case_id) from seller_case_history h join seller_cases c on c.id=h.case_id where c.kind='INBOUND' and h.status='CONTACTED'),
    'appointments',(select count(distinct h.case_id) from seller_case_history h join seller_cases c on c.id=h.case_id where c.kind='INBOUND' and h.status='APPOINTMENT'),
    'valuations',(select count(distinct h.case_id) from seller_case_history h join seller_cases c on c.id=h.case_id where c.kind='INBOUND' and h.status='VALUATION'),
    'mandates',(select count(distinct h.case_id) from seller_case_history h join seller_cases c on c.id=h.case_id where c.kind='INBOUND' and h.status='MANDATE')
  )
$$;
revoke all on function public.seller_workbench_metrics() from public,anon;
grant execute on function public.seller_workbench_metrics() to authenticated;
commit;
