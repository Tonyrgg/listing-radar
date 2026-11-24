begin;
create table public.worker_pin_civic_links (
  property_id uuid primary key references public.properties(id) on delete cascade,
  civic text not null check (length(civic) between 1 and 35),
  sister_unit_key text check (length(sister_unit_key) between 1 and 200),
  updated_at timestamptz not null default now()
);
alter table public.worker_pin_civic_links enable row level security;
revoke all on public.worker_pin_civic_links from public,anon,authenticated;
grant select,insert,update on public.worker_pin_civic_links to service_role;
notify pgrst, 'reload schema';
commit;
