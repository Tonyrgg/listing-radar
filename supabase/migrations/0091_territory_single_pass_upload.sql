begin;
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
  -- Parse and group the upload once. Build each changed root independently,
  -- then rebuild the snapshot once instead of repeatedly copying its megabytes.
  with changes as materialized (select e from jsonb_array_elements(p_changes) e),
  grouped as materialized (
    select e->>'collection' collection,
      coalesce(jsonb_object_agg(e->>'key',e->'value') filter(where not coalesce((e->>'deleted')::boolean,false)),'{}'::jsonb) additions,
      coalesce(array_agg(e->>'key') filter(where coalesce((e->>'deleted')::boolean,false)),array[]::text[]) removals
    from changes group by e->>'collection'
  ), roots as materialized (select x.key,x.value from jsonb_each(w.state) x),
  replacements as materialized (
    select g.collection key,case when g.collection=any(array['streets','runs','events','history']) then
      (select coalesce(jsonb_agg(e.value order by coalesce(e.value->>'startedAt',e.value->>'at',''),e.key),'[]'::jsonb)
       from jsonb_each((coalesce((select jsonb_object_agg(x->>'id',x) from jsonb_array_elements(coalesce(r.value,'[]'::jsonb)) x),'{}'::jsonb)||g.additions)-g.removals) e)
      else (coalesce(r.value,'{}'::jsonb)||g.additions)-g.removals end value
    from grouped g left join roots r on r.key=g.collection
    where g.collection<>'meta' and g.collection not like 'cloud:%'
    union all
    select 'cloudMemory', r.value || (select jsonb_object_agg(substr(g.collection,7),(coalesce(r.value->substr(g.collection,7),'{}'::jsonb)||g.additions)-g.removals) from grouped g where g.collection like 'cloud:%')
    from (select coalesce((select x.value from roots x where x.key='cloudMemory'),'{"people":{},"properties":{}}'::jsonb) value) r
    where exists(select 1 from grouped g where g.collection like 'cloud:%')
  ), result as (
    select r.key,coalesce(p.value,r.value) value from roots r left join replacements p on p.key=r.key
    union all select p.key,p.value from replacements p where not exists(select 1 from roots r where r.key=p.key)
  ) select jsonb_object_agg(r.key,r.value) into state from result r;
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

notify pgrst,'reload schema';
commit;
