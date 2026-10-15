-- Incremental, revisioned delivery for office workstations. Existing snapshots,
-- owners and RPC remain compatible; tombstones prevent deleted queue entries returning.
create unique index territory_one_live_workspace_per_owner on public.territory_lab_workspaces(owner_id) where profile_kind = 'live';
create table public.territory_workspace_records (
  workspace_id uuid not null references public.territory_lab_workspaces(id) on delete cascade,
  collection text not null,
  record_key text not null,
  revision bigint not null,
  value jsonb,
  deleted boolean not null default false,
  primary key (workspace_id, collection, record_key)
);
create index territory_workspace_records_revision on public.territory_workspace_records(workspace_id, revision);
alter table public.territory_workspace_records enable row level security;
revoke all on public.territory_workspace_records from public, anon, authenticated;
grant all on public.territory_workspace_records to service_role;

create function public.territory_state_records(p_state jsonb)
returns table(collection text, record_key text, value jsonb)
language sql immutable set search_path = '' as $$
  select root.key, item.key, item.value
  from jsonb_each(p_state) root
  cross join lateral jsonb_each(case when root.key = any(array['memories','units','checkpoints','virtualCrm','virtualPeople','virtualActivities','historicalStreetMappings','networkBindings','zones','savedQueries','importQueue','quarantine','syncConflicts']) then root.value else '{}'::jsonb end) item
  union all
  select root.key, item.value->>'id', item.value
  from jsonb_each(p_state) root
  cross join lateral jsonb_array_elements(case when root.key = any(array['streets','runs','events','history']) then root.value else '[]'::jsonb end) item
  union all
  select 'cloud:' || kind.key, item.key, item.value
  from jsonb_each(coalesce(p_state->'cloudMemory', '{}'::jsonb)) kind
  cross join lateral jsonb_each(kind.value) item
  union all
  select 'meta', root.key, root.value from jsonb_each(p_state) root
  where root.key <> all(array['memories','units','checkpoints','virtualCrm','virtualPeople','virtualActivities','historicalStreetMappings','networkBindings','zones','savedQueries','importQueue','quarantine','syncConflicts','streets','runs','events','history','cloudMemory']);
$$;

create function public.territory_index_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.territory_workspace_records(workspace_id, collection, record_key, revision, value, deleted)
  select new.id, r.collection, r.record_key, new.revision, r.value, false
  from public.territory_state_records(new.state) r
  on conflict (workspace_id, collection, record_key) do update
    set revision = excluded.revision, value = excluded.value, deleted = false
    where territory_workspace_records.value is distinct from excluded.value or territory_workspace_records.deleted;
  update public.territory_workspace_records indexed set revision = new.revision, value = null, deleted = true
  where indexed.workspace_id = new.id and not indexed.deleted
    and not exists(select 1 from public.territory_state_records(new.state) r where r.collection = indexed.collection and r.record_key = indexed.record_key);
  return new;
end; $$;
create trigger territory_index_workspace after insert or update of state on public.territory_lab_workspaces
for each row execute function public.territory_index_workspace();
insert into public.territory_workspace_records(workspace_id, collection, record_key, revision, value)
select w.id, r.collection, r.record_key, w.revision, r.value
from public.territory_lab_workspaces w cross join lateral public.territory_state_records(w.state) r;

create function public.read_territory_workspace_changes(p_workspace_id uuid, p_owner_id uuid, p_profile_kind text, p_since bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.territory_lab_workspaces; changes jsonb;
begin
  if p_owner_id is null or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id) then raise exception 'Workspace owner mismatch' using errcode = '42501'; end if;
  if p_since is null or p_since < 0 then raise exception 'Invalid revision' using errcode = '22023'; end if;
  select * into w from public.territory_lab_workspaces where id = p_workspace_id and owner_id = p_owner_id and profile_kind = p_profile_kind for share;
  if not found then return jsonb_build_object('revision', 0, 'changes', '[]'::jsonb); end if;
  if p_since > w.revision then raise exception 'Remote revision went backwards' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('collection',r.collection,'key',r.record_key,'value',r.value,'deleted',r.deleted)), '[]'::jsonb)
  into changes from public.territory_workspace_records r where r.workspace_id = w.id and r.revision > p_since;
  return jsonb_build_object('revision', w.revision, 'changes', changes);
end; $$;

create function public.save_territory_workspace_changes(p_workspace_id uuid, p_owner_id uuid, p_profile_kind text, p_expected_revision bigint, p_changes jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare w public.territory_lab_workspaces; state jsonb; change jsonb; collection text; key text; rows jsonb; additions jsonb; removals text[]; target text[];
begin
  if p_owner_id is null or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id) then raise exception 'Workspace owner mismatch' using errcode = '42501'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) > 50000 then raise exception 'Invalid changes' using errcode = '22023'; end if;
  select * into w from public.territory_lab_workspaces where id = p_workspace_id for update;
  if not found or w.owner_id <> p_owner_id or w.profile_kind <> p_profile_kind or w.revision <> p_expected_revision then raise exception 'Territory revision conflict' using errcode = '40001'; end if;
  if jsonb_array_length(p_changes) = 0 then return w.revision; end if;
  if (select count(*) from jsonb_array_elements(p_changes)) <> (select count(distinct (value->>'collection',value->>'key')) from jsonb_array_elements(p_changes)) then raise exception 'Duplicate change address' using errcode = '22023'; end if;
  state := w.state;
  for change in select value from jsonb_array_elements(p_changes) loop
    collection := change->>'collection'; key := change->>'key';
    if collection is null or key is null or key = '' or change->>'deleted' is not null and change->>'deleted' not in ('true','false') then raise exception 'Invalid change address' using errcode = '22023'; end if;
    if collection = any(array['streets','runs','events','history']) then
      if not coalesce((change->>'deleted')::boolean,false) and change->'value'->>'id' is distinct from key then raise exception 'Record identity mismatch' using errcode = '22023'; end if;
    elsif collection = any(array['cloud:people','cloud:properties','memories','units','checkpoints','virtualCrm','virtualPeople','virtualActivities','historicalStreetMappings','networkBindings','zones','savedQueries','importQueue','quarantine','syncConflicts']) then
      if not coalesce((change->>'deleted')::boolean,false) and (not change ? 'value' or change->'value' = 'null'::jsonb) then raise exception 'Missing record value' using errcode = '22023'; end if;
    elsif collection = 'meta' and key = 'version' and change->'value' = '1'::jsonb then
      null;
    else raise exception 'Unknown collection' using errcode = '22023'; end if;
  end loop;
  -- Apply each collection once. A recovered offline archive may contain thousands
  -- of records; repeatedly copying the entire JSON for every record is quadratic.
  for collection in select distinct value->>'collection' from jsonb_array_elements(p_changes) loop
    if collection = 'meta' then continue; end if;
    select coalesce(jsonb_object_agg(value->>'key',value->'value') filter(where not coalesce((value->>'deleted')::boolean,false)), '{}'::jsonb),
      coalesce(array_agg(value->>'key') filter(where coalesce((value->>'deleted')::boolean,false)), array[]::text[])
    into additions, removals from jsonb_array_elements(p_changes) where value->>'collection' = collection;
    if collection = any(array['streets','runs','events','history']) then
      select coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) into rows from jsonb_array_elements(coalesce(state->collection,'[]'::jsonb));
      rows := (rows || additions) - removals;
      select coalesce(jsonb_agg(e.value order by coalesce(e.value->>'startedAt',e.value->>'at',''),e.key),'[]'::jsonb) into rows from jsonb_each(rows) e;
      state := jsonb_set(state,array[collection],rows);
    elsif collection like 'cloud:%' then
      state := jsonb_set(state,'{cloudMemory}',coalesce(state->'cloudMemory','{"people":{},"properties":{}}'::jsonb));
      target := array['cloudMemory',substr(collection,7)];
      state := jsonb_set(state,target,(coalesce(state #> target,'{}'::jsonb) || additions) - removals);
    else state := jsonb_set(state,array[collection],(coalesce(state->collection,'{}'::jsonb) || additions) - removals);
    end if;
  end loop;
  return public.save_territory_lab_workspace(p_workspace_id,p_owner_id,p_profile_kind,p_expected_revision,state);
end; $$;
revoke all on function public.territory_state_records(jsonb), public.territory_index_workspace() from public, anon, authenticated;
revoke all on function public.read_territory_workspace_changes(uuid,uuid,text,bigint), public.save_territory_workspace_changes(uuid,uuid,text,bigint,jsonb) from public, anon;
grant execute on function public.read_territory_workspace_changes(uuid,uuid,text,bigint), public.save_territory_workspace_changes(uuid,uuid,text,bigint,jsonb) to authenticated, service_role;
notify pgrst, 'reload schema';
