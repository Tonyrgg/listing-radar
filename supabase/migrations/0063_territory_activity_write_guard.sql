-- Short-lived coordination, not CRM history. One customer/day across workstations.
begin;
create table public.territory_activity_write_claims(
 workspace_id uuid not null references public.territory_lab_workspaces(id) on delete cascade,
 client_key text not null check(client_key ~ '^[0-9a-f]{64}$'),
 activity_day date not null,operation_id uuid not null,
 state text not null check(state in ('reserved','submitted','confirmed')),
 proof jsonb,updated_at timestamptz not null default now(),
 primary key(workspace_id,client_key,activity_day)
);
alter table public.territory_activity_write_claims enable row level security;
revoke all on public.territory_activity_write_claims from anon,authenticated;
grant all on public.territory_activity_write_claims to service_role;
create function public.territory_activity_write_guard(
 p_workspace_id uuid,p_owner_id uuid,p_client_key text,p_day date,p_operation_id uuid,p_action text,p_proof jsonb default null
)returns jsonb language plpgsql security definer set search_path='' as $$
declare claim public.territory_activity_write_claims;today date:=(now() at time zone 'Europe/Rome')::date;
begin
 if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id then raise exception 'Owner mismatch' using errcode='42501';end if;
 if not exists(select 1 from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and profile_kind='live') then raise exception 'Workspace mismatch' using errcode='42501';end if;
 if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' or p_operation_id is null or p_day is null or p_action is null or p_action not in ('reserve','submitted','confirm','release') then raise exception 'Invalid activity claim' using errcode='22023';end if;
 if p_action in ('reserve','submitted') and p_day<>today then raise exception 'Activity day changed; reconcile before writing' using errcode='22023';end if;
 if p_action='reserve' then
  -- Past claims cannot authorise today's writes; full CRM history stays intact.
  delete from public.territory_activity_write_claims where workspace_id=p_workspace_id and activity_day<today-3;
  insert into public.territory_activity_write_claims(workspace_id,client_key,activity_day,operation_id,state)
   values(p_workspace_id,p_client_key,p_day,p_operation_id,'reserved') on conflict do nothing;
 end if;
 select * into claim from public.territory_activity_write_claims
  where workspace_id=p_workspace_id and client_key=p_client_key and activity_day=p_day for update;
 if not found then return jsonb_build_object('granted',false,'submitted',false,'proof',null);end if;
 if claim.operation_id<>p_operation_id then return jsonb_build_object('granted',false,'submitted',claim.state<>'reserved','proof',claim.proof);end if;
 if p_action='submitted' and claim.state='reserved' then
  update public.territory_activity_write_claims set state='submitted',updated_at=now() where workspace_id=p_workspace_id and client_key=p_client_key and activity_day=p_day;
 elsif p_action='confirm' then
  if p_proof is null or coalesce(p_proof->>'id','') !~ '^00T[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$'
   or coalesce(p_proof->>'propertyId','')='' or coalesce(p_proof->>'clientId','')=''
   or (p_proof->>'createdAt') is distinct from p_day::text or coalesce(p_proof->>'status','') not in ('Eseguito','Da eseguire') then raise exception 'Invalid Task proof' using errcode='22023';end if;
  update public.territory_activity_write_claims set state='confirmed',updated_at=now(),proof=jsonb_build_object(
   'id',p_proof->>'id','propertyId',p_proof->>'propertyId','clientId',p_proof->>'clientId',
   'activityDate',null,'status',p_proof->>'status','createdAt',p_day::text,'description','')
   where workspace_id=p_workspace_id and client_key=p_client_key and activity_day=p_day;
 elsif p_action='release' and claim.state='reserved' then
  delete from public.territory_activity_write_claims where workspace_id=p_workspace_id and client_key=p_client_key and activity_day=p_day;
 end if;
 return jsonb_build_object('granted',true,'submitted',claim.state<>'reserved' or p_action in ('submitted','confirm'),'proof',claim.proof);
end $$;
revoke all on function public.territory_activity_write_guard(uuid,uuid,text,date,uuid,text,jsonb) from public,anon;
grant execute on function public.territory_activity_write_guard(uuid,uuid,text,date,uuid,text,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
