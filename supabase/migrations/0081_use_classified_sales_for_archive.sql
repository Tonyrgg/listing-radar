begin;
-- Reuse the original source projection and compute current sold IDs once per query.
do $$
declare cols text;
begin
 select string_agg(case a.attname
 when 'opportunity_score' then 'case when x.classification in (''SOLD_CONFIRMED'',''SOLD_PROBABLE'') then 0::numeric when b.opportunity_score>0 then least(100::numeric,b.opportunity_score+q.bonus) else b.opportunity_score end as opportunity_score'
 when 'exit_classification' then 'x.classification as exit_classification'
 when 'reasons' then 'b.reasons || q.reasons as reasons'
 else format('b.%I',a.attname) end,',' order by a.attnum) into cols
 from pg_attribute a where a.attrelid='public.market_observer_graph_property_archive_base_v1'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create or replace view public.market_observer_graph_property_archive with(security_invoker=true) as select '||cols||', b.opportunity_score as base_opportunity_score,q.bonus as identifiability_bonus
 from public.market_observer_graph_property_archive_base_v1 b
 cross join lateral(select
   least(25,case when nullif(trim(b.street_name),'''') is not null then 8 else 0 end
    +case when nullif(trim(b.street_number),'''') is not null and nullif(trim(b.street_name),'''') is not null then 12 else 0 end
    +case when b.location_precision in (''EXACT_ADDRESS'',''EXACT_COORDINATES'') and b.latitude is not null and b.longitude is not null then 5 else 0 end
    +case when b.surface_sqm>0 and b.property_type is not null and b.rooms>0 then 3 else 0 end) as bonus,
   to_jsonb(array_remove(array[
    case when nullif(trim(b.street_name),'''') is not null then ''identifiable_street'' end,
    case when nullif(trim(b.street_number),'''') is not null and nullif(trim(b.street_name),'''') is not null then ''identifiable_civic'' end,
    case when b.location_precision in (''EXACT_ADDRESS'',''EXACT_COORDINATES'') and b.latitude is not null and b.longitude is not null then ''identifiable_coordinates'' end,
    case when b.surface_sqm>0 and b.property_type is not null and b.rooms>0 then ''identifiable_details'' end],null)) as reasons) q
 cross join lateral(select case
 when b.sale_status=''NOT_SOLD_CONFIRMED'' then b.exit_classification
 when b.sale_status=''SOLD_CONFIRMED'' then ''SOLD_CONFIRMED''
 when b.exit_classification in (''SOLD_CONFIRMED'',''SOLD_PROBABLE'') then b.exit_classification
 when b.property_id in (select al.property_id from public.agency_listings al where al.market_exit_classification in (''SOLD_CONFIRMED'',''SOLD_PROBABLE'')) then ''SOLD_PROBABLE''
 else b.exit_classification end as classification) x';
end $$;
grant select on public.market_observer_graph_property_archive to authenticated,service_role;
commit;
