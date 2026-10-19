begin;

alter table public.building_practice_records
  add column subject text,
  add column publication_start date,
  add column publication_end date,
  add column office text,
  add column document_urls jsonb not null default '[]',
  add column territorial_references jsonb not null default '[]',
  add column classification_confidence numeric check(classification_confidence between 0 and 1),
  add column classification_version text,
  add column signal_type text,
  add column source_status text;
alter table public.building_practice_buildings
  add column match_confidence numeric not null default 0.95 check(match_confidence between 0 and 1),
  add column match_reasons jsonb not null default '["exact_existing_civic","property_unit_not_asserted"]',
  add column matcher_version text not null default 'existing_civic_v1',
  add column human_confirmed boolean not null default false,
  add column is_current boolean not null default true;
alter table public.building_data_import_runs
  add column health_state text,
  add column pages integer not null default 0,
  add column inventory_complete boolean not null default false,
  add column structure_fingerprint text,
  add column diagnostics jsonb not null default '{}';
create index public_records_date_idx on public.building_practice_records(document_date desc,publication_start desc);
create index public_records_territory_idx on public.building_practice_records using gin(territorial_references);

-- Only exact spelling normalization, never fuzzy/initial/name matching in SQL.
create function public.public_record_street_key(value text) returns text
language sql immutable parallel safe set search_path=public as $$
 select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  lower(translate(coalesce(value,''),'àèéìòùÀÈÉÌÒÙ','aeeiouAEEIOU')),
  '^\s*p\.?\s*zza\s+','piazza '),'^\s*v\.?\s*le\s+','viale '),'^\s*c\.?\s*so\s+','corso '),'[^a-z0-9]+',' ','g'))
$$;

create or replace view public.market_observer_public_records with(security_invoker=true) as
select r.id,r.source_key,r.source_record_key,
 coalesce(r.title,r.practice_type||coalesce(' · '||r.practice_number,''),'Pratica pubblica') title,
 coalesce(r.record_type,case when r.practice_type ~* 'SCIA' then 'SCIA' when r.practice_type ~* 'CILA' then 'CILA'
  when r.practice_type ~* 'sanatoria' then 'SANATORIA' when r.practice_type ~* 'condono' then 'CONDONO'
  when r.practice_type ~* 'agibilit' then 'AGIBILITA' when r.practice_type ~* 'permesso.*costruire' then 'PERMESSO_COSTRUIRE' else 'OTHER' end) record_type,
 r.practice_number,r.protocol_number,r.practice_year,r.practice_type,r.practice_status,r.intervention_type,
 r.occurred_at practice_date,r.published_at,r.document_date,r.source_url,r.document_url,
 r.first_seen_at,r.last_seen_at,r.content_hash,r.area_name,r.metadata,
 coalesce(r.sanitized_payload->'addresses','[]'::jsonb) addresses,
 coalesce(r.sanitized_payload->'cadastralReferences','[]'::jsonb) cadastral_references,
 coalesce((select string_agg(a->>'displayName','; ') from jsonb_array_elements(coalesce(r.sanitized_payload->'addresses','[]'::jsonb)) a),'') address_text,
 coalesce((select jsonb_agg(l.building_id) from public.building_practice_buildings l where l.practice_record_id=r.id and l.is_current),'[]'::jsonb) building_ids,
 r.subject,r.publication_start,r.publication_end,r.office,r.document_urls,r.territorial_references,
 r.classification_confidence,r.classification_version,r.signal_type,r.source_status,
 coalesce(r.document_date,r.occurred_at::date,r.publication_start,r.published_at::date) record_date,
 coalesce(nullif(r.practice_year,''),extract(year from coalesce(r.document_date,r.publication_start,r.published_at::date))::text) record_year,
 coalesce((select array_agg(lower(replace(a->>'streetNumber',' ',''))) from jsonb_array_elements(coalesce(r.sanitized_payload->'addresses','[]')) a),'{}'::text[]) civic_numbers
from public.building_practice_records r;

create view public.market_observer_building_properties with(security_invoker=true) as
select distinct b.id building_id,p.id property_id,'BUILDING'::text relation_scope,'REVIEW_REQUIRED'::text unit_match
from public.buildings b join public.locations bl on bl.id=b.location_id
join public.properties p on p.building_id=b.id or exists(select 1 from public.locations pl where pl.id=p.primary_location_id
 and public.public_record_street_key(pl.street_name)=public.public_record_street_key(bl.street_name)
 and regexp_replace(lower(coalesce(pl.street_number,'')),'[^a-z0-9]','','g')=regexp_replace(lower(coalesce(bl.street_number,'')),'[^a-z0-9]','','g')
 and coalesce(pl.street_number,'')<>'' and lower(coalesce(pl.locality,pl.municipality,''))=lower(coalesce(bl.locality,bl.municipality,''))
 and lower(pl.municipality)='bitonto')
where p.identity_status<>'MERGED';
create view public.market_observer_public_record_property_links with(security_invoker=true) as
select distinct l.practice_record_id record_id,bp.property_id,l.building_id,l.match_confidence,l.match_reasons,l.matcher_version,
 'BUILDING'::text relation_scope,'REVIEW_REQUIRED'::text unit_match
from public.building_practice_buildings l join public.market_observer_building_properties bp on bp.building_id=l.building_id where l.is_current;

create view public.market_observer_public_record_streets with(security_invoker=true) as
select distinct r.id record_id,s.id street_id,s.canonical_name,s.locality,s.geometry,'STREET'::text relation_scope
from public.building_practice_records r cross join lateral jsonb_array_elements(r.territorial_references) ref
join public.street_registry_streets s on s.id::text=ref->>'streetId'
union
select distinct r.id,s.id,s.canonical_name,s.locality,s.geometry,'STREET'::text
from public.building_practice_records r cross join lateral jsonb_array_elements(coalesce(r.sanitized_payload->'addresses','[]')) a
join public.street_registry_streets s on public.public_record_street_key(s.canonical_name)=public.public_record_street_key(a->>'streetName')
 and lower(coalesce(s.locality,'Bitonto'))=lower(coalesce(a->>'locality','Bitonto'));

create view public.market_observer_territorial_signals with(security_invoker=true) as
select r.*,
 coalesce(r.signal_type,case when r.record_type='URBAN_PLAN' then 'NEW_URBAN_DOCUMENT' else 'NEW_BUILDING_PRACTICE' end) territorial_signal_type,
 r.first_seen_at detected_at,
 (r.record_date between current_date-90 and current_date and coalesce(r.source_status,'')!~* 'annull|revocat') recent_record,
 (r.first_seen_at>=now()-interval '30 days' and r.record_date between current_date-90 and current_date and coalesce(r.source_status,'')!~* 'annull|revocat') new_territorial_signal,
 (select count(distinct p.property_id)::integer from public.market_observer_public_record_property_links p where p.record_id=r.id) known_property_count
from public.market_observer_public_records r;

create view public.market_observer_property_public_record_summary with(security_invoker=true) as
select l.property_id,count(distinct l.record_id)::integer public_record_count,
 count(distinct l.record_id) filter(where r.recent_record)::integer recent_public_record_count,
 count(distinct l.record_id) filter(where r.new_territorial_signal)::integer new_territorial_signal_count,
 max(r.record_date) latest_public_record_date,
 (array_agg(r.title order by r.record_date desc nulls last,r.id))[1] latest_public_record_title,
 (array_agg(r.record_type order by r.record_date desc nulls last,r.id))[1] latest_public_record_type
from public.market_observer_public_record_property_links l join public.market_observer_territorial_signals r on r.id=l.record_id group by l.property_id;
create view public.market_observer_territorial_property_archive with(security_invoker=true) as
select a.*,coalesce(s.public_record_count,0) public_record_count,coalesce(s.recent_public_record_count,0) recent_public_record_count,
 coalesce(s.new_territorial_signal_count,0) new_territorial_signal_count,s.latest_public_record_date,s.latest_public_record_title,s.latest_public_record_type
from public.market_observer_property_archive a left join public.market_observer_property_public_record_summary s using(property_id);

create view public.market_observer_street_intelligence with(security_invoker=true) as
select s.id street_id,s.canonical_name,s.locality,
 (select count(*)::integer from public.market_observer_property_archive p where public.public_record_street_key(p.street_name)=public.public_record_street_key(s.canonical_name)
  and lower(coalesce(p.locality,'Bitonto'))=lower(coalesce(s.locality,'Bitonto'))) known_properties,
 (select count(*)::integer from public.market_observer_property_archive p where public.public_record_street_key(p.street_name)=public.public_record_street_key(s.canonical_name)
  and lower(coalesce(p.locality,'Bitonto'))=lower(coalesce(s.locality,'Bitonto')) and p.state='ACTIVE') active_properties,
 (select count(*)::integer from public.market_observer_property_archive p where public.public_record_street_key(p.street_name)=public.public_record_street_key(s.canonical_name)
  and lower(coalesce(p.locality,'Bitonto'))=lower(coalesce(s.locality,'Bitonto')) and p.exit_classification in('SOLD_CONFIRMED','SOLD_PROBABLE')) sold_observed,
 count(distinct rs.record_id)::integer public_record_count,max(r.record_date) latest_record_date,
 count(distinct rs.record_id) filter(where r.recent_record)::integer recent_record_count,
 (array_agg(r.title order by r.record_date desc nulls last,r.id) filter(where r.id is not null))[1] latest_record_title
from public.street_registry_streets s left join public.market_observer_public_record_streets rs on rs.street_id=s.id
left join public.market_observer_territorial_signals r on r.id=rs.record_id group by s.id;

create view public.market_observer_building_intelligence with(security_invoker=true) as
select b.id building_id,b.display_name,b.location_id,
 (select count(*)::integer from public.market_observer_building_properties p where p.building_id=b.id) known_properties,
 (select count(*)::integer from public.market_observer_building_properties p join public.market_observer_property_archive a using(property_id) where p.building_id=b.id and a.state='ACTIVE') active_properties,
 (select count(*)::integer from public.market_observer_building_properties p join public.agency_listings a using(property_id) join public.publications u on u.agency_listing_id=a.id where p.building_id=b.id) publications,
 (select count(distinct a.agency_id)::integer from public.market_observer_building_properties p join public.agency_listings a using(property_id) where p.building_id=b.id) observed_agencies,
 count(distinct l.practice_record_id)::integer public_record_count,max(r.record_date) latest_record_date,
 count(distinct l.practice_record_id) filter(where r.recent_record)::integer recent_record_count
from public.buildings b left join public.building_practice_buildings l on l.building_id=b.id and l.is_current
left join public.market_observer_territorial_signals r on r.id=l.practice_record_id group by b.id;

-- Record + significant observation + exact existing building links commit together.
create function public.persist_public_records_atomic(p_run_id uuid,p_source_key text,p_observed_at timestamptz,p_records jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; old public.building_practice_records%rowtype; rid uuid; changed boolean; a jsonb; b record;
 ins integer:=0; upd integer:=0; links integer:=0;
begin
 if not exists(select 1 from public.building_data_import_runs where id=p_run_id and source_key=p_source_key and status='RUNNING') then raise exception 'Running public-record source run required'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>100 then raise exception 'Bounded record array required'; end if;
 if (select count(*)<>count(distinct value->>'sourceRecordKey') from jsonb_array_elements(p_records)) then raise exception 'Duplicate record identity'; end if;
 for v in select value from jsonb_array_elements(p_records) loop
  if nullif(v->>'sourceRecordKey','') is null or nullif(v->>'contentHash','') is null then raise exception 'Public record identity/hash required'; end if;
  select * into old from public.building_practice_records where source_key=p_source_key and source_record_key=v->>'sourceRecordKey' for update;
  if old.id is not null and old.last_seen_at>p_observed_at then continue; end if;
  changed:=old.id is null or old.content_hash<>v->>'contentHash';
  insert into public.building_practice_records(source_key,source_record_key,application_code,intervention_type,practice_number,practice_year,
    title,subject,record_type,source_url,document_url,document_urls,document_date,published_at,publication_start,publication_end,office,source_status,
    area_name,classification_confidence,classification_version,signal_type,territorial_references,sanitized_payload,content_hash,metadata,first_seen_at,last_seen_at)
  values(p_source_key,v->>'sourceRecordKey','public-territorial','OTHER',v->>'practiceNumber',v->>'year',v->>'title',v->>'subject',v->>'recordType',v->>'sourceUrl',v->>'documentUrl',coalesce(v->'documentUrls','[]'),
    (v->>'documentDate')::date,(v->>'publicationStart')::date,(v->>'publicationStart')::date,(v->>'publicationEnd')::date,v->>'office',v->>'sourceStatus',v->>'areaName',
    (v->>'classificationConfidence')::numeric,v->>'classificationVersion',v->>'signalType',coalesce(v->'territorialReferences','[]'),v->'sanitizedPayload',v->>'contentHash',coalesce(v->'metadata','{}'),p_observed_at,p_observed_at)
  on conflict(source_key,source_record_key) do update set title=excluded.title,subject=excluded.subject,record_type=excluded.record_type,practice_number=excluded.practice_number,
    practice_year=excluded.practice_year,source_url=excluded.source_url,document_url=excluded.document_url,document_urls=excluded.document_urls,document_date=excluded.document_date,published_at=excluded.published_at,
    publication_start=excluded.publication_start,publication_end=excluded.publication_end,office=excluded.office,source_status=excluded.source_status,area_name=excluded.area_name,
    classification_confidence=excluded.classification_confidence,classification_version=excluded.classification_version,signal_type=excluded.signal_type,territorial_references=excluded.territorial_references,
    sanitized_payload=excluded.sanitized_payload,content_hash=excluded.content_hash,metadata=excluded.metadata,last_seen_at=excluded.last_seen_at returning id into rid;
  if changed then
   insert into public.building_practice_observations(practice_record_id,import_run_id,content_hash,sanitized_payload,observed_at)
    values(rid,p_run_id,v->>'contentHash',v->'sanitizedPayload',p_observed_at) on conflict(practice_record_id,content_hash) do nothing;
   if old.id is null then ins:=ins+1; else upd:=upd+1; end if;
   update public.building_practice_buildings set is_current=false where practice_record_id=rid and not human_confirmed;
  end if;
  for a in select value from jsonb_array_elements(coalesce(v->'sanitizedPayload'->'addresses','[]')) loop
   for b in select id from public.buildings where normalized_key=a->>'normalizedKey' loop
    insert into public.building_practice_buildings(practice_record_id,building_id,last_seen_at,match_confidence,match_reasons,matcher_version)
     values(rid,b.id,p_observed_at,0.95,'["official_street_unique","explicit_civic","existing_building","property_unit_not_asserted"]','official_street_civic_v1')
     on conflict(practice_record_id,building_id) do update set last_seen_at=excluded.last_seen_at,is_current=true where not building_practice_buildings.human_confirmed;
    links:=links+1;
   end loop;
  end loop;
 end loop;
 return jsonb_build_object('inserted',ins,'updated',upd,'links',links);
end $$;
revoke all on function public.persist_public_records_atomic(uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.persist_public_records_atomic(uuid,text,timestamptz,jsonb) to service_role;
grant select on public.market_observer_building_properties,public.market_observer_public_record_property_links,
 public.market_observer_public_record_streets,public.market_observer_territorial_signals,
 public.market_observer_property_public_record_summary,public.market_observer_territorial_property_archive,
 public.market_observer_street_intelligence,public.market_observer_building_intelligence to authenticated,service_role;
comment on view public.market_observer_territorial_signals is 'Consultative territorial evidence only. No commercial score, lead, owner profiling or property-unit/legal certification.';
notify pgrst,'reload schema';
commit;
