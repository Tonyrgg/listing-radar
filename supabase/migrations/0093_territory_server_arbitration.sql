begin;
-- The committed server value stays authoritative. Retain both proposals as
-- non-blocking audit history; older clients also receive the resolved record.
create function public.territory_server_arbitrate_conflict() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.collection='syncConflicts' and not new.deleted
  and (new.value->>'resolvedAt') is null
  and exists(select 1 from public.territory_lab_workspaces w where w.id=new.workspace_id and w.profile_kind='live') then
  new.value:=new.value||jsonb_build_object('resolvedAt',coalesce(new.value->>'detectedAt',now()::text),'resolution','server_authority');
 end if;
 return new;
end $$;
create trigger territory_server_arbitrate_conflict before insert or update on public.territory_workspace_records
for each row execute function public.territory_server_arbitrate_conflict();
revoke all on function public.territory_server_arbitrate_conflict() from public,anon,authenticated;

-- Publish the repair through the normal revision stream. Never rewrite units,
-- owners, acquisition checkpoints, queue selections or CRM completion proofs.
do $$ declare w record; next_revision bigint;
begin
 for w in select id,owner_id,revision from public.territory_lab_workspaces where profile_kind='live' for update loop
  next_revision:=w.revision+1;
  update public.territory_workspace_records set revision=next_revision,
   value=value||jsonb_build_object('resolvedAt',coalesce(value->>'detectedAt',now()::text),'resolution','server_authority')
  where workspace_id=w.id and collection='syncConflicts' and not deleted and (value->>'resolvedAt') is null;
  if found then
   update public.territory_lab_workspaces set revision=next_revision,updated_at=now() where id=w.id;
   insert into public.territory_lab_sync_events(workspace_id,owner_id,revision) values(w.id,w.owner_id,next_revision);
  end if;
 end loop;
end $$;
commit;
