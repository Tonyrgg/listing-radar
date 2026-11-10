begin;
update public.agencies set enabled=false,settings=settings||jsonb_build_object('retired',true,'retiredReason','Agency no longer operating: owner-confirmed 2026-11-10','retiredAt','2026-11-10')where adapter_key='trio';
update public.lifecycle_jobs set status='CANCELLED',finished_at=now(),last_error=jsonb_build_object('reason','SOURCE_RETIRED','source','trio','historyPreserved',true)
where agency_id in(select id from public.agencies where adapter_key='trio')and status in('QUEUED','RETRY');
-- Historical observations remain evidence. Retiring a source never marks its
-- properties as disappeared, sold or deleted.
commit;
