begin;
-- A municipality is not a street address. For automatically created direct
-- properties, let the archive fall back to the publication's actual title.
update public.properties p set canonical_attributes=p.canonical_attributes-'address'
where exists(select 1 from public.private_radar_inbox inbox where inbox.id=p.id)
and lower(trim(p.canonical_attributes->>'address')) in ('bitonto','bitonto, bitonto','palombaio','palombaio, palombaio','mariotto','mariotto, mariotto')
and not exists(select 1 from public.locations l where l.id=p.primary_location_id and l.manually_verified)
and not exists(select 1 from public.manual_overrides mo where mo.target_type='PROPERTY' and mo.target_id=p.id);
-- Rejected intakes remain auditable but are not interpreted as market exits.
alter view public.radar_property_live_archive rename to radar_property_live_archive_before_intake_exclusions;
create view public.radar_property_live_archive with(security_invoker=true) as
select b.* from public.radar_property_live_archive_before_intake_exclusions b
where exists(select 1 from public.agency_listings al where al.property_id=b.property_id)
 or not exists(select 1 from public.private_publications pp where pp.property_id=b.property_id and pp.metadata->>'saleRadarExclusion' in ('rental','agency'))
 or exists(select 1 from public.private_publications pp where pp.property_id=b.property_id and pp.state='ACTIVE' and coalesce(pp.metadata->>'saleRadarExclusion','') not in ('rental','agency') and coalesce(pp.metadata->>'sellerType','private') in ('private','unknown'));
revoke all on public.radar_property_live_archive from public,anon;
grant select on public.radar_property_live_archive to authenticated,service_role;
create or replace view public.radar_private_live_archive with(security_invoker=true) as
select b.* from public.radar_property_live_archive b
where exists(select 1 from public.private_publications pp where pp.property_id=b.property_id and pp.state='ACTIVE' and coalesce(pp.metadata->>'saleRadarExclusion','') not in ('rental','agency') and coalesce(pp.metadata->>'sellerType','private') in ('private','unknown'))
and b.sale_status<>'SOLD_CONFIRMED' and b.exit_classification not in ('SOLD_CONFIRMED','SOLD_PROBABLE') and coalesce(b.agency_role,'')<>'OUR_AGENCY';
notify pgrst,'reload schema';
commit;
