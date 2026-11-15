begin;
-- Read only the live owner's street directory, never owners, contacts or checkpoints.
create function public.read_worker_street_directory(p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare workspace uuid;rev bigint;items jsonb;
begin
 if p_owner_id is null or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_owner_id) then raise exception 'Workspace owner mismatch' using errcode='42501';end if;
 select id,revision into workspace,rev from public.territory_lab_workspaces where owner_id=p_owner_id and profile_kind='live';
 if workspace is null then return jsonb_build_object('revision',0,'streets','[]'::jsonb);end if;
 with records as materialized(select collection,record_key,value from public.territory_workspace_records where workspace_id=workspace and not deleted and collection in ('streets','memories','runs','units')),
 members as(select coalesce(s.value->>'linkedOfficialId',member.id) street_id,count(distinct u.record_key) total from records u cross join lateral jsonb_array_elements_text(u.value->'streetIds') member(id) left join records s on s.collection='streets' and s.record_key=member.id where u.collection='units' group by 1),
 scans as(select value->>'streetId' street_id,max(value->>'endedAt') at from records where collection='runs' and value->>'operation'='scan' and value->>'state'='completed' group by 1)
 select coalesce(jsonb_agg(jsonb_build_object('id',s.record_key,'name',s.value->>'name','locality',s.value->>'locality','sisterName',s.value->>'sisterName','geometry',s.value->'geometry','needsReview',s.value->'needsReview','linkedOfficialId',s.value->'linkedOfficialId','outsideUrbanArea',s.value->'outsideUrbanArea','count',coalesce(u.total,0),'lastScanAt',scan.at,'searchText',m.value#>>'{sisterSearch,searchText}','resultName',m.value#>>'{sisterSearch,resultName}') order by s.value->>'name'),'[]'::jsonb)
 into items from records s left join records m on m.collection='memories' and m.record_key=s.record_key left join members u on u.street_id=s.record_key left join scans scan on scan.street_id=s.record_key where s.collection='streets';
 return jsonb_build_object('revision',rev,'streets',items);
end$$;
revoke all on function public.read_worker_street_directory(uuid) from public,anon;
grant execute on function public.read_worker_street_directory(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
