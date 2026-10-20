begin;

-- Review workflow only: candidate identity is the existing administrative record.
-- No document copy, property, commercial transition or acquisition signal.
create table public.public_record_news_feedback (
 candidate_id uuid not null references public.building_practice_records(id),
 user_id uuid not null references auth.users(id),
 decision text check(decision in ('INTERESTING','DEEPEN','NOT_USEFUL')),
 reason text check(reason in ('NOT_TOWARD_SALE','TOO_GENERIC','COMMON_PART','IRRELEVANT_USE_CHANGE','TOO_IMPRECISE','ALREADY_KNOWN','OTHER')),
 status text not null default 'NEW' check(status in ('NEW','INTERESTING','DEEPENING','ENRICHED','NOT_USEFUL','ARCHIVED')),
 policy_version text not null default 'news_triage_v1',
 event_type text not null,
 source_signature text not null,
 revision integer not null default 0,
 first_shown_at timestamptz, last_shown_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 history jsonb not null default '[]', enrichment jsonb,
 primary key(candidate_id,user_id),
 check(reason is null or decision='NOT_USEFUL'),
 check(jsonb_typeof(history)='array'),
 check(enrichment is null or (jsonb_typeof(enrichment)='object' and octet_length(enrichment::text)<=80000))
);
alter table public.public_record_news_feedback enable row level security;
create policy news_feedback_own_read on public.public_record_news_feedback for select to authenticated using(user_id=auth.uid());
revoke all on public.public_record_news_feedback from anon,authenticated;
grant select on public.public_record_news_feedback to authenticated;
grant all on public.public_record_news_feedback to service_role;

-- The database enforces administrative dates independently of the web filter.
create function public.assert_public_news_candidate(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public_record_territorial_resolutions d
  join building_practice_records r on r.id=d.record_id and r.content_hash=d.input_hash and r.content_hash=d.semantic_input_hash
  cross join lateral jsonb_array_elements(d.semantic_projection->'events') e where d.record_id=p_id
  and coalesce(r.source_status,'') !~* 'revoc|annull|revoke|cancel'
  and coalesce(e->>'document_date',e->>'event_date')>='2026-01-01'
  and coalesce(e->>'document_date',e->>'event_date')<=(now() at time zone 'Europe/Rome')::date::text)
 then raise exception 'No current 2026 evidence';end if;
end $$;
revoke all on function public.assert_public_news_candidate(uuid) from public,anon,authenticated;

create function public.observe_public_news(p_id uuid,p_event_type text,p_signature text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform assert_public_news_candidate(p_id);
 if length(p_signature)>20000 or length(p_event_type)>100 then raise exception 'Invalid news input'; end if;
 insert into public_record_news_feedback(candidate_id,user_id,event_type,source_signature,first_shown_at,last_shown_at)
 values(p_id,auth.uid(),p_event_type,p_signature,now(),now())
 on conflict(candidate_id,user_id) do update set
 first_shown_at=coalesce(public_record_news_feedback.first_shown_at,excluded.first_shown_at),last_shown_at=now();
end $$;

create function public.review_public_news(p_id uuid,p_decision text,p_reason text,p_revision integer,p_event_type text,p_signature text)
returns public.public_record_news_feedback language plpgsql security definer set search_path=public,pg_temp as $$
declare f public_record_news_feedback;begin
 perform assert_public_news_candidate(p_id);
 if p_decision not in ('INTERESTING','DEEPEN','NOT_USEFUL') or p_decision is null or p_revision is null
  or length(p_signature)>20000 or length(p_event_type)>100 then raise exception 'Invalid news decision';end if;
 insert into public_record_news_feedback(candidate_id,user_id,event_type,source_signature)
 values(p_id,auth.uid(),p_event_type,p_signature) on conflict do nothing;
 select * into f from public_record_news_feedback where candidate_id=p_id and user_id=auth.uid() for update;
 if f.revision<>p_revision then raise exception 'Review changed; reload';end if;
 update public_record_news_feedback set decision=p_decision,reason=case when p_decision='NOT_USEFUL' then p_reason else null end,
  status=case p_decision when 'DEEPEN' then 'DEEPENING' when 'NOT_USEFUL' then 'NOT_USEFUL' else 'INTERESTING' end,
  policy_version='news_triage_v1',event_type=p_event_type,source_signature=p_signature,
  revision=revision+1,updated_at=now(),
  history=history||jsonb_build_array(jsonb_build_object('decision',p_decision,'reason',p_reason,'at',now(),'policy','news_triage_v1'))
 where candidate_id=p_id and user_id=auth.uid() returning * into f;
 return f;
end $$;

create function public.complete_public_news_deepening(p_id uuid,p_revision integer,p_enrichment jsonb)
returns public.public_record_news_feedback language plpgsql security definer set search_path=public,pg_temp as $$
declare f public_record_news_feedback;begin
 perform assert_public_news_candidate(p_id);
 if p_enrichment is null or jsonb_typeof(p_enrichment)<>'object' or octet_length(p_enrichment::text)>80000 then raise exception 'Invalid enrichment';end if;
 select * into f from public_record_news_feedback where candidate_id=p_id and user_id=auth.uid() for update;
 if not found or f.decision<>'DEEPEN' or f.revision<>p_revision then raise exception 'Review changed; enrichment not applied';end if;
 update public_record_news_feedback set enrichment=p_enrichment,status='ENRICHED',updated_at=now(),revision=revision+1
 where candidate_id=p_id and user_id=auth.uid() returning * into f;return f;
end $$;
revoke all on function public.observe_public_news(uuid,text,text),public.review_public_news(uuid,text,text,integer,text,text),public.complete_public_news_deepening(uuid,integer,jsonb) from public,anon;
grant execute on function public.observe_public_news(uuid,text,text),public.review_public_news(uuid,text,text,integer,text,text),public.complete_public_news_deepening(uuid,integer,jsonb) to authenticated;

create view public.public_record_news_feedback_stats with(security_invoker=true) as
 select event_type,count(*) filter(where first_shown_at is not null) shown,
 count(*) filter(where decision='INTERESTING') interesting,
 count(*) filter(where history @> '[{"decision":"DEEPEN"}]') deepened,
 count(*) filter(where decision='NOT_USEFUL') rejected,
 coalesce(jsonb_agg(reason) filter(where decision='NOT_USEFUL' and reason is not null),'[]') reasons
 from public_record_news_feedback group by event_type;
grant select on public.public_record_news_feedback_stats to authenticated,service_role;
notify pgrst,'reload schema';
commit;
