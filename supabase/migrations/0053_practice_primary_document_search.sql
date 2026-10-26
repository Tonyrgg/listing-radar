begin;

-- Derived search results. A link points to an existing publication and does
-- not confirm the works, transfer geography, or create a property event.
create table public.building_practice_document_search (
 index_record_id uuid primary key references public.building_practice_records(id) on delete restrict,
 index_input_hash text not null,
 primary_record_id uuid references public.building_practice_records(id) on delete restrict,
 primary_input_hash text,
 search_state text not null check(search_state in ('LINKED','NO_ATTACHMENT','NO_MATCH','AMBIGUOUS','IDENTIFIERS_MISSING')),
 administrative_identity jsonb not null default '{}',
 candidate_count integer not null check(candidate_count>=0),
 policy_version text not null,
 signature_hash text not null,
 checked_at timestamptz not null default now(),
 check(index_record_id is distinct from primary_record_id),
 check((search_state in ('LINKED','NO_ATTACHMENT'))=(primary_record_id is not null)),
 check((primary_record_id is null)=(primary_input_hash is null)),
 check(jsonb_typeof(administrative_identity)='object')
);
alter table public.building_practice_document_search enable row level security;
create policy practice_document_search_read on public.building_practice_document_search
 for select to authenticated using(true);
revoke all on public.building_practice_document_search from public,anon,authenticated;
grant select on public.building_practice_document_search to authenticated;
grant select,insert,update on public.building_practice_document_search to service_role;

create view public.market_observer_practice_document_queue with(security_invoker=true) as
select r.id index_record_id,r.application_code,r.practice_number,r.protocol_number,
 (r.occurred_at at time zone 'UTC')::date protocol_date,r.intervention_type,r.content_hash,r.source_url,
 case when s.index_record_id is null then 'PENDING'
  when s.index_input_hash<>r.content_hash or (s.primary_record_id is not null and p.content_hash is distinct from s.primary_input_hash) then 'STALE'
  else s.search_state end search_state,
 s.candidate_count,s.checked_at,s.policy_version,
 case when s.index_input_hash=r.content_hash and p.content_hash=s.primary_input_hash then p.id end primary_record_id,
 case when s.index_input_hash=r.content_hash and p.content_hash=s.primary_input_hash then p.source_url end primary_source_url,
 case when s.index_input_hash=r.content_hash and p.content_hash=s.primary_input_hash and s.search_state='LINKED' then p.document_urls else '[]'::jsonb end document_urls
from public.building_practice_records r
left join public.building_practice_document_search s on s.index_record_id=r.id
left join public.building_practice_records p on p.id=s.primary_record_id
where r.source_key='comune-bitonto-elenco-pratiche-2025'
 and coalesce(r.sanitized_payload->>'treatment','')<>'ARCHIVE_ONLY_JUDICIAL';

revoke all on public.market_observer_practice_document_queue from public,anon;
grant select on public.market_observer_practice_document_queue to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
