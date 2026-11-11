begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
create materialized view public.radar_property_read_model as
 select a.*,case when a.latest_asking_price is not null and a.surface_sqm>0 then a.latest_asking_price/a.surface_sqm end unit_asking_price
 from public.market_observer_graph_property_archive a;
create unique index radar_property_read_model_id on public.radar_property_read_model(property_id);
create index radar_property_read_model_score on public.radar_property_read_model(opportunity_score desc nulls last,row_id);
create index radar_property_read_model_seen on public.radar_property_read_model(last_seen_at desc nulls last,row_id);
create index radar_property_read_model_price on public.radar_property_read_model(unit_asking_price,row_id);
create index radar_property_read_model_exit on public.radar_property_read_model(exit_classification);
revoke all on public.radar_property_read_model from public,anon;
grant select on public.radar_property_read_model to authenticated,service_role;
create table public.radar_read_model_state(singleton boolean primary key default true check(singleton),source_revision bigint not null default 1,refreshed_revision bigint not null default 1,refreshed_at timestamptz not null default clock_timestamp(),last_error text,attempted_at timestamptz);
insert into public.radar_read_model_state(singleton) values(true);
alter table public.radar_read_model_state enable row level security;
create policy radar_read_model_status on public.radar_read_model_state for select to authenticated using(true);
grant select on public.radar_read_model_state to authenticated,service_role;
create function public.mark_radar_read_model_dirty() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.radar_read_model_state set source_revision=source_revision+1 where singleton;return null;end $$;
revoke all on function public.mark_radar_read_model_dirty() from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['properties','locations','agency_listings','publications','snapshot_observations','evidence_rows','opportunities','manual_overrides','building_practice_records','building_practice_buildings','public_record_territorial_resolutions'] loop
 if to_regclass('public.'||t) is not null then execute format('create trigger radar_read_model_dirty after insert or update or delete on public.%I for each statement execute function public.mark_radar_read_model_dirty()',t);end if;
 end loop;end $$;
create function public.refresh_radar_read_model() returns boolean language plpgsql security definer set search_path='' set statement_timeout='120s' set lock_timeout='3s' set jit='off' as $$
declare target bigint;refreshed bigint;at timestamptz;
begin
 if not pg_try_advisory_xact_lock(780031083) then return false;end if;
 select source_revision,refreshed_revision,refreshed_at into target,refreshed,at from public.radar_read_model_state where singleton;
 if target=refreshed and at::date=current_date then return true;end if;
 begin
  refresh materialized view concurrently public.radar_property_read_model;
  update public.radar_read_model_state set refreshed_revision=target,refreshed_at=clock_timestamp(),last_error=null,attempted_at=clock_timestamp() where singleton;
  return true;
 exception when others then
  update public.radar_read_model_state set last_error=sqlstate,attempted_at=clock_timestamp() where singleton;
  return false;
 end;
end $$;
revoke all on function public.refresh_radar_read_model() from public,anon,authenticated;
grant execute on function public.refresh_radar_read_model() to service_role;
notify pgrst,'reload schema';
commit;
