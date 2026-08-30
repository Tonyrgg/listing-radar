create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger set_app_settings_updated_at
before update on public.app_settings
for each row
execute function public.set_updated_at();

alter table public.app_settings enable row level security;

create policy "authenticated select app_settings"
  on public.app_settings
  for select
  to authenticated
  using (true);

create policy "authenticated insert app_settings"
  on public.app_settings
  for insert
  to authenticated
  with check (true);

create policy "authenticated update app_settings"
  on public.app_settings
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete app_settings"
  on public.app_settings
  for delete
  to authenticated
  using (true);
