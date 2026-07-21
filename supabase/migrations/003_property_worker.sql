-- Property Data Worker: persistent queue, normalized cadastral data and audit log.
-- The local worker uses the service role; the web UI uses the authenticated policies below.

create table if not exists public.property_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('assisted', 'automatic')),
  status text not null default 'ready' check (status in (
    'ready', 'running', 'needs_review', 'session_expired', 'portal_error',
    'data_incomplete', 'failed', 'paused', 'completed'
  )),
  current_step text not null default 'ready',
  last_completed_step text,
  municipality text,
  street text,
  civic_number text,
  sister_source_url text,
  total_properties integer not null default 0 check (total_properties >= 0),
  processed_properties integer not null default 0 check (processed_properties >= 0),
  total_people integer not null default 0 check (total_people >= 0),
  processed_people integer not null default 0 check (processed_people >= 0),
  error_message text,
  error_details jsonb,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.property_worker_properties (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  municipality text not null,
  sheet text not null,
  parcel text not null,
  subaltern text not null,
  cadastral_key text not null,
  address text,
  census_zone text,
  category text,
  class text,
  consistency text,
  cadastral_income numeric,
  raw_payload jsonb,
  processing_status text not null default 'pending',
  crm_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists property_worker_properties_cadastral_unique_idx
  on public.property_worker_properties (municipality, sheet, parcel, subaltern);
create index if not exists property_worker_properties_job_idx
  on public.property_worker_properties (job_id, created_at);

create table if not exists public.property_worker_people (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  full_name text not null,
  birth_place text,
  birth_province text,
  birth_date date,
  tax_code text,
  right_type text,
  share_original text,
  share_numerator numeric,
  share_denominator numeric,
  share_percentage numeric,
  mobiles jsonb not null default '[]'::jsonb,
  landlines jsonb not null default '[]'::jsonb,
  emails jsonb not null default '[]'::jsonb,
  raw_payload jsonb,
  processing_status text not null default 'pending',
  crm_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_worker_people_job_idx
  on public.property_worker_people (job_id, created_at);
create index if not exists property_worker_people_tax_code_idx
  on public.property_worker_people (tax_code) where tax_code is not null;

create table if not exists public.property_worker_ownerships (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.property_worker_properties(id) on delete cascade,
  person_id uuid not null references public.property_worker_people(id) on delete cascade,
  right_type text not null default 'Proprietà',
  share_percentage numeric,
  crm_link_id text,
  processing_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists property_worker_ownerships_property_person_unique_idx
  on public.property_worker_ownerships (property_id, person_id);

create table if not exists public.property_worker_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  property_id uuid references public.property_worker_properties(id) on delete cascade,
  person_id uuid references public.property_worker_people(id) on delete cascade,
  step_name text not null,
  status text not null,
  input_data jsonb,
  output_data jsonb,
  error_message text,
  screenshot_path text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists property_worker_steps_job_idx
  on public.property_worker_steps (job_id, created_at desc);

create table if not exists public.property_worker_change_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.property_worker_jobs(id) on delete cascade,
  entity_type text not null,
  entity_identifier text not null,
  field_name text not null,
  old_value text,
  new_value text,
  source text not null default 'SISTER',
  created_at timestamptz not null default now()
);

create index if not exists property_worker_change_logs_job_idx
  on public.property_worker_change_logs (job_id, created_at desc);

drop trigger if exists set_property_worker_jobs_updated_at on public.property_worker_jobs;
create trigger set_property_worker_jobs_updated_at before update on public.property_worker_jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_property_worker_properties_updated_at on public.property_worker_properties;
create trigger set_property_worker_properties_updated_at before update on public.property_worker_properties
for each row execute function public.set_updated_at();

drop trigger if exists set_property_worker_people_updated_at on public.property_worker_people;
create trigger set_property_worker_people_updated_at before update on public.property_worker_people
for each row execute function public.set_updated_at();

drop trigger if exists set_property_worker_ownerships_updated_at on public.property_worker_ownerships;
create trigger set_property_worker_ownerships_updated_at before update on public.property_worker_ownerships
for each row execute function public.set_updated_at();

alter table public.property_worker_jobs enable row level security;
alter table public.property_worker_properties enable row level security;
alter table public.property_worker_people enable row level security;
alter table public.property_worker_ownerships enable row level security;
alter table public.property_worker_steps enable row level security;
alter table public.property_worker_change_logs enable row level security;

do $$
declare
  table_name text;
  operation text;
begin
  foreach table_name in array array[
    'property_worker_jobs', 'property_worker_properties', 'property_worker_people',
    'property_worker_ownerships', 'property_worker_steps', 'property_worker_change_logs'
  ] loop
    foreach operation in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I',
        'authenticated ' || operation || ' ' || table_name, table_name);
      if operation = 'insert' then
        execute format('create policy %I on public.%I for insert to authenticated with check (true)',
          'authenticated insert ' || table_name, table_name);
      elsif operation = 'update' then
        execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)',
          'authenticated update ' || table_name, table_name);
      else
        execute format('create policy %I on public.%I for %s to authenticated using (true)',
          'authenticated ' || operation || ' ' || table_name, table_name, operation);
      end if;
    end loop;
  end loop;
end $$;
