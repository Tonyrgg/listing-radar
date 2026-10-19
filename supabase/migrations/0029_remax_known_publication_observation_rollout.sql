-- Stage 1: explicit primary HTTP evidence from known publication URLs only.
-- RE/MAX has no inventory job and must never authorize missing.
begin;
do $$ begin
 if not exists(select 1 from public.market_observer_agency_identities i
   join public.agencies a on a.id=i.agency_id
   where i.source_key='REMAX' and a.slug='remax-stella-polare-caduti'
    and i.normalized_name='remax stella polare - bari via caduti del lavoro'
    and i.external_agency_id is null) then
  raise exception 'Verified RE/MAX branch registry required before rollout';
 end if;
end $$;
update public.market_observer_sources set enabled=true,projections_enabled=false,
 missing_enabled=false,updated_at=now() where source_key='REMAX';
commit;
