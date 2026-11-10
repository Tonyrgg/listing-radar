begin;
create foreign table radar_external.retired_rows(source text,dataset text,table_name text,row_id text,payload jsonb,digest text,copied_at timestamptz)
server radar_prisma_archive options(schema_name 'radar_archive',table_name 'retired_rows',updatable 'false');
create table public.retired_section_operations(dataset text,table_name text,removed bigint not null default 0,backup_name text not null,updated_at timestamptz not null default now(),primary key(dataset,table_name));
alter table public.retired_section_operations enable row level security;
grant select on public.retired_section_operations to service_role;
create function public.retire_matching_data_batch(p_table text,p_ids uuid[],p_backup_name text)returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare src text;diff integer;n integer;ds constant text:='retired-matching-2026-11-10';
begin
 if auth.role()is distinct from 'service_role' then raise exception 'Service role required';end if;
 if p_table<>all(array['request_property_matches','request_zones','request_feature_preferences','property_feature_values','crm_request_import_items','crm_mandate_import_items','crm_request_import_runs','crm_mandate_import_runs','matching_activity_logs','property_requests','portfolio_properties'])or p_table is null then raise exception 'Table outside approved sections';end if;
 if p_ids is null or cardinality(p_ids)>250 or array_position(p_ids,null)is not null then raise exception 'Bounded IDs required';end if;
 if p_backup_name!~'^retired-sections/retired-matching-2026-11-10-[a-f0-9]{64}\.jsonl\.gz$' or not exists(select 1 from storage.objects where bucket_id='radar-archive-backups'and name=p_backup_name)then raise exception 'Private dataset backup required';end if;
 select source into strict src from public.fingerprint_archive_external_config where singleton;
 lock table public.property_requests,public.portfolio_properties,public.request_property_matches,public.request_zones,public.request_feature_preferences,public.property_feature_values,public.crm_request_import_items,public.crm_mandate_import_items,public.crm_request_import_runs,public.crm_mandate_import_runs in share row exclusive mode;
 if p_table='property_requests' and(exists(select 1 from request_property_matches where request_id=any(p_ids))or exists(select 1 from request_zones where request_id=any(p_ids))or exists(select 1 from request_feature_preferences where request_id=any(p_ids))or exists(select 1 from crm_request_import_items where imported_request_id=any(p_ids))or exists(select 1 from acquisition_leads where request_id=any(p_ids))or exists(select 1 from acquisition_lead_requests where request_id=any(p_ids))or exists(select 1 from logbook_entries where request_id=any(p_ids)))then raise exception 'Request has remaining dependencies';end if;
 if p_table='portfolio_properties'and(exists(select 1 from request_property_matches where property_id=any(p_ids))or exists(select 1 from property_feature_values where property_id=any(p_ids))or exists(select 1 from crm_mandate_import_items where imported_property_id=any(p_ids)))then raise exception 'Portfolio has remaining dependencies';end if;
 if p_table='crm_request_import_runs'and exists(select 1 from crm_request_import_items where run_id=any(p_ids))then raise exception 'Import has remaining dependencies';end if;
 if p_table='crm_mandate_import_runs'and exists(select 1 from crm_mandate_import_items where run_id=any(p_ids))then raise exception 'Import has remaining dependencies';end if;
 create temporary table if not exists retire_verified_payloads(id text primary key,payload jsonb)on commit drop;
 truncate retire_verified_payloads;
 insert into retire_verified_payloads select row_id,payload from radar_external.retired_rows where source=src and dataset=ds and table_name=p_table and row_id=any(p_ids::text[]);
 execute format('select count(*)from public.%I l left join retire_verified_payloads r on r.id=l.id::text where l.id=any($1)and r.payload is distinct from to_jsonb(l)',p_table)into diff using p_ids;
 if diff<>0 then raise exception 'External copy differs: source preserved';end if;
 execute format('delete from public.%I where id=any($1)',p_table)using p_ids;get diagnostics n=row_count;
 insert into public.retired_section_operations(dataset,table_name,removed,backup_name)values(ds,p_table,n,p_backup_name)on conflict(dataset,table_name)do update set removed=retired_section_operations.removed+excluded.removed,updated_at=now();
 return n;
end$$;
revoke all on function public.retire_matching_data_batch(text,uuid[],text)from public,anon,authenticated;
grant execute on function public.retire_matching_data_batch(text,uuid[],text)to service_role;
notify pgrst,'reload schema';
commit;
