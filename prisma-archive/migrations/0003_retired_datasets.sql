create table if not exists radar_archive.retired_rows(
 source text not null,dataset text not null,table_name text not null,row_id text not null,
 payload jsonb not null,digest text not null,copied_at timestamptz not null default now(),
 primary key(source,dataset,table_name,row_id)
);
create trigger protect_retired_rows before update or delete on radar_archive.retired_rows
for each row execute function radar_archive.protect_group();
