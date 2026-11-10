-- Run only on the explicitly selected external PostgreSQL database.
create schema if not exists radar_archive;
create table if not exists radar_archive.sources (
 source text primary key, last_id bigint not null default 0, updated_at timestamptz not null default now()
);
create table if not exists radar_archive.fingerprint_groups (
 source text not null references radar_archive.sources(source),
 id bigint not null, property_id uuid, publication_id uuid,
 algorithm text, fingerprint text,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 digest text not null, copied_at timestamptz not null default now(),
 primary key(source,id)
);
create index if not exists fingerprint_group_property on radar_archive.fingerprint_groups(source,property_id);
create index if not exists fingerprint_group_value on radar_archive.fingerprint_groups(source,algorithm,fingerprint);
