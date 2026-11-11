begin;
create extension if not exists postgres_fdw;
create schema if not exists radar_external;
revoke all on schema radar_external from public,anon,authenticated,service_role;
create table public.fingerprint_archive_external_config(
 singleton boolean primary key default true check(singleton),source text not null check(source~'^[a-f0-9]{64}$'),
 configured_at timestamptz not null default now()
);
alter table public.fingerprint_archive_external_config enable row level security;
grant select on public.fingerprint_archive_external_config to service_role;
create table public.fingerprint_archive_receipts(
 id bigint primary key,property_id uuid references public.properties(id) on delete restrict,
 publication_id uuid references public.publications(id) on delete restrict,
 algorithm text,fingerprint text,observation_count integer not null,
 payload_md5 text not null,verified_at timestamptz not null default now()
);
alter table public.fingerprint_archive_receipts enable row level security;
create policy fingerprint_receipt_read on public.fingerprint_archive_receipts for select to authenticated using(true);
grant select on public.fingerprint_archive_receipts to authenticated,service_role;
create index fingerprint_receipt_property on public.fingerprint_archive_receipts(property_id);
create index fingerprint_receipt_publication on public.fingerprint_archive_receipts(publication_id);

create function public.configure_fingerprint_archive_connection(p_host text,p_port integer,p_database text,p_user text,p_password text,p_source text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if p_host<>'db.prisma.io' or p_port<>5432 or p_source!~'^[a-f0-9]{64}$' or p_database='' or p_user='' or p_password='' then raise exception 'Explicit Prisma connection required';end if;
 if exists(select 1 from pg_foreign_server where srvname='radar_prisma_archive') then raise exception 'Connection already configured';end if;
 execute format('create server radar_prisma_archive foreign data wrapper postgres_fdw options(host %L,port %L,dbname %L,sslmode %L,sslrootcert %L,connect_timeout %L,fetch_size %L,updatable %L)',p_host,p_port::text,p_database,'verify-full','system','10','100','false');
 execute format('create user mapping for postgres server radar_prisma_archive options(user %L,password %L)',p_user,p_password);
 execute 'create foreign table radar_external.fingerprint_groups(source text,id bigint,property_id uuid,publication_id uuid,algorithm text,fingerprint text,payload jsonb,digest text,copied_at timestamptz) server radar_prisma_archive options(schema_name ''radar_archive'',table_name ''fingerprint_groups'',updatable ''false'')';
 insert into public.fingerprint_archive_external_config(singleton,source)values(true,p_source);
 perform 1 from radar_external.fingerprint_groups where source=p_source limit 1;
 return true;
end $$;
revoke all on function public.configure_fingerprint_archive_connection(text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.configure_fingerprint_archive_connection(text,integer,text,text,text,text) to service_role;

create function public.read_external_fingerprint_groups(p_ids bigint[] default null,p_property_ids uuid[] default null)
returns table(id bigint,property_id uuid,publication_id uuid,row_data jsonb,observations jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare src text;
begin
 select source into strict src from public.fingerprint_archive_external_config where singleton;
 return query select f.id,f.property_id,f.publication_id,f.payload->'row_data',f.payload->'observations'
 from radar_external.fingerprint_groups f
 where f.source=src and (p_ids is null or f.id=any(p_ids)) and (p_property_ids is null or f.property_id=any(p_property_ids));
end $$;
revoke all on function public.read_external_fingerprint_groups(bigint[],uuid[]) from public,anon;
grant execute on function public.read_external_fingerprint_groups(bigint[],uuid[]) to authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit)values('radar-archive-backups','radar-archive-backups',false,100000000) on conflict(id)do nothing;
notify pgrst,'reload schema';
commit;
