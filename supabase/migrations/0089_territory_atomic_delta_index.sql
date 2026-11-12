begin;
create or replace function public.territory_index_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- The delta RPC updates the index itself, in the same transaction. Full
 -- snapshot callers retain the complete compatibility projection below.
 if current_setting('app.territory_delta_workspace',true)=new.id::text then return new;end if;
 with incoming as materialized (
  select r.collection,r.record_key,r.value from public.territory_state_records(new.state) r
 ), upserted as (
  insert into public.territory_workspace_records(workspace_id,collection,record_key,revision,value,deleted)
  select new.id,r.collection,r.record_key,new.revision,r.value,false from incoming r
  on conflict on constraint territory_workspace_records_pkey do update
   set revision=excluded.revision,value=excluded.value,deleted=false
   where territory_workspace_records.value is distinct from excluded.value or territory_workspace_records.deleted
  returning 1
 )
 update public.territory_workspace_records indexed
 set revision=new.revision,value=null,deleted=true
 where indexed.workspace_id=new.id and not indexed.deleted
 and (indexed.collection,indexed.record_key) not in (select collection,record_key from incoming);
 return new;
end $$;

create or replace function public.save_territory_workspace_changes(p_workspace_id uuid, p_owner_id uuid, p_profile_kind text, p_expected_revision bigint, p_changes jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare w public.territory_lab_workspaces; state jsonb; change jsonb; collection text; key text; rows jsonb; additions jsonb; removals text[]; target text[]; next_revision bigint; previous_marker text;
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
  -- Same row lock, same atomic revision, but index only the acknowledged patch.
  previous_marker := current_setting('app.territory_delta_workspace',true);
  perform set_config('app.territory_delta_workspace',p_workspace_id::text,true);
  next_revision := public.save_territory_lab_workspace(p_workspace_id,p_owner_id,p_profile_kind,p_expected_revision,state);
  perform set_config('app.territory_delta_workspace',coalesce(previous_marker,''),true);
  insert into public.territory_workspace_records(workspace_id,collection,record_key,revision,value,deleted)
  select p_workspace_id,e->>'collection',e->>'key',next_revision,
    case when coalesce((e->>'deleted')::boolean,false) then null else e->'value' end,
    coalesce((e->>'deleted')::boolean,false)
  from jsonb_array_elements(p_changes) e
  on conflict on constraint territory_workspace_records_pkey do update
    set revision=excluded.revision,value=excluded.value,deleted=excluded.deleted;
  return next_revision;
end; $$;

notify pgrst, 'reload schema';
commit;
