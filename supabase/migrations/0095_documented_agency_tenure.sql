begin;
create function public.radar_evidence_date(v text) returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then return null;end if;
 return v::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
create view public.radar_agency_tenure with(security_invoker=true) as
select al.id agency_listing_id,chosen.started_at agency_started_at,chosen.source agency_start_source,chosen.url agency_start_url,coalesce(chosen.exact,false) agency_start_exact
from public.agency_listings al
left join lateral(
 select candidate.* from (
  select al.estimated_acquisition_at started_at,'CONFIRMED_ACQUISITION'::text source,e.source_url url,true exact,0 priority
  from public.evidence e where e.id=al.acquisition_evidence_id and al.estimated_acquisition_at is not null
  union all
  select p.portal_published_at,'PORTAL_PUBLICATION',p.canonical_url,false,1 from public.publications p
  where p.agency_listing_id=al.id and p.portal_published_at is not null
  union all
  select public.radar_evidence_date(coalesce(e.normalized_value->>'lowerBound',e.normalized_value->>'upperBound',case when jsonb_typeof(e.normalized_value)='string' then e.normalized_value#>>'{}' end)),
   e.extraction_method,e.source_url,false,1
  from public.publications p join public.evidence e on e.publication_id=p.id
  where p.agency_listing_id=al.id and e.claim_key in ('publication.datePublished','publication.articlePublishedDate','publication.publishUp','publication.sourceRecordCreatedAt')
 ) candidate where candidate.started_at<=now()
 order by candidate.priority,candidate.started_at,candidate.source,candidate.url limit 1
) chosen on true;
revoke all on public.radar_agency_tenure from public,anon;
grant select on public.radar_agency_tenure to authenticated,service_role;

alter view public.radar_property_live_archive rename to radar_property_agency_archive;
create view public.radar_property_live_archive with(security_invoker=true) as
select b.*,date_source.started_at agency_started_at,date_source.source agency_start_source,date_source.url agency_start_url,date_source.exact agency_start_exact,
 case when date_source.started_at<=coalesce(b.sold_at,b.sold_observed_at,case when b.state<>'ACTIVE' then b.last_seen_at end,now()) then floor(extract(epoch from(coalesce(b.sold_at,b.sold_observed_at,case when b.state<>'ACTIVE' then b.last_seen_at end,now())-date_source.started_at))/86400)::integer end days_with_agency
from public.radar_property_agency_archive b
left join public.radar_agency_tenure tenure on tenure.agency_listing_id=b.agency_listing_id
left join lateral(select mo.override_value from public.manual_overrides mo where mo.target_type='PROPERTY' and mo.target_id=b.property_id and mo.override_key='current_agency' and mo.effective_at<=now()
 and not exists(select 1 from public.manual_overrides n where n.supersedes_id=mo.id) order by mo.effective_at desc,mo.created_at desc,mo.id desc limit 1) assignment on true
cross join lateral(select
 case when assignment.override_value is not null then public.radar_evidence_date(assignment.override_value->>'startedAt') else tenure.agency_started_at end started_at,
 case when assignment.override_value is not null then 'MANUAL_CONFIRMATION' else tenure.agency_start_source end source,
 case when assignment.override_value is not null then null::text else tenure.agency_start_url end url,
 case when assignment.override_value is not null then true else tenure.agency_start_exact end exact
) date_source;
revoke all on public.radar_property_live_archive from public,anon;
grant select on public.radar_property_live_archive to authenticated,service_role;
notify pgrst,'reload schema';
commit;
