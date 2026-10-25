begin;
create table public.tonybook_signals (
 owner_id uuid not null references auth.users(id),id text not null check(id~'^S[0-9]{3,6}$'),
 state text not null check(state in ('ACTIVE','REJECTED','UNKNOWN')),
 reference jsonb not null check(valid_seller_reference(reference) and reference->>'module'='TONYBOOK' and reference->>'sourceType'='local_registry'),
 fact text not null check(length(trim(fact)) between 1 and 2000),
 unknowns text not null check(length(unknowns)<=2000),
 signature text not null check(signature~'^[a-f0-9]{64}$'),
 revision integer not null default 0,updated_at timestamptz not null default now(),
 primary key(owner_id,id),check(reference->>'sourceId'=id)
);
alter table public.tonybook_signals enable row level security;
create policy tonybook_owner on public.tonybook_signals for select to authenticated using(owner_id=auth.uid());
revoke all on public.tonybook_signals from anon,authenticated;
grant select on public.tonybook_signals to authenticated;
grant all on public.tonybook_signals to service_role;
create function public.register_tonybook_signal(p_id text,p_state text,p_reference jsonb,p_fact text,p_unknowns text,p_signature text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r tonybook_signals;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 -- Serialize inserts and changes for one owner/signal, including a first-import race.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||coalesce(p_id,''),0));
 select * into r from tonybook_signals where owner_id=auth.uid() and id=p_id for update;
 if found then
  if r.state='REJECTED' and p_state is distinct from 'REJECTED' then raise exception 'Rejected signal cannot be reopened';end if;
  if r.signature=p_signature then
   if r.state is distinct from p_state or r.reference is distinct from p_reference or r.fact is distinct from trim(p_fact) or r.unknowns is distinct from p_unknowns
    then raise exception 'Conflicting replay' using errcode='23505';end if;
   return r.revision;
  end if;
  update tonybook_signals set state=p_state,reference=p_reference,fact=trim(p_fact),unknowns=p_unknowns,signature=p_signature,
   revision=revision+1,updated_at=now() where owner_id=auth.uid() and id=p_id returning * into r;
 else
  insert into tonybook_signals(owner_id,id,state,reference,fact,unknowns,signature)
   values(auth.uid(),p_id,p_state,p_reference,trim(p_fact),p_unknowns,p_signature) returning * into r;
 end if;
 return r.revision;
end $$;
create function public.plan_tonybook_verification(p_id text,p_signature text,p_confirmed boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s tonybook_signals;v uuid;ext text;created boolean;
begin
 select * into s from tonybook_signals where owner_id=auth.uid() and id=p_id for update;
 if not found then raise exception 'Signal not available' using errcode='42501';end if;
 if s.state<>'ACTIVE' or p_confirmed is distinct from true then raise exception 'Explicit selection of an active signal required';end if;
 if s.signature is distinct from p_signature then raise exception 'Evidence changed; review again' using errcode='40001';end if;
 ext='tonybook:'||s.id||':'||s.signature;
 insert into seller_cases(owner_id,kind,external_id,signature,title,submission,next_action,next_action_at)
 values(auth.uid(),'VERIFICATION',ext,s.signature,'Segnale TonyBook '||s.id,
  jsonb_build_object('signalId',s.id,'sourceUrl',s.reference->>'sourceUrl','fact',s.fact,'unknown',s.unknowns),'VERIFY',now())
 on conflict(owner_id,kind,external_id) do nothing returning id into v;
 created=v is not null;
 if not created then select id into strict v from seller_cases where owner_id=auth.uid() and kind='VERIFICATION' and external_id=ext;end if;
 if created then
  insert into seller_case_history(case_id,actor_id,revision,status,next_action,next_action_at,note)
   values(v,auth.uid(),0,'NEW','VERIFY',now(),'Segnale selezionato esplicitamente; nessun proprietario o ricontatto dedotto.');
  perform attach_seller_case_source(v,s.reference);
 end if;
 return v;
end $$;
revoke all on function public.register_tonybook_signal(text,text,jsonb,text,text,text),public.plan_tonybook_verification(text,text,boolean) from public,anon;
grant execute on function public.register_tonybook_signal(text,text,jsonb,text,text,text),public.plan_tonybook_verification(text,text,boolean) to authenticated;
commit;
