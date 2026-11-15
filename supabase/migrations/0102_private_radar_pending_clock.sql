begin;
-- Newly discovered URLs must be due even when a collector clock trails Postgres.
alter table public.private_radar_inbox alter column next_check_at set default '1970-01-01T00:00:00Z'::timestamptz;
update public.private_radar_inbox set next_check_at='1970-01-01T00:00:00Z'::timestamptz where status='PENDING' and last_checked_at is null;
commit;
