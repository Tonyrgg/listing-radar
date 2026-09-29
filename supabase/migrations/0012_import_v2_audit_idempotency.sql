-- A gateway failure can hide a successful insert response. Stable event keys
-- let Import V2 retry its audit without recording the same transition twice.
alter table public.property_worker_import_v2_events
  add column if not exists event_key text;

create unique index if not exists property_worker_import_v2_events_event_key_idx
  on public.property_worker_import_v2_events (event_key);
