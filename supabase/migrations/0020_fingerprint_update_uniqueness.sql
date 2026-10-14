-- The compact replacement must retain UNIQUE semantics for updates as well as inserts.
begin;
set local lock_timeout='5s';
create or replace function public.lifecycle_guard_fingerprint_identity() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.snapshot_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.snapshot_id::text||':'||new.canonical_url||':'||new.algorithm,0));
    if exists(select 1 from public.image_fingerprint_current f
      where f.snapshot_id=new.snapshot_id and f.canonical_url=new.canonical_url
        and f.algorithm=new.algorithm
        and f.id<>case when TG_OP='UPDATE' then old.id else new.id end) then
      raise exception 'Duplicate fingerprint observation' using errcode='23505';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_fingerprint_identity on public.image_fingerprint_current;
create trigger guard_fingerprint_identity before insert or update on public.image_fingerprint_current
  for each row execute function public.lifecycle_guard_fingerprint_identity();
commit;
