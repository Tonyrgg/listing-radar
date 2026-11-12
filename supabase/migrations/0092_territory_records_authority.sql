begin;
-- Normalized records are the operational authority. The old snapshot remains a
-- version-labelled bootstrap/backup, never an independently writable live copy.
alter table public.territory_lab_workspaces add column snapshot_revision bigint not null default 0;
update public.territory_lab_workspaces set snapshot_revision=revision;
create function public.territory_snapshot_revision() returns trigger language plpgsql set search_path='' as $$
begin new.snapshot_revision:=new.revision;return new;end $$;
create trigger territory_snapshot_revision before insert or update of state on public.territory_lab_workspaces for each row execute function public.territory_snapshot_revision();
revoke all on function public.territory_snapshot_revision() from public,anon,authenticated;

create or replace function public.save_territory_workspace_changes(p_workspace_id uuid,p_owner_id uuid,p_profile_kind text,p_expected_revision bigint,p_changes jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare current_owner uuid;current_kind text;current_revision bigint;next_revision bigint;
begin
 if p_owner_id is null or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id) then raise exception 'Workspace owner mismatch' using errcode='42501';end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>50000 then raise exception 'Invalid changes' using errcode='22023';end if;
 select owner_id,profile_kind,revision into current_owner,current_kind,current_revision from public.territory_lab_workspaces where id=p_workspace_id for update;
 if not found or current_owner is distinct from p_owner_id or current_kind is distinct from p_profile_kind or current_revision is distinct from p_expected_revision then raise exception 'Territory revision conflict' using errcode='40001';end if;
 if jsonb_array_length(p_changes)=0 then return current_revision;end if;
 if (select count(*) from jsonb_array_elements(p_changes))<>(select count(distinct(e->>'collection',e->>'key')) from jsonb_array_elements(p_changes) e) then raise exception 'Duplicate change address' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) e where
  e->>'collection' is null or e->>'key' is null or e->>'key'='' or (e->>'deleted' is not null and e->>'deleted' not in ('true','false'))
  or case
   when e->>'collection'=any(array['streets','runs','events','history']) then not coalesce((e->>'deleted')::boolean,false) and e->'value'->>'id' is distinct from e->>'key'
   when e->>'collection'=any(array['cloud:people','cloud:properties','memories','units','checkpoints','virtualCrm','virtualPeople','virtualActivities','historicalStreetMappings','networkBindings','zones','savedQueries','importQueue','quarantine','syncConflicts']) then not coalesce((e->>'deleted')::boolean,false) and (not e ? 'value' or e->'value'='null'::jsonb)
   when e->>'collection'='meta' and e->>'key'='version' and e->'value'='1'::jsonb and not coalesce((e->>'deleted')::boolean,false) then false
   else true end
 ) then raise exception 'Invalid change' using errcode='22023';end if;
 next_revision:=current_revision+1;
 insert into public.territory_workspace_records(workspace_id,collection,record_key,revision,value,deleted)
 select p_workspace_id,e->>'collection',e->>'key',next_revision,
  case when coalesce((e->>'deleted')::boolean,false) then null else e->'value' end,coalesce((e->>'deleted')::boolean,false)
 from jsonb_array_elements(p_changes) e
 on conflict on constraint territory_workspace_records_pkey do update set revision=excluded.revision,value=excluded.value,deleted=excluded.deleted;
 update public.territory_lab_workspaces set revision=next_revision,updated_at=now() where id=p_workspace_id;
 insert into public.territory_lab_sync_events(workspace_id,owner_id,revision) values(p_workspace_id,p_owner_id,next_revision);
 return next_revision;
end $$;

-- An old full-snapshot writer cannot replace facts received through the record
-- API. It must recover through the incremental API already used by Worker V2.
create function public.territory_protect_live_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if old.profile_kind='live' and old.snapshot_revision<>old.revision then raise exception 'Use incremental recovery: live records are newer than this snapshot' using errcode='40001';end if;
 return new;
end $$;
create trigger territory_protect_live_snapshot before update of state on public.territory_lab_workspaces for each row execute function public.territory_protect_live_snapshot();
revoke all on function public.territory_protect_live_snapshot() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
