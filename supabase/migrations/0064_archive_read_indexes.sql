-- EXPLAIN ANALYZE of the 706-property map: ~8.7s, including 706 scans
-- filtering 213 evidence rows each for a claim that is usually absent.
-- Partial indexes stay small; logical evidence and archive semantics unchanged.
begin;
set local lock_timeout='5s';
create index evidence_asking_price_lookup_idx
 on public.evidence_rows(publication_id,source_recorded_at,observed_at)
 where claim_key='publication.askingPrice' and confidence>=0.85;
create index evidence_agent_identity_lookup_idx
 on public.evidence_rows(publication_id,observed_at desc)
 where claim_key='publication.agentIdentity';
-- The graph compares an actual JSON street ID with the canonical UUID text.
-- Keep that exact comparison (including invalid reference handling), indexed.
create index street_registry_id_text_lookup_idx
 on public.street_registry_streets((id::text));
notify pgrst,'reload schema';
commit;
