-- Controlled operational configuration; no crawler activation or property seed.
begin;

update public.agencies a set market_role='COMPETITOR',settings=a.settings||jsonb_build_object(
 'marketObserverRegistry',jsonb_build_object('version','bitonto_rollout_v1','canonicalName',a.name,
   'aliases',jsonb_build_array(a.name),'website',a.website_url,'branch','Bitonto',
   'confidence',0.90,'provenance',jsonb_build_array(jsonb_build_object('url',a.website_url,
     'method','EXISTING_V2_PRIMARY_OBSERVATIONS','lastObservedAt',(select max(p.last_seen_at) from public.publications p where p.agency_id=a.id))),
   'configuredAt',now()))
where a.slug in ('ad-maiora-bitonto','futura-immobiliare-bitonto','garofalo-immobiliare-bitonto',
 'iconacasa-bitonto','momento-casa-bitonto','puntocasa-bitonto','studi-santi-bitonto',
 'studio-casa-bitonto','trio-casa-bitonto','vistocasa-bitonto')
 and a.market_role='UNKNOWN' and not(a.settings ? 'marketObserverRegistry');

insert into public.agencies(slug,name,adapter_key,website_url,inventory_url,enabled,market_role,settings)
values('tecnocasa-bitonto-matteotti','Tecnocasa Bitonto — Immobiliare San Francesco D.I.',
 'external-only:tecnocasa-bitonto-matteotti','https://bitonto2.tecnocasa.it/bitonto/bitonto/',
 'https://bitonto2.tecnocasa.it/immobili-in-vendita/',false,'OUR_AGENCY',
 jsonb_build_object('marketObserverRegistry',jsonb_build_object('version','bitonto_rollout_v1',
  'canonicalName','Immobiliare San Francesco D.I.','aliases',jsonb_build_array('Tecnocasa Bitonto','Tecnocasa Bitonto Matteotti','Immobiliare San Francesco D.I.'),
  'branch','Via Matteotti 48, Bitonto','externalAgencyIds',jsonb_build_object('TECNOCASA','bahg9','IMMOBILIARE','244036'),
  'confidence',0.95,'roleBasis','USER_BITONTO_AND_OFFICIAL_BRANCH_DIRECTORY',
  'provenance',jsonb_build_array(jsonb_build_object('url','https://bitonto2.tecnocasa.it/bitonto/bitonto/',
   'method','OFFICIAL_BRANCH_DIRECTORY','note','Specific branch; never the whole Tecnocasa brand')), 'configuredAt',now()))),
 ('remax-stella-polare-caduti','RE/MAX Stella Polare — Bari Via Caduti del Lavoro',
  'external-only:remax-stella-polare-caduti','https://stella-polare.remax.it/',
  'https://stella-polare.remax.it/agenzia/stella-polare/vendita-case?contractType=vendita',false,'COMPETITOR',
  jsonb_build_object('marketObserverRegistry',jsonb_build_object('version','bitonto_rollout_v1',
   'canonicalName','REMAX Stella Polare - Bari Via Caduti del Lavoro',
   'aliases',jsonb_build_array('REMAX Stella Polare - Bari Via Caduti del Lavoro'),
   'branch','Bari Via Caduti del Lavoro','confidence',0.95,
   'externalAgencyIds',jsonb_build_object('REMAX_OBSERVED_SHARED_PROVIDER','https://www.remax.it/agenzia/stella-polare/agenzia#agency'),
   'externalIdAmbiguous',true,'provenance',jsonb_build_array(jsonb_build_object(
    'url','https://stella-polare.remax.it/vendita-casa-indipendente/bitonto/centro-41091011-176',
    'method','PRIMARY_HTTP_JSON_LD_PROVIDER','note','Provider @id shared with Camillo Rosalba; match full branch name only')),'configuredAt',now())))
on conflict(slug) do nothing;

-- The shared RE/MAX provider @id cannot be used as a unique branch identity.
insert into public.market_observer_agency_identities(source_key,normalized_name,agency_id,provenance)
select 'REMAX','remax stella polare - bari via caduti del lavoro',id,jsonb_build_object(
 'method','PRIMARY_HTTP_JSON_LD_PROVIDER','confidence',0.95,'branch','Bari Via Caduti del Lavoro',
 'sourceUrl','https://stella-polare.remax.it/vendita-casa-indipendente/bitonto/centro-41091011-176',
 'sharedProviderIdNotUsedForMapping',true)
from public.agencies where slug='remax-stella-polare-caduti'
on conflict(source_key,normalized_name) where normalized_name is not null do nothing;

-- Evidence-level observed portfolio, not an agent conversion/performance statistic.
create view public.market_observer_agent_observed_portfolio with(security_invoker=true) as
select distinct on(p.id) al.agency_id,a.name agency_name,p.id publication_id,al.property_id,
 e.normalized_value->>'name' agent_name,e.normalized_value->>'url' agent_url,
 e.id evidence_id,e.source_url,e.observed_at,e.confidence,s.projections_enabled,
 p.state publication_state,p.last_seen_at
from public.evidence e join public.publications p on p.id=e.publication_id
join public.agency_listings al on al.id=p.agency_listing_id join public.agencies a on a.id=al.agency_id
join public.market_observer_sources s on s.source_key=e.metadata->>'source'
where e.claim_key='publication.agentIdentity' and e.confidence>=0.85
 and e.metadata->>'retrievalMethod'='PRIMARY_HTTP' and nullif(e.normalized_value->>'name','') is not null
order by p.id,e.observed_at desc,e.id;
grant select on public.market_observer_agent_observed_portfolio to authenticated,service_role;
comment on view public.market_observer_agent_observed_portfolio is
 'Explicit per-publication primary agent evidence only. Small observed portfolio; not agency-wide attribution or performance statistics.';

notify pgrst,'reload schema';
commit;
