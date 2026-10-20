begin;
-- A partial historical batch must not temporarily bypass the conservative resolver.
-- Keep old live/CSV fallback compatibility, while historical evidence waits for its
-- hash-bound graph projection. Source documents remain readable throughout.
create or replace view public.market_observer_graph_record_streets with(security_invoker=true) as
select distinct t.record_id,s.id street_id,s.canonical_name,s.locality,s.geometry,'STREET'::text relation_scope
from public_record_territorial_resolutions t join building_practice_records r on r.id=t.record_id and r.content_hash=t.input_hash
cross join lateral jsonb_array_elements(t.references_json) ref join street_registry_streets s on s.id::text=ref->>'streetId'
union
select rs.* from market_observer_public_record_streets rs
where not exists(select 1 from public_record_territorial_resolutions t join building_practice_records r on r.id=t.record_id and r.content_hash=t.input_hash where t.record_id=rs.record_id)
 and not exists(select 1 from building_practice_observations o join building_data_import_runs ir on ir.id=o.import_run_id
  join building_practice_records r on r.id=o.practice_record_id and r.content_hash=o.content_hash
  where o.practice_record_id=rs.record_id and ir.run_kind='HISTORY');
notify pgrst,'reload schema';
commit;
