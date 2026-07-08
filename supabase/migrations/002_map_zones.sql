create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists agents_name_unique_idx
  on public.agents (lower(name));

insert into public.agents (name, color)
select 'Tony', '#2563eb'
where not exists (
  select 1 from public.agents where lower(name) = lower('Tony')
);

insert into public.agents (name, color)
select 'Agente 2', '#16a34a'
where not exists (
  select 1 from public.agents where lower(name) = lower('Agente 2')
);

create table if not exists public.map_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agent_id uuid references public.agents(id) on delete set null,
  color text,
  geometry jsonb not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'to_recheck')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists map_areas_agent_id_idx on public.map_areas (agent_id);
create index if not exists map_areas_status_idx on public.map_areas (status);
create index if not exists map_areas_created_at_idx on public.map_areas (created_at desc);

create table if not exists public.map_streets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agent_id uuid references public.agents(id) on delete set null,
  area_id uuid references public.map_areas(id) on delete set null,
  geometry jsonb,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'to_recheck', 'not_useful')),
  last_completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists map_streets_agent_id_idx on public.map_streets (agent_id);
create index if not exists map_streets_area_id_idx on public.map_streets (area_id);
create index if not exists map_streets_status_idx on public.map_streets (status);
create index if not exists map_streets_created_at_idx on public.map_streets (created_at desc);

create table if not exists public.map_pins (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (
      category in (
        'sale_lead',
        'empty_house',
        'follow_up',
        'useful_doorman',
        'useful_administrator',
        'owner_met',
        'door_knocked',
        'interesting_building',
        'not_interested',
        'recheck',
        'rental_lead',
        'future_sale',
        'other'
      )
    ),
  status text not null default 'new'
    check (status in ('new', 'to_verify', 'hot', 'contacted', 'follow_up', 'closed', 'discarded')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  agent_id uuid references public.agents(id) on delete set null,
  area_id uuid references public.map_areas(id) on delete set null,
  street_id uuid references public.map_streets(id) on delete set null,
  listing_id uuid references public.listings(id) on delete set null,
  latitude numeric not null,
  longitude numeric not null,
  address_raw text,
  notes text,
  follow_up_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists map_pins_agent_id_idx on public.map_pins (agent_id);
create index if not exists map_pins_area_id_idx on public.map_pins (area_id);
create index if not exists map_pins_street_id_idx on public.map_pins (street_id);
create index if not exists map_pins_listing_id_idx on public.map_pins (listing_id);
create index if not exists map_pins_status_idx on public.map_pins (status);
create index if not exists map_pins_category_idx on public.map_pins (category);
create index if not exists map_pins_priority_idx on public.map_pins (priority);
create index if not exists map_pins_follow_up_at_idx on public.map_pins (follow_up_at);
create index if not exists map_pins_created_at_idx on public.map_pins (created_at desc);

create table if not exists public.map_activity_logs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete set null,
  area_id uuid references public.map_areas(id) on delete set null,
  street_id uuid references public.map_streets(id) on delete set null,
  pin_id uuid references public.map_pins(id) on delete set null,
  action_type text not null,
  notes text,
  created_at timestamptz default now()
);

create index if not exists map_activity_logs_agent_id_idx on public.map_activity_logs (agent_id);
create index if not exists map_activity_logs_area_id_idx on public.map_activity_logs (area_id);
create index if not exists map_activity_logs_street_id_idx on public.map_activity_logs (street_id);
create index if not exists map_activity_logs_pin_id_idx on public.map_activity_logs (pin_id);
create index if not exists map_activity_logs_created_at_idx on public.map_activity_logs (created_at desc);

drop trigger if exists set_agents_updated_at on public.agents;
create trigger set_agents_updated_at
before update on public.agents
for each row
execute function public.set_updated_at();

drop trigger if exists set_map_areas_updated_at on public.map_areas;
create trigger set_map_areas_updated_at
before update on public.map_areas
for each row
execute function public.set_updated_at();

drop trigger if exists set_map_streets_updated_at on public.map_streets;
create trigger set_map_streets_updated_at
before update on public.map_streets
for each row
execute function public.set_updated_at();

drop trigger if exists set_map_pins_updated_at on public.map_pins;
create trigger set_map_pins_updated_at
before update on public.map_pins
for each row
execute function public.set_updated_at();

alter table public.agents enable row level security;
alter table public.map_areas enable row level security;
alter table public.map_streets enable row level security;
alter table public.map_pins enable row level security;
alter table public.map_activity_logs enable row level security;

drop policy if exists "authenticated select agents" on public.agents;
create policy "authenticated select agents"
  on public.agents
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert agents" on public.agents;
create policy "authenticated insert agents"
  on public.agents
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update agents" on public.agents;
create policy "authenticated update agents"
  on public.agents
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete agents" on public.agents;
create policy "authenticated delete agents"
  on public.agents
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_areas" on public.map_areas;
create policy "authenticated select map_areas"
  on public.map_areas
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_areas" on public.map_areas;
create policy "authenticated insert map_areas"
  on public.map_areas
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_areas" on public.map_areas;
create policy "authenticated update map_areas"
  on public.map_areas
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_areas" on public.map_areas;
create policy "authenticated delete map_areas"
  on public.map_areas
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_streets" on public.map_streets;
create policy "authenticated select map_streets"
  on public.map_streets
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_streets" on public.map_streets;
create policy "authenticated insert map_streets"
  on public.map_streets
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_streets" on public.map_streets;
create policy "authenticated update map_streets"
  on public.map_streets
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_streets" on public.map_streets;
create policy "authenticated delete map_streets"
  on public.map_streets
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_pins" on public.map_pins;
create policy "authenticated select map_pins"
  on public.map_pins
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_pins" on public.map_pins;
create policy "authenticated insert map_pins"
  on public.map_pins
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_pins" on public.map_pins;
create policy "authenticated update map_pins"
  on public.map_pins
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_pins" on public.map_pins;
create policy "authenticated delete map_pins"
  on public.map_pins
  for delete
  to authenticated
  using (true);

drop policy if exists "authenticated select map_activity_logs" on public.map_activity_logs;
create policy "authenticated select map_activity_logs"
  on public.map_activity_logs
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert map_activity_logs" on public.map_activity_logs;
create policy "authenticated insert map_activity_logs"
  on public.map_activity_logs
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated update map_activity_logs" on public.map_activity_logs;
create policy "authenticated update map_activity_logs"
  on public.map_activity_logs
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete map_activity_logs" on public.map_activity_logs;
create policy "authenticated delete map_activity_logs"
  on public.map_activity_logs
  for delete
  to authenticated
  using (true);
