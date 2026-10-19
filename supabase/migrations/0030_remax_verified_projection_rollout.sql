-- Stage 2: interpret validated primary evidence. No inventory or missing rollout.
begin;
do $$ begin
 if not exists(select 1 from public.market_observer_source_runs
  where source_key='REMAX' and state='HEALTHY' and finished_at is not null
   and detail_fetch_count>0 and not absence_evaluation_allowed) then
  raise exception 'Healthy known-publication verifier run required';
 end if;
 if not exists(select 1 from public.evidence e join public.publications p on p.id=e.publication_id
  join public.market_observer_agency_identities i on i.agency_id=p.agency_id and i.source_key='REMAX'
  where p.external_source_key='REMAX' and e.claim_key='publication.datePublished'
   and e.confidence>=0.95 and e.metadata->>'retrievalMethod'='PRIMARY_HTTP'
   and e.source_recorded_at<=e.observed_at) then
  raise exception 'Explicit primary publication date and verified branch required';
 end if;
end $$;
update public.market_observer_sources set projections_enabled=true,missing_enabled=false,
 updated_at=now() where source_key='REMAX' and enabled;
commit;
