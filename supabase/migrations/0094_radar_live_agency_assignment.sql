begin;
alter view public.radar_property_live_archive rename to radar_property_sale_archive;
do $$declare cols text;begin
 select string_agg(case a.attname
 when 'agency_role' then 'case when assignment.override_value->>''role''=''UNKNOWN'' then ''UNKNOWN'' when assigned.id is not null then ''OUR_AGENCY'' else b.agency_role end as agency_role'
 when 'agency_id' then 'coalesce(assigned.id,b.agency_id) as agency_id'
 when 'agency_name' then 'coalesce(assigned.name,b.agency_name) as agency_name'
 when 'agency_listing_id' then 'case when assigned.id is not null then null::uuid else b.agency_listing_id end as agency_listing_id'
 when 'opportunity_score' then 'case when assignment.override_value is not null or al.state=''CLOSED_SWITCHED'' then 0::numeric else b.opportunity_score end as opportunity_score'
 when 'state' then 'case when b.sale_status=''SOLD_CONFIRMED'' then b.state when assigned.id is not null then ''ACTIVE'' else coalesce(al.state,b.state) end as state'
 when 'exit_classification' then 'case when b.sale_status=''SOLD_CONFIRMED'' then b.exit_classification when assigned.id is not null then ''ACTIVE'' when al.state=''CLOSED_SWITCHED'' then ''AGENCY_CHANGED'' else b.exit_classification end as exit_classification'
 else format('b.%I',a.attname) end,',' order by a.attnum) into cols
 from pg_attribute a where a.attrelid='public.radar_property_sale_archive'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create view public.radar_property_live_archive with(security_invoker=true) as select '||cols||'
 from public.radar_property_sale_archive b
 left join public.agency_listings al on al.id=b.agency_listing_id
 left join lateral(select mo.override_value from public.manual_overrides mo
 where mo.target_type=''PROPERTY'' and mo.target_id=b.property_id and mo.override_key=''current_agency'' and mo.effective_at<=now()
 and not exists(select 1 from public.manual_overrides newer where newer.supersedes_id=mo.id)
 order by mo.effective_at desc,mo.created_at desc,mo.id desc limit 1) assignment on true
 left join public.agencies assigned on assigned.id=(assignment.override_value->>''agencyId'')::uuid and assigned.market_role=''OUR_AGENCY''';
end $$;
revoke all on public.radar_property_live_archive from public,anon;
grant select on public.radar_property_live_archive to authenticated,service_role;

create function public.record_radar_own_agency(p_property_id uuid,p_started_at date,p_reason text,p_created_by uuid,p_is_ours boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior uuid;decision uuid;agency record;at timestamptz:=clock_timestamp();
begin
 if p_is_ours is null then raise exception 'Agency assignment required';end if;
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_created_by is null or not exists(select 1 from auth.users where id=p_created_by) then raise exception 'Reviewer required';end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Reason required';end if;
 if p_started_at>current_date then raise exception 'Agency start cannot be in the future';end if;
 perform 1 from public.properties where id=p_property_id for update;
 if not found then raise exception 'Property not found';end if;
 if (select count(*) from public.agencies where market_role='OUR_AGENCY')<>1 then raise exception 'Choose the own agency branch before assigning';end if;
 select id,name into strict agency from public.agencies where market_role='OUR_AGENCY';
 select mo.id into prior from public.manual_overrides mo where mo.target_type='PROPERTY' and mo.target_id=p_property_id and mo.override_key='current_agency'
 and not exists(select 1 from public.manual_overrides newer where newer.supersedes_id=mo.id)
 order by mo.effective_at desc,mo.created_at desc,mo.id desc limit 1;
 insert into public.manual_overrides(target_type,target_id,override_key,override_value,reason,source,created_by,supersedes_id,effective_at)
 values('PROPERTY',p_property_id,'current_agency',jsonb_build_object('agencyId',case when p_is_ours then agency.id else null end,'agencyName',case when p_is_ours then agency.name else null end,'role',case when p_is_ours then 'OUR_AGENCY' else 'UNKNOWN' end,'startedAt',case when p_is_ours then p_started_at else null end),trim(p_reason),'RADAR_CONFIRMED_OWN_AGENCY',p_created_by,prior,at) returning id into decision;
 insert into public.events(property_id,event_type,occurred_at,confidence,actor_type,dedupe_key,payload)
 values(p_property_id,'MANUAL_OVERRIDE_RECORDED',at,1,'USER','manual-override:'||decision,
 jsonb_build_object('overrideId',decision,'key','current_agency','agencyId',case when p_is_ours then agency.id else null end,'role',case when p_is_ours then 'OUR_AGENCY' else 'UNKNOWN' end,'startedAt',case when p_is_ours then p_started_at else null end,'reason',trim(p_reason)));
 return decision;
end $$;
revoke all on function public.record_radar_own_agency(uuid,date,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_radar_own_agency(uuid,date,text,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
