begin;
alter table public.seller_delivery_outbox drop constraint seller_delivery_outbox_status_check;
alter table public.seller_delivery_outbox add constraint seller_delivery_outbox_status_check check(status in ('BLOCKED','PENDING','CLAIMED','RETRY','SENT','FAILED','CANCELLED'));
alter table public.seller_delivery_outbox add column provider text not null default 'MOCK' check(provider='MOCK'),
 add column mock_enabled boolean not null default false,add column attempts integer not null default 0 check(attempts between 0 and 3),
 add column lease_token uuid,add column lease_until timestamptz,add column next_attempt_at timestamptz not null default now(),
 add column delivered_at timestamptz;
create table public.seller_channel_suppressions (
 case_id uuid not null references seller_cases(id),channel text not null check(channel in ('OPERATOR','WHATSAPP')),
 actor_id uuid not null references auth.users(id),note text not null check(length(trim(note)) between 1 and 2000),
 created_at timestamptz not null default now(),primary key(case_id,channel)
);
create table public.seller_mock_receipts (
 id uuid primary key default gen_random_uuid(),outbox_id uuid not null unique references seller_delivery_outbox(id),
 created_at timestamptz not null default now()
);
alter table seller_channel_suppressions enable row level security;
alter table seller_mock_receipts enable row level security;
create policy seller_suppression_owner on seller_channel_suppressions for select to authenticated using
 (exists(select 1 from seller_cases c where c.id=case_id and c.owner_id=auth.uid()));
create policy seller_mock_receipt_owner on seller_mock_receipts for select to authenticated using
 (exists(select 1 from seller_delivery_outbox o join seller_cases c on c.id=o.case_id where o.id=outbox_id and c.owner_id=auth.uid()));
revoke all on seller_channel_suppressions,seller_mock_receipts from anon,authenticated;
grant select on seller_channel_suppressions,seller_mock_receipts to authenticated;
grant all on seller_channel_suppressions,seller_mock_receipts to service_role;
create function public.suppress_seller_channel(p_case uuid,p_channel text,p_note text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from seller_cases where id=p_case and owner_id=auth.uid() for update;
 if not found then raise exception 'Case not available' using errcode='42501';end if;
 insert into seller_channel_suppressions(case_id,channel,actor_id,note) values(p_case,p_channel,auth.uid(),trim(p_note)) on conflict do nothing;
 update seller_delivery_outbox set status='CANCELLED',reason='CHANNEL_SUPPRESSED',lease_token=null,lease_until=null
 where case_id=p_case and channel=p_channel and status in ('BLOCKED','PENDING','RETRY','CLAIMED');
end $$;
create or replace function public.review_seller_case(p_id uuid,p_revision integer,p_status text,p_action text,p_at timestamptz,p_note text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare c seller_cases;
begin
 select * into c from seller_cases where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Case not available' using errcode='42501';end if;
 if c.revision<>p_revision then raise exception 'Reload case' using errcode='40001';end if;
 if p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Outcome required';end if;
 if c.status='DO_NOT_CONTACT' and p_status is distinct from 'DO_NOT_CONTACT' then raise exception 'Contact suppression is permanent in this workflow';end if;
 if c.kind='VERIFICATION' and p_status not in ('NEW','IN_REVIEW','CLOSED','DO_NOT_CONTACT') then raise exception 'A document review is not a commercial contact';end if;
 update seller_cases set status=p_status,next_action=p_action,next_action_at=p_at,revision=revision+1,updated_at=now() where id=c.id returning * into c;
 insert into seller_case_history(case_id,actor_id,revision,status,next_action,next_action_at,note) values(c.id,auth.uid(),c.revision,p_status,p_action,p_at,trim(p_note));
 if p_status in ('CLOSED','DO_NOT_CONTACT','MANDATE') then
  update seller_delivery_outbox set status='CANCELLED',reason='CASE_CLOSED',lease_token=null,lease_until=null
  where case_id=c.id and status in ('BLOCKED','PENDING','RETRY','CLAIMED');
 end if;
 return c.revision;
end $$;
create function public.enable_seller_mock_deliveries(p_owner uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 update seller_delivery_outbox o set status='PENDING',mock_enabled=true,reason='LOCAL_MOCK_ONLY'
 from seller_cases c where c.id=o.case_id and c.owner_id=p_owner and c.kind='INBOUND'
 and c.status not in ('CLOSED','DO_NOT_CONTACT','MANDATE') and o.status='BLOCKED'
 and (o.channel='OPERATOR' or c.submission->>'whatsappOptIn'='true')
 and not exists(select 1 from seller_channel_suppressions s where s.case_id=c.id and s.channel=o.channel);
 get diagnostics n=row_count;return n;
end $$;
create function public.claim_seller_mock_delivery(p_owner uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o seller_delivery_outbox;
begin
 update seller_delivery_outbox q set status='CANCELLED',reason='NOT_ELIGIBLE',lease_token=null,lease_until=null
 from seller_cases c where c.id=q.case_id and c.owner_id=p_owner and q.status in ('PENDING','CLAIMED','RETRY') and
 (c.status in ('CLOSED','DO_NOT_CONTACT','MANDATE') or (q.channel='WHATSAPP' and c.submission->>'whatsappOptIn' is distinct from 'true')
 or exists(select 1 from seller_channel_suppressions s where s.case_id=c.id and s.channel=q.channel));
 update seller_delivery_outbox q set status='FAILED',reason='ATTEMPTS_EXHAUSTED',lease_token=null,lease_until=null
 from seller_cases c where c.id=q.case_id and c.owner_id=p_owner and q.status='CLAIMED' and q.lease_until<now() and q.attempts>=3;
 select q.* into o from seller_delivery_outbox q join seller_cases c on c.id=q.case_id
 where c.owner_id=p_owner and q.mock_enabled and q.attempts<3 and q.next_attempt_at<=now()
 and (q.status in ('PENDING','RETRY') or (q.status='CLAIMED' and q.lease_until<now()))
 order by q.created_at,q.id for update of q skip locked limit 1;
 if not found then return null;end if;
 update seller_delivery_outbox set status='CLAIMED',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute'
 where id=o.id returning * into o;
 return jsonb_build_object('id',o.id,'token',o.lease_token,'channel',o.channel,'attempt',o.attempts,'provider','MOCK');
end $$;
create function public.fail_seller_mock_delivery(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update seller_delivery_outbox set status=case when attempts>=3 then 'FAILED' else 'RETRY' end,
 reason='SIMULATED_TRANSPORT_FAILURE',next_attempt_at=now()+make_interval(secs=>attempts*30),lease_token=null,lease_until=null
 where id=p_id and status='CLAIMED' and lease_token=p_token and lease_until>=now();
 if not found then raise exception 'Claim no longer current' using errcode='40001';end if;
end $$;
create function public.deliver_seller_mock(p_id uuid,p_token uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare o seller_delivery_outbox;c seller_cases;r uuid;
begin
 -- Same lock order as closure/suppression: case first, outbox second.
 select c0.* into c from seller_cases c0 join seller_delivery_outbox q on q.case_id=c0.id where q.id=p_id for update of c0;
 if not found then raise exception 'Delivery not available';end if;
 select * into strict o from seller_delivery_outbox where id=p_id for update;
 if o.status='SENT' then select id into strict r from seller_mock_receipts where outbox_id=o.id;return r;end if;
 if o.status<>'CLAIMED' or o.lease_token is distinct from p_token or o.lease_until<now() or not o.mock_enabled
  then raise exception 'Claim no longer current' using errcode='40001';end if;
 if c.status in ('CLOSED','DO_NOT_CONTACT','MANDATE') or (o.channel='WHATSAPP' and c.submission->>'whatsappOptIn' is distinct from 'true')
  or exists(select 1 from seller_channel_suppressions s where s.case_id=c.id and s.channel=o.channel) then
  update seller_delivery_outbox set status='CANCELLED',reason='NOT_ELIGIBLE',lease_token=null,lease_until=null where id=o.id;return null;
 end if;
 insert into seller_mock_receipts(outbox_id) values(o.id) on conflict(outbox_id) do nothing;
 select id into strict r from seller_mock_receipts where outbox_id=o.id;
 update seller_delivery_outbox set status='SENT',reason='LOCAL_MOCK_CONFIRMED',delivered_at=now(),lease_token=null,lease_until=null where id=o.id;
 return r;
end $$;
revoke all on function public.suppress_seller_channel(uuid,text,text) from public,anon;
grant execute on function public.suppress_seller_channel(uuid,text,text) to authenticated;
revoke all on function public.enable_seller_mock_deliveries(uuid),public.claim_seller_mock_delivery(uuid),public.fail_seller_mock_delivery(uuid,uuid),public.deliver_seller_mock(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enable_seller_mock_deliveries(uuid),public.claim_seller_mock_delivery(uuid),public.fail_seller_mock_delivery(uuid,uuid),public.deliver_seller_mock(uuid,uuid) to service_role;
commit;
