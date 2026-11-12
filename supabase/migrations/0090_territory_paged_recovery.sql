begin;
-- Six-argument overload: old Workers keep the four-argument API. New Workers
-- never aggregate the complete archive in one request during recovery.
create function public.read_territory_workspace_changes(
 p_workspace_id uuid,p_owner_id uuid,p_profile_kind text,p_since bigint,
 p_after jsonb,p_until bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_revision bigint; batch jsonb; cursor jsonb; page_count integer;
begin
 if p_owner_id is null or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id) then raise exception 'Workspace owner mismatch' using errcode='42501';end if;
 if p_since is null or p_since<0 or p_after is not null and (jsonb_typeof(p_after)<>'object' or p_after->>'collection' is null or p_after->>'key' is null) then raise exception 'Invalid cursor' using errcode='22023';end if;
 select revision into current_revision from public.territory_lab_workspaces where id=p_workspace_id and owner_id=p_owner_id and profile_kind=p_profile_kind for share;
 if not found then return jsonb_build_object('revision',0,'changes','[]'::jsonb,'next',null);end if;
 if p_since>current_revision or p_until is not null and p_until<>current_revision then raise exception 'Territory revision changed during recovery' using errcode='40001';end if;
 with candidates as materialized (
  select collection,record_key,value,deleted from public.territory_workspace_records
  where workspace_id=p_workspace_id and revision>p_since
  and (p_after is null or (collection,record_key)>(p_after->>'collection',p_after->>'key'))
  order by collection,record_key limit 101
 ), page as materialized(select * from candidates order by collection,record_key limit 100)
 select (select count(*) from candidates),
  coalesce((select jsonb_agg(jsonb_build_object('collection',collection,'key',record_key,'value',value,'deleted',deleted) order by collection,record_key) from page),'[]'::jsonb),
  (select jsonb_build_object('collection',collection,'key',record_key) from page order by collection desc,record_key desc limit 1)
 into page_count,batch,cursor;
 return jsonb_build_object('revision',current_revision,'changes',batch,'next',case when page_count>100 then cursor else null end);
end $$;
revoke all on function public.read_territory_workspace_changes(uuid,uuid,text,bigint,jsonb,bigint) from public,anon;
grant execute on function public.read_territory_workspace_changes(uuid,uuid,text,bigint,jsonb,bigint) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
