-- Local-only outcome separation and attributed, cumulative operator-recorded metrics.
begin;
alter table public.seller_cases drop constraint seller_cases_status_check;
alter table public.seller_cases add constraint seller_cases_status_check check(status in
 ('NEW','IN_REVIEW','TO_CALL','CONTACTED','APPOINTMENT','APPOINTMENT_HELD','VALUATION','MANDATE','NURTURE','CLOSED','DO_NOT_CONTACT'));
create or replace function public.seller_workbench_metrics() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 with outcomes as (
  select c.id,coalesce(nullif(c.submission#>>'{attribution,source}',''),'UNKNOWN') as source,
   nullif(c.submission#>>'{attribution,campaignId}','') as campaign,
   exists(select 1 from seller_case_history h where h.case_id=c.id and h.status='CONTACTED') as contacted,
   exists(select 1 from seller_case_history h where h.case_id=c.id and h.status='APPOINTMENT') as appointment,
   exists(select 1 from seller_case_history h where h.case_id=c.id and h.status='APPOINTMENT_HELD') as held,
   exists(select 1 from seller_case_history h where h.case_id=c.id and h.status='VALUATION') as valued,
   exists(select 1 from seller_case_history h where h.case_id=c.id and h.status='MANDATE') as mandate
  from seller_cases c where c.kind='INBOUND'
 ), grouped as (
  select source,campaign,count(*) received,count(*) filter(where contacted) contacted,
   count(*) filter(where appointment) appointments,count(*) filter(where held) held,
   count(*) filter(where valued) valuations,count(*) filter(where mandate) mandates
  from outcomes group by source,campaign
 )
 select jsonb_build_object(
  'received',(select count(*) from outcomes),
  'verifications',(select count(*) from seller_cases where kind='VERIFICATION'),
  'contacted',(select count(*) from outcomes where contacted),
  'appointments',(select count(*) from outcomes where appointment),
  'appointmentsHeld',(select count(*) from outcomes where held),
  'valuations',(select count(*) from outcomes where valued),
  'mandates',(select count(*) from outcomes where mandate),
  'bySource',coalesce((select jsonb_agg(jsonb_build_object(
   'module',case when source in ('meta_form','local_test') then 'VAB' else 'UNKNOWN' end,
   'source',source,'campaignId',campaign,'received',received,'contacted',contacted,
   'appointments',appointments,'appointmentsHeld',held,'valuations',valuations,'mandates',mandates
  ) order by source,campaign nulls first) from grouped),'[]'::jsonb)
 )
$$;
commit;
