begin;
create function public.bind_fingerprint_archive_source(p_source text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role() is distinct from 'service_role' or p_source!~'^[a-f0-9]{64}$' then raise exception 'Explicit service source required';end if;
 if exists(select 1 from public.fingerprint_archive_receipts) and exists(select 1 from public.fingerprint_archive_external_config where source<>p_source) then raise exception 'Cannot rebind a committed archive';end if;
 if not exists(select 1 from radar_external.fingerprint_groups where source=p_source limit 1) then raise exception 'External source is empty or unavailable';end if;
 update public.fingerprint_archive_external_config set source=p_source,configured_at=now() where singleton;
 if not found then raise exception 'Connection must be configured first';end if;
 return true;
end $$;
revoke all on function public.bind_fingerprint_archive_source(text) from public,anon,authenticated;
grant execute on function public.bind_fingerprint_archive_source(text) to service_role;
notify pgrst,'reload schema';
commit;
