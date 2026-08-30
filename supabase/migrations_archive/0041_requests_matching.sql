-- Migration version normalized from duplicate 004 prefix; SQL preserved.
-- Richieste, portafoglio e matching. Applicare dopo le migration esistenti.
create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text,
  email text,
  notes text,
  external_crm_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.internal_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  landmarks jsonb not null default '[]'::jsonb,
  aliases jsonb not null default '[]'::jsonb,
  associated_streets jsonb not null default '[]'::jsonb,
  map_area_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  title text,
  contract_type text not null check (contract_type in ('sale', 'rent')),
  property_types jsonb not null default '[]'::jsonb,
  municipality text default 'Bitonto',
  status text not null default 'draft' check (status in ('draft','active','urgent','suspended','satisfied','cancelled','archived')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  budget_ideal numeric,
  budget_max numeric,
  monthly_rent_ideal numeric,
  monthly_rent_max numeric,
  internal_sqm_min numeric,
  internal_sqm_ideal numeric,
  internal_sqm_max numeric,
  commercial_sqm_estimated_min numeric,
  commercial_sqm_estimated_max numeric,
  rooms_min numeric,
  rooms_ideal numeric,
  rooms_max numeric,
  bedrooms_min numeric,
  bathrooms_min numeric,
  floor_min integer,
  floor_max integer,
  building_floors_max integer,
  accepted_conditions jsonb not null default '[]'::jsonb,
  availability_requirement text,
  available_by date,
  notes text,
  external_crm_id text,
  source text default 'manual',
  last_imported_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  contract_type text not null check (contract_type in ('sale', 'rent')),
  property_type text not null,
  municipality text default 'Bitonto',
  address text,
  internal_zone_id uuid references public.internal_zones(id) on delete set null,
  price numeric,
  monthly_rent numeric,
  internal_sqm numeric,
  commercial_sqm numeric,
  rooms numeric,
  bedrooms numeric,
  bathrooms numeric,
  floor integer,
  building_floors integer,
  condition text,
  availability_status text,
  available_from date,
  description text,
  notes text,
  external_crm_id text,
  source text default 'manual',
  last_imported_at timestamptz,
  mandate_status text not null default 'active' check (mandate_status in ('draft','active','suspended','expired','sold','rented','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_zones (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.property_requests(id) on delete cascade,
  zone_id uuid not null references public.internal_zones(id) on delete cascade,
  preference_level text not null check (preference_level in ('required','preferred','accepted','excluded')),
  created_at timestamptz not null default now(),
  unique (request_id, zone_id)
);

create table if not exists public.feature_definitions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  category text not null,
  field_type text not null check (field_type in ('boolean','number','range','select','multiselect','text')),
  applies_to text not null default 'both' check (applies_to in ('request','property','both')),
  allowed_values jsonb,
  default_weight numeric not null default 5,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_feature_preferences (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.property_requests(id) on delete cascade,
  feature_definition_id uuid not null references public.feature_definitions(id) on delete cascade,
  preference_level text not null check (preference_level in ('required','preferred','indifferent','avoid')),
  desired_value jsonb,
  custom_weight numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, feature_definition_id)
);

create table if not exists public.property_feature_values (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  feature_definition_id uuid not null references public.feature_definitions(id) on delete cascade,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, feature_definition_id)
);

create table if not exists public.request_property_matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.property_requests(id) on delete cascade,
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  score numeric not null default 0 check (score >= 0 and score <= 100),
  classification text not null check (classification in ('compatible','almost_compatible','weak','not_relevant')),
  matched_criteria jsonb not null default '[]'::jsonb,
  missing_preferences jsonb not null default '[]'::jsonb,
  conflicting_criteria jsonb not null default '[]'::jsonb,
  explanation text,
  status text not null default 'new' check (status in ('new','to_propose','proposed','interested','visit_scheduled','not_interested','excluded','negotiation','completed')),
  last_calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, property_id)
);

create table if not exists public.matching_activity_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists property_requests_status_idx on public.property_requests(status);
create index if not exists portfolio_properties_status_idx on public.portfolio_properties(mandate_status);
create index if not exists request_matches_request_score_idx on public.request_property_matches(request_id, score desc);
create index if not exists request_matches_property_score_idx on public.request_property_matches(property_id, score desc);
create index if not exists matching_activity_entity_idx on public.matching_activity_logs(entity_type, entity_id, created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'clients','internal_zones','property_requests','portfolio_properties',
    'feature_definitions','request_feature_preferences','property_feature_values',
    'request_property_matches'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end $$;

insert into public.feature_definitions (key, label, category, field_type, sort_order)
values
  ('elevator','Ascensore','accessibilità','boolean',10),
  ('balcony','Balcone','esterni','boolean',20),
  ('terrace','Terrazzo','esterni','boolean',30),
  ('garden','Giardino','esterni','boolean',40),
  ('veranda','Veranda','esterni','boolean',50),
  ('courtyard','Cortile','esterni','boolean',60),
  ('garage','Box','pertinenze','boolean',70),
  ('parking_space','Posto auto','pertinenze','boolean',80),
  ('cellar','Cantina','pertinenze','boolean',90),
  ('storage_room','Deposito','pertinenze','boolean',100),
  ('independent_entrance','Ingresso indipendente','accesso','boolean',110),
  ('eat_in_kitchen','Cucina abitabile','interni','boolean',120),
  ('closet','Ripostiglio','interni','boolean',130),
  ('laundry_room','Lavanderia','interni','boolean',140),
  ('second_bathroom','Secondo bagno','interni','boolean',150),
  ('furnished','Arredato','dotazioni','boolean',160),
  ('accessible','Accessibile','accessibilità','boolean',170),
  ('rented_property_accepted','Immobile locato accettato','disponibilità','boolean',180),
  ('ground_floor_accepted','Piano terra accettato','piano','boolean',190),
  ('basement_accepted','Seminterrato accettato','piano','boolean',200)
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('matching_config', '{
  "thresholds":{"compatible":85,"almostCompatible":65,"weak":40},
  "budgetTolerance":{"near":0.05,"weak":0.15},
  "commercialSqm":{"minimumFactor":1.10,"maximumFactor":1.20},
  "weights":{"propertyType":15,"zone":20,"budget":20,"internalSqm":15,"rooms":10,"floor":5,"condition":5,"availability":5}
}'::jsonb)
on conflict (key) do nothing;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'clients','internal_zones','property_requests','portfolio_properties','request_zones',
    'feature_definitions','request_feature_preferences','property_feature_values',
    'request_property_matches','matching_activity_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
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
