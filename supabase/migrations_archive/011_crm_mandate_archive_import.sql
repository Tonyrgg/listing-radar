-- Import completo, aggiornabile e riprendibile degli incarichi/immobili dal CRM.
alter table public.portfolio_properties
  add column if not exists external_mandate_id text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

create unique index if not exists portfolio_properties_external_crm_id_unique
  on public.portfolio_properties (external_crm_id) where external_crm_id is not null;
create unique index if not exists portfolio_properties_external_mandate_id_unique
  on public.portfolio_properties (external_mandate_id) where external_mandate_id is not null;

create table if not exists public.crm_mandate_import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','failed','cancelled')),
  source_url text not null,
  total_mandates integer not null default 0,
  processed_mandates integer not null default 0,
  failed_mandates integer not null default 0,
  current_external_id text,
  current_title text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_mandate_import_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.crm_mandate_import_runs(id) on delete cascade,
  external_crm_id text not null,
  source_url text not null,
  title text,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  list_payload jsonb not null default '{}'::jsonb,
  detail_payload jsonb,
  imported_property_id uuid references public.portfolio_properties(id) on delete set null,
  error_message text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, external_crm_id)
);

create index if not exists crm_mandate_import_runs_status_idx
  on public.crm_mandate_import_runs (status, updated_at desc);
create index if not exists crm_mandate_import_items_run_status_idx
  on public.crm_mandate_import_items (run_id, status, created_at);

drop trigger if exists set_portfolio_properties_updated_at on public.portfolio_properties;
create trigger set_portfolio_properties_updated_at before update on public.portfolio_properties
  for each row execute function public.set_updated_at();
drop trigger if exists set_crm_mandate_import_runs_updated_at on public.crm_mandate_import_runs;
create trigger set_crm_mandate_import_runs_updated_at before update on public.crm_mandate_import_runs
  for each row execute function public.set_updated_at();
drop trigger if exists set_crm_mandate_import_items_updated_at on public.crm_mandate_import_items;
create trigger set_crm_mandate_import_items_updated_at before update on public.crm_mandate_import_items
  for each row execute function public.set_updated_at();

alter table public.crm_mandate_import_runs enable row level security;
alter table public.crm_mandate_import_items enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['crm_mandate_import_runs','crm_mandate_import_items'] loop
    execute format('drop policy if exists "authenticated select %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated insert %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated update %s" on public.%I', table_name, table_name);
    execute format('drop policy if exists "authenticated delete %s" on public.%I', table_name, table_name);
    execute format('create policy "authenticated select %s" on public.%I for select to authenticated using (true)', table_name, table_name);
    execute format('create policy "authenticated insert %s" on public.%I for insert to authenticated with check (true)', table_name, table_name);
    execute format('create policy "authenticated update %s" on public.%I for update to authenticated using (true) with check (true)', table_name, table_name);
    execute format('create policy "authenticated delete %s" on public.%I for delete to authenticated using (true)', table_name, table_name);
  end loop;
end $$;
