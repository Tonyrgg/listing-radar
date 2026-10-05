-- Separate Territory workspaces. No stable-worker table or queue is changed.
create table if not exists public.territory_lab_workspaces (
  id uuid primary key,
  owner_id uuid not null,
  profile_kind text not null check (profile_kind in ('simulation', 'live')),
  revision bigint not null check (revision > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object' and state->>'version' = '1'),
  updated_at timestamptz not null default now()
);
create table if not exists public.territory_lab_sync_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.territory_lab_workspaces(id) on delete cascade,
  owner_id uuid not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, revision)
);
alter table public.territory_lab_workspaces enable row level security;
alter table public.territory_lab_sync_events enable row level security;
drop policy if exists territory_workspace_owner_read on public.territory_lab_workspaces;
create policy territory_workspace_owner_read on public.territory_lab_workspaces for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists territory_sync_owner_read on public.territory_lab_sync_events;
create policy territory_sync_owner_read on public.territory_lab_sync_events for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.territory_lab_workspaces, public.territory_lab_sync_events from anon, authenticated;
grant select on public.territory_lab_workspaces, public.territory_lab_sync_events to authenticated;
grant all on public.territory_lab_workspaces, public.territory_lab_sync_events to service_role;
grant usage, select on sequence public.territory_lab_sync_events_id_seq to service_role;

create or replace function public.save_territory_lab_workspace(
  p_workspace_id uuid, p_owner_id uuid, p_profile_kind text,
  p_expected_revision bigint, p_state jsonb
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_revision bigint;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id then
    raise exception 'Workspace owner does not match the caller' using errcode = '42501';
  end if;
  if p_owner_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_profile_kind not in ('simulation', 'live') or p_profile_kind is null
    or p_state is null or jsonb_typeof(p_state) <> 'object' or p_state->>'version' is distinct from '1' then
    raise exception 'Invalid Territory workspace' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    begin
      insert into public.territory_lab_workspaces(id, owner_id, profile_kind, revision, state)
      values (p_workspace_id, p_owner_id, p_profile_kind, 1, p_state)
      returning revision into v_revision;
    exception when unique_violation then
      raise exception 'Territory revision conflict' using errcode = '40001';
    end;
  else
    update public.territory_lab_workspaces
    set state = p_state, revision = revision + 1, updated_at = now()
    where id = p_workspace_id and owner_id = p_owner_id
      and profile_kind = p_profile_kind and revision = p_expected_revision
    returning revision into v_revision;
    if not found then raise exception 'Territory revision conflict' using errcode = '40001'; end if;
  end if;
  insert into public.territory_lab_sync_events(workspace_id, owner_id, revision)
  values (p_workspace_id, p_owner_id, v_revision);
  return v_revision;
end;
$$;
revoke all on function public.save_territory_lab_workspace(uuid, uuid, text, bigint, jsonb) from public, anon;
grant execute on function public.save_territory_lab_workspace(uuid, uuid, text, bigint, jsonb) to authenticated, service_role;
notify pgrst, 'reload schema';
