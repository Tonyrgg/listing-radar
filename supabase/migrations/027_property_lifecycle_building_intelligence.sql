begin;

create table public.building_data_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_url text,
  source_etag text,
  source_last_modified text,
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input_rows integer not null default 0 check (input_rows >= 0),
  eligible_rows integer not null default 0 check (eligible_rows >= 0),
  grouped_records integer not null default 0 check (grouped_records >= 0),
  inserted_records integer not null default 0 check (inserted_records >= 0),
  updated_records integer not null default 0 check (updated_records >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  unmatched_records integer not null default 0 check (unmatched_records >= 0),
  building_links integer not null default 0 check (building_links >= 0),
  event_count integer not null default 0 check (event_count >= 0),
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index building_data_import_runs_source_idx
  on public.building_data_import_runs (source_key, started_at desc);

create table public.building_practice_records (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_record_key text not null,
  application_code text not null,
  practice_number text,
  protocol_number text,
  practice_year text,
  practice_type text,
  practice_status text,
  intervention_type text not null check (intervention_type in (
    'MANUTENZIONE_STRAORDINARIA',
    'FRAZIONAMENTO',
    'FUSIONE_ACCOPPIAMENTO',
    'CAMBIO_DESTINAZIONE_USO',
    'AGIBILITA',
    'AMPLIAMENTO',
    'RISTRUTTURAZIONE',
    'NUOVA_COSTRUZIONE',
    'FINE_LAVORI',
    'OTHER'
  )),
  occurred_at timestamptz,
  source_url text,
  content_hash text not null,
  sanitized_payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, source_record_key)
);

create index building_practice_records_event_idx
  on public.building_practice_records (intervention_type, occurred_at desc);
create index building_practice_records_application_idx
  on public.building_practice_records (application_code, practice_year);

create table public.building_practice_observations (
  id uuid primary key default gen_random_uuid(),
  practice_record_id uuid not null
    references public.building_practice_records(id) on delete restrict,
  import_run_id uuid not null
    references public.building_data_import_runs(id) on delete restrict,
  content_hash text not null,
  sanitized_payload jsonb not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (practice_record_id, content_hash)
);

create index building_practice_observations_record_idx
  on public.building_practice_observations (practice_record_id, observed_at desc);

create table public.building_practice_buildings (
  practice_record_id uuid not null
    references public.building_practice_records(id) on delete restrict,
  building_id uuid not null references public.buildings(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (practice_record_id, building_id)
);

create index building_practice_buildings_building_idx
  on public.building_practice_buildings (building_id, last_seen_at desc);

create trigger set_building_data_import_runs_updated_at
  before update on public.building_data_import_runs
  for each row execute function public.set_updated_at();
create trigger set_building_practice_records_updated_at
  before update on public.building_practice_records
  for each row execute function public.set_updated_at();

create trigger prevent_building_practice_observations_mutation
  before update or delete on public.building_practice_observations
  for each row execute function public.prevent_property_lifecycle_history_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'building_data_import_runs',
    'building_practice_records',
    'building_practice_observations',
    'building_practice_buildings'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      'authenticated read ' || table_name,
      table_name
    );
  end loop;
end;
$$;

comment on table public.building_practice_records is
  'Sanitized, deduplicated municipal building-practice records; direct personal fields are excluded.';
comment on table public.building_practice_observations is
  'Append-only content versions observed during incremental public-dataset imports.';
comment on table public.building_practice_buildings is
  'Civic-level associations only; property-level association requires separate unit evidence.';

commit;
