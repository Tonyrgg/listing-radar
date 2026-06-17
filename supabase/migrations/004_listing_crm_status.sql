alter table public.listings
  add column if not exists crm_status text not null default 'untreated'
  check (crm_status in ('untreated', 'treated'));

create index if not exists listings_crm_status_idx
  on public.listings (crm_status);
