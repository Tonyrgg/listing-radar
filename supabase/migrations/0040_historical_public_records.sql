begin;
-- Operational state on the existing import runs, not a second document archive.
alter table public.building_data_import_runs
 add column run_kind text not null default 'LIVE' check(run_kind in('LIVE','HISTORY')),
 add column history_year integer check(history_year between 2021 and 2026),
 add column checkpoint jsonb not null default '{}',
 add column lease_token uuid, add column lease_until timestamptz;
alter table public.building_data_import_runs add constraint history_run_year_required check((run_kind='HISTORY')=(history_year is not null));
create unique index building_history_year_unique on public.building_data_import_runs(source_key,history_year) where run_kind='HISTORY';
create index building_live_source_runs on public.building_data_import_runs(source_key,started_at desc) where run_kind='LIVE';

create function public.claim_public_record_history(p_year integer,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r building_data_import_runs%rowtype;
begin
 if p_year is null or p_year not between 2021 and 2026 or p_token is null then raise exception 'Invalid historical lease';end if;
 perform pg_advisory_xact_lock(hashtext('public-record-history'));
 if exists(select 1 from building_data_import_runs where run_kind='HISTORY' and lease_until>now() and lease_token<>p_token) then raise exception 'Historical backfill already leased';end if;
 insert into building_data_import_runs(source_key,source_url,run_kind,history_year)
 values('comune-bitonto-albo','https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti','HISTORY',p_year)
 on conflict(source_key,history_year) where run_kind='HISTORY' do nothing;
 select * into r from building_data_import_runs where run_kind='HISTORY' and history_year=p_year and source_key='comune-bitonto-albo' for update;
 update building_data_import_runs set status='RUNNING',health_state='UNKNOWN',lease_token=p_token,lease_until=now()+interval '10 minutes',finished_at=null where id=r.id;
 return jsonb_build_object('id',r.id,'checkpoint',r.checkpoint,'inserted',r.inserted_records,'updated',r.updated_records);
end $$;

create function public.commit_public_record_history(p_run uuid,p_token uuid,p_records jsonb,p_seen uuid[],p_checkpoint jsonb,p_metrics jsonb,p_finish boolean default false,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r building_data_import_runs%rowtype; result jsonb;
begin
 select * into r from building_data_import_runs where id=p_run and run_kind='HISTORY' for update;
 if r.id is null or r.status<>'RUNNING' or r.lease_token is distinct from p_token or coalesce(r.lease_until<=now(),true) then raise exception 'Valid historical lease required';end if;
 if jsonb_typeof(p_checkpoint) is distinct from 'object' or jsonb_typeof(p_records) is distinct from 'array' or octet_length(p_checkpoint::text)>2000000 or coalesce(cardinality(p_seen),0)>100 then raise exception 'Bounded checkpoint required';end if;
 result:=persist_public_records_atomic(p_run,r.source_key,now(),p_records);
 update building_practice_records set last_seen_at=now() where source_key=r.source_key and id=any(p_seen);
 update building_data_import_runs set checkpoint=p_checkpoint,diagnostics=p_metrics,
  input_rows=coalesce((p_metrics->>'scanned')::integer,input_rows),eligible_rows=coalesce((p_metrics->>'candidates')::integer,eligible_rows),
  pages=coalesce((p_metrics->>'pages')::integer,pages),grouped_records=coalesce((p_metrics->>'processed')::integer,grouped_records),
  inserted_records=inserted_records+(result->>'inserted')::integer,updated_records=updated_records+(result->>'updated')::integer,
  building_links=building_links+(result->>'links')::integer,
  inventory_complete=coalesce((p_metrics->>'inventoryComplete')::boolean,false),
  structure_fingerprint=p_metrics->>'fingerprint',
  status=case when p_error is not null then 'FAILED' when p_finish then 'SUCCEEDED' else 'RUNNING' end,
  health_state=case when p_error is not null then 'FAILED' when p_finish then 'HEALTHY' else 'UNKNOWN' end,
  errors=case when p_error is null then errors else jsonb_build_array(left(p_error,500)) end,
  lease_until=case when p_finish or p_error is not null then null else now()+interval '10 minutes' end,
  finished_at=case when p_finish or p_error is not null then now() else null end
 where id=p_run;
 return result;
end $$;
revoke all on function public.claim_public_record_history(integer,uuid),public.commit_public_record_history(uuid,uuid,jsonb,uuid[],jsonb,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_public_record_history(integer,uuid),public.commit_public_record_history(uuid,uuid,jsonb,uuid[],jsonb,jsonb,boolean,text) to service_role;

-- Human decisions belong to the derived resolution, bound to the observed input hash.
alter table public.public_record_territorial_resolutions add column human_overrides jsonb not null default '{}',add column review_history jsonb not null default '[]';
create function public.review_public_record_street(p_record uuid,p_index integer,p_hash text,p_decision text,p_street uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare r public_record_territorial_resolutions%rowtype; ref jsonb; decision jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if p_decision is null or p_index is null or p_decision not in('SAME_STREET','DIFFERENT','UNKNOWN') or p_index<0 then raise exception 'Invalid decision';end if;
 select * into r from public_record_territorial_resolutions where record_id=p_record for update;
 if r.record_id is null or r.input_hash<>p_hash or not exists(select 1 from building_practice_records where id=p_record and content_hash=p_hash) then raise exception 'Stale territorial evidence';end if;
 ref:=r.references_json->p_index;
 if ref is null then raise exception 'Unknown reference';end if;
 if p_decision='SAME_STREET' and (p_street is null or not (ref->'candidateStreetIds' ? p_street::text) or not exists(select 1 from street_registry_streets where id=p_street and record_status='active')) then raise exception 'Known candidate street required';end if;
 decision:=jsonb_build_object('decision',p_decision,'streetId',case when p_decision='SAME_STREET' then p_street else null end,'inputHash',p_hash,'by',auth.uid(),'at',now());
 update public_record_territorial_resolutions set human_overrides=jsonb_set(human_overrides,array[p_index::text],decision),
  review_history=review_history||jsonb_build_array(decision||jsonb_build_object('index',p_index)),
  references_json=jsonb_set(references_json,array[p_index::text],ref||jsonb_build_object('streetId',decision->'streetId','humanDecision',p_decision)),evaluated_at=now() where record_id=p_record;
end $$;
revoke all on function public.review_public_record_street(uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.review_public_record_street(uuid,integer,text,text,uuid) to authenticated;
create view public.market_observer_territorial_review with(security_invoker=true) as
select record_id,input_hash,references_json,human_overrides,evaluated_at from public_record_territorial_resolutions t
where exists(select 1 from jsonb_array_elements(t.references_json) ref where jsonb_array_length(coalesce(ref->'candidateStreetIds','[]'))>1);
grant select on public.market_observer_territorial_review to authenticated,service_role;

-- Density is a count of observed history, deliberately separate from dated activity.
create view public.market_observer_territorial_history with(security_invoker=true) as
select 'BUILDING'::text scope,building_id id,display_name name,locality,public_record_count historical_record_density,
 recent30,recent90,activity,known_properties,active_properties,last_activity from market_observer_graph_building_context
union all
select 'STREET',street_id,canonical_name,locality,public_record_count,recent30,recent90,activity,known_properties,active_properties,last_activity from market_observer_graph_street_context;
grant select on public.market_observer_territorial_history to authenticated,service_role;
notify pgrst,'reload schema';
commit;
