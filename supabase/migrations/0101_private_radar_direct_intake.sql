begin;
-- V2 observations no longer require an insert into the retired listings archive.
alter table public.private_publications alter column legacy_listing_id drop not null;
alter table public.private_publications add constraint private_publications_direct_id_required check(legacy_listing_id is not null or source_listing_id is not null);
create unique index private_publications_direct_source_idx
 on public.private_publications(source,source_listing_id) where legacy_listing_id is null;
create table public.private_radar_inbox (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('idealista','immobiliare','casa','subito','casadaprivato')),
 source_listing_id text not null,
 canonical_url text not null check(canonical_url like 'https://%'),
 first_seen_at timestamptz not null default now(),
 last_checked_at timestamptz,
 next_check_at timestamptz not null default now(),
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','EXCLUDED','FAILED')),
 last_error text,
 unique(source,source_listing_id)
);
create index private_radar_inbox_due_idx on public.private_radar_inbox(source,next_check_at,id);
create table public.private_radar_source_health (
 source text primary key,
 checked_at timestamptz not null,
 state text not null check(state in ('OBSERVED','DEGRADED')),
 pages_visited integer not null default 0,
 discovered_count integer not null default 0,
 failed_count integer not null default 0,
 diagnostics jsonb not null default '[]',
 absence_authoritative boolean not null default false check(not absence_authoritative)
);
create table public.private_radar_lease (
 singleton boolean primary key default true check(singleton),
 owner uuid not null,
 expires_at timestamptz not null
);
create function public.claim_private_radar(p_owner uuid) returns boolean
 language plpgsql security definer set search_path=public as $$
begin
 insert into private_radar_lease values(true,p_owner,now()+interval '5 minutes')
 on conflict(singleton) do update set owner=excluded.owner,expires_at=excluded.expires_at
 where private_radar_lease.expires_at<now() or private_radar_lease.owner=p_owner;
 return found;
end $$;
create function public.release_private_radar(p_owner uuid) returns void
 language sql security definer set search_path=public as $$
 delete from private_radar_lease where owner=p_owner;
$$;
revoke all on function public.claim_private_radar(uuid),public.release_private_radar(uuid) from public,anon,authenticated;
grant execute on function public.claim_private_radar(uuid),public.release_private_radar(uuid) to service_role;
alter table public.private_radar_inbox enable row level security;
alter table public.private_radar_source_health enable row level security;
alter table public.private_radar_lease enable row level security;
grant select on public.private_radar_inbox,public.private_radar_source_health to authenticated;
grant all on public.private_radar_inbox,public.private_radar_source_health,public.private_radar_lease to service_role;
create policy private_radar_health_read on public.private_radar_source_health for select to authenticated using(true);
create policy private_radar_inbox_read on public.private_radar_inbox for select to authenticated using(true);
-- Active private/uncertain sellers are also actionable in Opportunities. These
-- are priority weights, never probabilities or proof of a terminated mandate.
update public.market_observer_config set weights=jsonb_build_object('privateSeller',40,'uncertainSeller',20)||weights,updated_at=now();
alter view public.radar_property_live_archive rename to radar_property_live_archive_before_private;
do $$declare cols text;begin
 select string_agg(case a.attname
 when 'opportunity_score' then 'case when b.sale_status=''SOLD_CONFIRMED'' or b.exit_classification in (''SOLD_CONFIRMED'',''SOLD_PROBABLE'') then 0::numeric when pp.id is not null and coalesce(b.agency_role,'''')<>''OUR_AGENCY'' then greatest(coalesce(b.opportunity_score,0),case when pp.metadata->>''sellerType''=''unknown'' then coalesce((cfg.weights->>''uncertainSeller'')::numeric,20) else coalesce((cfg.weights->>''privateSeller'')::numeric,40) end) else b.opportunity_score end as opportunity_score'
 when 'reasons' then 'coalesce(b.reasons,''[]''::jsonb)||case when pp.id is null then ''[]''::jsonb when pp.metadata->>''sellerType''=''unknown'' then ''["private_seller_unverified"]''::jsonb else ''["private_seller_declared"]''::jsonb end as reasons'
 when 'agency_name' then 'case when b.agency_id is null and pp.id is not null then case when pp.metadata->>''sellerType''=''unknown'' then ''Venditore da verificare'' else ''Privato'' end || '' · '' || pp.source else b.agency_name end as agency_name'
 else format('b.%I',a.attname) end,',' order by a.attnum) into cols
 from pg_attribute a where a.attrelid='public.radar_property_live_archive_before_private'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create view public.radar_property_live_archive with(security_invoker=true) as select '||cols||',
  case when pp.id is null then null else coalesce(pp.metadata->>''sellerType'',''private'') end as private_seller_type,
  pp.source as private_source,pp.metadata->''imageUrls''->>0 as private_image_url
 from public.radar_property_live_archive_before_private b
 cross join public.market_observer_config cfg
 left join lateral(select * from public.private_publications p where p.property_id=b.property_id and p.state=''ACTIVE'' and coalesce(p.metadata->>''sellerType'',''private'') in (''private'',''unknown'')
 order by p.last_seen_at desc,p.id limit 1) pp on true';
end $$;
revoke all on public.radar_property_live_archive from public,anon;
grant select on public.radar_property_live_archive to authenticated,service_role;

-- The private view shares the same live corrections and opportunity exclusions.
create view public.radar_private_live_archive with(security_invoker=true) as
 select b.* from public.radar_property_live_archive b
 where exists(select 1 from public.private_publications pp where pp.property_id=b.property_id and pp.state='ACTIVE' and coalesce(pp.metadata->>'sellerType','private') in ('private','unknown'))
 and b.sale_status<>'SOLD_CONFIRMED'
 and b.exit_classification not in ('SOLD_CONFIRMED','SOLD_PROBABLE')
 and coalesce(b.agency_role,'')<>'OUR_AGENCY';
revoke all on public.radar_private_live_archive from public,anon;
grant select on public.radar_private_live_archive to authenticated,service_role;
notify pgrst,'reload schema';
commit;
