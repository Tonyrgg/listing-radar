begin;
-- Include every base-table dependency of the source projection: edits to agency
-- names, streets, private publications and imported building records also dirty
-- the snapshot. Only a cheap statement-level marker runs on the write path.
do $$declare t text;begin
 foreach t in array array['agencies','building_data_import_runs','building_practice_observations','buildings','events','market_observer_sources','private_publications','snapshot_components','snapshot_payload_versions','street_registry_streets'] loop
 if to_regclass('public.'||t) is not null then execute format('create trigger radar_read_model_dirty after insert or update or delete on public.%I for each statement execute function public.mark_radar_read_model_dirty()',t);end if;
 end loop;end $$;
update public.radar_read_model_state set source_revision=source_revision+1 where singleton;
commit;
