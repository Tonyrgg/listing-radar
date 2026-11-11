begin;
-- Reclaim allocated pages only after the outbox is empty. The identity sequence
-- is deliberately preserved: external groups must never share an ID with new ones.
create function public.reclaim_empty_fingerprint_outbox() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform set_config('lock_timeout','2s',true);
 lock table public.image_fingerprint_archive_groups in access exclusive mode;
 if exists(select 1 from public.image_fingerprint_archive_groups) then return false;end if;
 if not exists(select 1 from public.fingerprint_archive_receipts where external_payload_md5 is not null) then return false;end if;
 truncate public.image_fingerprint_archive_groups continue identity;
 return true;
end $$;
revoke all on function public.reclaim_empty_fingerprint_outbox() from public,anon,authenticated;
grant execute on function public.reclaim_empty_fingerprint_outbox() to service_role;
notify pgrst,'reload schema';
commit;
