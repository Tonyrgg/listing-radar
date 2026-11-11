create or replace function radar_archive.protect_group()returns trigger language plpgsql as $$
begin raise exception 'External archive groups are immutable';end $$;
drop trigger if exists protect_group on radar_archive.fingerprint_groups;
create trigger protect_group before update or delete on radar_archive.fingerprint_groups for each row execute function radar_archive.protect_group();
