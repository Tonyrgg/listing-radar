begin;
create table public.territory_operation_leases(workspace_id uuid primary key references public.territory_lab_workspaces(id) on delete cascade,owner_id uuid not null,device_id uuid not null,token uuid not null,expires_at timestamptz not null);
alter table public.territory_operation_leases enable row level security;
revoke all on public.territory_operation_leases from public,anon,authenticated;
create function public.acquire_territory_operation(p_workspace_id uuid,p_owner_id uuid,p_device_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lease public.territory_operation_leases;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker credentials required' using errcode='42501';end if;
 if p_device_id is null or p_token is null or not exists(select 1 from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and profile_kind='live') then raise exception 'Workspace mismatch' using errcode='42501';end if;
 insert into public.territory_operation_leases values(p_workspace_id,p_owner_id,p_device_id,p_token,now()+interval '90 seconds') on conflict do nothing;
 select * into strict lease from public.territory_operation_leases where workspace_id=p_workspace_id for update;
 if lease.owner_id<>p_owner_id then raise exception 'Owner mismatch' using errcode='42501';end if;
 if lease.token<>p_token and (lease.device_id<>p_device_id or lease.expires_at>now()) then
 return jsonb_build_object('acquired',false,'reason',case when lease.expires_at>now() then 'Un altro Worker ha una lavorazione attiva. Attendi il suo salvataggio finale.' else 'Un altro PC ha una sessione interrotta da sincronizzare. Riapri Worker V2 su quel PC prima di continuare.' end);end if;
 update public.territory_operation_leases set device_id=p_device_id,token=p_token,expires_at=now()+interval '90 seconds' where workspace_id=p_workspace_id;
 return jsonb_build_object('acquired',true);
end $$;
create function public.renew_territory_operation(p_workspace_id uuid,p_owner_id uuid,p_device_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker credentials required' using errcode='42501';end if;
 update public.territory_operation_leases set expires_at=now()+interval '90 seconds' where workspace_id=p_workspace_id and owner_id=p_owner_id and device_id=p_device_id and token=p_token and expires_at>now();return found;
end $$;
create function public.release_territory_operation(p_workspace_id uuid,p_owner_id uuid,p_device_id uuid,p_token uuid,p_synced_revision bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker credentials required' using errcode='42501';end if;
 perform 1 from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and revision=p_synced_revision for share;
 if not found then return false;end if;
 delete from public.territory_operation_leases where workspace_id=p_workspace_id and owner_id=p_owner_id and device_id=p_device_id and token=p_token;return found;
end $$;
revoke all on function public.acquire_territory_operation(uuid,uuid,uuid,uuid),public.renew_territory_operation(uuid,uuid,uuid,uuid),public.release_territory_operation(uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.acquire_territory_operation(uuid,uuid,uuid,uuid),public.renew_territory_operation(uuid,uuid,uuid,uuid),public.release_territory_operation(uuid,uuid,uuid,uuid,bigint) to service_role;
commit;
