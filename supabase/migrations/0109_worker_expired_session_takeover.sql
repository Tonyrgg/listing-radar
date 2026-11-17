begin;
create or replace function public.acquire_territory_operation(p_workspace_id uuid,p_owner_id uuid,p_device_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lease public.territory_operation_leases;recovered boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker credentials required' using errcode='42501';end if;
 if p_device_id is null or p_token is null or not exists(select 1 from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and profile_kind='live') then raise exception 'Workspace mismatch' using errcode='42501';end if;
 insert into public.territory_operation_leases values(p_workspace_id,p_owner_id,p_device_id,p_token,now()+interval '90 seconds') on conflict do nothing;
 select * into strict lease from public.territory_operation_leases where workspace_id=p_workspace_id for update;
 if lease.owner_id<>p_owner_id then raise exception 'Owner mismatch' using errcode='42501';end if;
 if (lease.token<>p_token or lease.device_id<>p_device_id) and lease.expires_at>now() then return jsonb_build_object('acquired',false,'reason','Un altro Worker ha una lavorazione attiva. Attendi il suo salvataggio finale.');end if;
 recovered:=lease.token<>p_token or lease.device_id<>p_device_id;
 update public.territory_operation_leases set device_id=p_device_id,token=p_token,expires_at=now()+interval '90 seconds' where workspace_id=p_workspace_id;
 return jsonb_build_object('acquired',true,'recovered',recovered);
end $$;
create or replace function public.release_territory_operation(p_workspace_id uuid,p_owner_id uuid,p_device_id uuid,p_token uuid,p_synced_revision bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare lease public.territory_operation_leases;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker credentials required' using errcode='42501';end if;
 if not exists(select 1 from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and profile_kind='live') then raise exception 'Workspace mismatch' using errcode='42501';end if;
 select * into lease from public.territory_operation_leases where workspace_id=p_workspace_id for update;
 -- A stale client may acknowledge its own close, but can never remove the successor's lease.
 if not found then return true;end if;
 if lease.owner_id<>p_owner_id then raise exception 'Owner mismatch' using errcode='42501';end if;
 if lease.token<>p_token or lease.device_id<>p_device_id then return true;end if;
 perform 1 from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and revision=p_synced_revision for share;
 if not found then return false;end if;
 delete from public.territory_operation_leases where workspace_id=p_workspace_id and owner_id=p_owner_id and device_id=p_device_id and token=p_token;return found;
end $$;
notify pgrst,'reload schema';
commit;
