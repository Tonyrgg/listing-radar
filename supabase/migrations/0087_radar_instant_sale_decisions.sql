begin;
-- A lightweight live overlay keeps manual decisions immediately visible without
-- rebuilding the complete materialized graph or altering source observations.
do $$declare cols text;begin
 select string_agg(case a.attname
 when 'sale_status' then 'coalesce(m.status,p.sale_status) as sale_status'
 when 'property_state' then 'case when coalesce(m.status,p.sale_status)=''SOLD_CONFIRMED'' then ''SOLD'' else p.property_state end as property_state'
 when 'state' then 'case when x.classification=''SOLD_CONFIRMED'' then ''CLOSED_SOLD'' when m.status in (''NOT_SOLD_CONFIRMED'',''UNKNOWN'') and b.state=''CLOSED_SOLD'' then case when p.property_state like ''ACTIVE%'' then ''ACTIVE'' else ''OFF_MARKET_NO_SALE_EVIDENCE'' end else b.state end as state'
 when 'exit_classification' then 'x.classification as exit_classification'
 when 'opportunity_score' then 'case when x.classification in (''SOLD_CONFIRMED'',''SOLD_PROBABLE'') then 0::numeric else b.opportunity_score end as opportunity_score'
 when 'sold_at' then 'case when m.status is not null then null::timestamptz else b.sold_at end as sold_at'
 when 'sold_observed_at' then 'case when m.status=''SOLD_CONFIRMED'' then m.effective_at when m.status is not null then null::timestamptz else b.sold_observed_at end as sold_observed_at'
 when 'classified_at' then 'coalesce(m.effective_at,b.classified_at) as classified_at'
 when 'exit_confidence' then 'case when m.status=''SOLD_CONFIRMED'' then 1::numeric else b.exit_confidence end as exit_confidence'
 when 'reasons' then 'case when m.status=''SOLD_CONFIRMED'' then b.reasons || ''["manual_sale_confirmed"]''::jsonb else b.reasons end as reasons'
 else format('b.%I',a.attname) end,',' order by a.attnum) into cols
 from pg_attribute a where a.attrelid='public.radar_property_read_model'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create view public.radar_property_live_archive with(security_invoker=true) as select '||cols||'
 from public.radar_property_read_model b join public.properties p on p.id=b.property_id
 left join lateral(select mo.override_value #>> ''{}'' as status,mo.effective_at from public.manual_overrides mo
 where mo.target_type=''PROPERTY'' and mo.target_id=p.id and mo.override_key=''sale_status'' and mo.effective_at<=now()
 and not exists(select 1 from public.manual_overrides newer where newer.supersedes_id=mo.id)
 order by mo.effective_at desc,mo.created_at desc,mo.id desc limit 1) m on true
 cross join lateral(select case
 when coalesce(m.status,p.sale_status)=''SOLD_CONFIRMED'' then ''SOLD_CONFIRMED''
 when m.status in (''NOT_SOLD_CONFIRMED'',''UNKNOWN'') and b.exit_classification in (''SOLD_CONFIRMED'',''SOLD_PROBABLE'')
 then case when p.property_state like ''ACTIVE%'' then ''ACTIVE'' else ''UNKNOWN_EXIT'' end
 else b.exit_classification end as classification) x';
end $$;
revoke all on public.radar_property_live_archive from public,anon;
grant select on public.radar_property_live_archive to authenticated,service_role;

create function public.record_radar_sale_decision(p_property_id uuid,p_status text,p_reason text,p_created_by uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare pr record;prior uuid;decision uuid;at timestamptz:=clock_timestamp();active_agencies integer;active_private boolean;next_property_state text;
begin
 if p_status not in ('SOLD_CONFIRMED','NOT_SOLD_CONFIRMED','UNKNOWN') or p_status is null then raise exception 'Unsupported sale status';end if;
 if p_created_by is null or not exists(select 1 from auth.users where id=p_created_by) then raise exception 'Reviewer required';end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Reason required (maximum 2000 characters)';end if;
 select * into strict pr from public.properties where id=p_property_id for update;
 select id into prior from public.manual_overrides where target_type='PROPERTY' and target_id=p_property_id and override_key='sale_status'
 and effective_at<=at and not exists(select 1 from public.manual_overrides n where n.supersedes_id=manual_overrides.id)
 order by effective_at desc,created_at desc,id desc limit 1;
 insert into public.manual_overrides(target_type,target_id,override_key,override_value,previous_value,reason,source,created_by,supersedes_id,effective_at)
 values('PROPERTY',p_property_id,'sale_status',to_jsonb(p_status),to_jsonb(pr.sale_status),trim(p_reason),'RADAR_QUICK_SALE_DECISION',p_created_by,prior,at) returning id into decision;
 select count(distinct agency_id) into active_agencies from public.agency_listings where property_id=p_property_id and state='ACTIVE';
 select exists(select 1 from public.private_publications where property_id=p_property_id and state='ACTIVE') into active_private;
 next_property_state:=case when p_status='SOLD_CONFIRMED' then 'SOLD'
 when active_agencies>0 and active_private then 'ACTIVE_AGENCY_AND_PRIVATE'
 when active_agencies>1 then 'ACTIVE_MULTI_AGENCY' when active_agencies=1 then 'ACTIVE_AGENCY'
 when active_private then 'ACTIVE_PRIVATE' else 'OFF_MARKET_UNKNOWN' end;
 update public.properties set sale_status=p_status,property_state=next_property_state where id=p_property_id;
 insert into public.events(property_id,event_type,occurred_at,confidence,actor_type,dedupe_key,payload)
 values(p_property_id,'MANUAL_OVERRIDE_RECORDED',at,1,'USER','manual-override:'||decision,
 jsonb_build_object('overrideId',decision,'key','sale_status','previousValue',pr.sale_status,'newValue',p_status,'reason',trim(p_reason),'source','RADAR_QUICK_SALE_DECISION','saleDateKnown',false));
 return decision;
end $$;
revoke all on function public.record_radar_sale_decision(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_radar_sale_decision(uuid,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
