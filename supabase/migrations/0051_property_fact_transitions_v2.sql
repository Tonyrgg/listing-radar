begin;
-- Retain valid V1 evidence; accept V2 only with the same primary-source guards.
-- Explicit buildability statements remain claims to verify, never legal certification.
create or replace function public.project_public_record_facts(p_records jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare v jsonb; e jsonb; n integer:=0; rid uuid; h text;
begin
 if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>100 then raise exception 'Bounded semantic batch required';end if;
 for v in select value from jsonb_array_elements(p_records) loop
  rid:=(v->>'recordId')::uuid;
  select content_hash into h from building_practice_records where id=rid for share;
  if h is null or h is distinct from v->>'inputHash' then raise exception 'Stale semantic input';end if;
  if coalesce(v->'projection'->>'version','') not in ('property_facts_v1','property_facts_v2')
   or jsonb_typeof(v->'projection'->'events') is distinct from 'array'
   or jsonb_array_length(v->'projection'->'events')>40 or octet_length((v->'projection')::text)>100000 then raise exception 'Invalid semantic projection';end if;
  for e in select value from jsonb_array_elements(v->'projection'->'events') loop
   if length(coalesce(e->>'evidence_text','')) not between 2 and 180
    or coalesce(e->>'classification_version','') not in ('property_facts_v1','property_facts_v2')
    or (v->'projection'->>'version'='property_facts_v1' and e->>'classification_version'<>'property_facts_v1')
    or coalesce(e->>'id','') !~ '^[a-f0-9]{64}$'
    or coalesce(e->>'event_type','')=''
    or e->>'observed_at' is null
    or e->>'confidence' is null or (e->>'confidence')::numeric not between 0 and 1
    or e->>'real_estate_relevance' is null or (e->>'real_estate_relevance')::numeric not between 0 and 100
    or coalesce(e->'evidence_location'->>'source_url','') !~ '^https://'
    or coalesce(e->'evidence_location'->>'source_hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(e->'evidence_location'->>'field','') not in('practice_type','Oggetto','Oggetto Fascicolo','Tipo Pratica','albo.subject','pdf.text')
    or (e->'evidence_location'->>'field'='pdf.text' and coalesce((e->'evidence_location'->>'page')::integer,0)<1)
    or (e->>'event_type'='BUILDABILITY_CHANGED' and (
      v->'projection'->>'version'<>'property_facts_v2' or e->>'classification_version'<>'property_facts_v2'
      or coalesce(e->>'from_use','') not in ('NON_BUILDABLE','BUILDABLE')
      or coalesce(e->>'to_use','') not in ('NON_BUILDABLE','BUILDABLE')
      or e->>'from_use'=e->>'to_use'
      or coalesce(e->'evidence_location'->>'field','') not in ('Oggetto','Oggetto Fascicolo','albo.subject','pdf.text')
      or not (
        (e->>'from_use'='NON_BUILDABLE' and e->>'to_use'='BUILDABLE' and e->>'evidence_text' ~* '(terren[oi]|are[ae]|lott[oi])[[:space:]]+da[[:space:]]+(non[[:space:]]+edificabil[ei]|inedificabil[ei])[[:space:]]+(a|ad|in)[[:space:]]+edificabil[ei]')
        or (e->>'from_use'='BUILDABLE' and e->>'to_use'='NON_BUILDABLE' and e->>'evidence_text' ~* '(terren[oi]|are[ae]|lott[oi])[[:space:]]+da[[:space:]]+edificabil[ei][[:space:]]+(a|ad|in)[[:space:]]+(non[[:space:]]+edificabil[ei]|inedificabil[ei])')
      )
    )) then raise exception 'Evidence-bound event required';end if;
   perform (e->>'observed_at')::timestamptz;
   if e->>'event_date' is not null then perform (e->>'event_date')::date;end if;
  end loop;
  update public_record_territorial_resolutions set semantic_projection=v->'projection',semantic_input_hash=h,semantic_evaluated_at=now()
   where record_id=rid and input_hash=h and (semantic_input_hash is distinct from h or semantic_projection is distinct from v->'projection');
  if not exists(select 1 from public_record_territorial_resolutions where record_id=rid and input_hash=h) then raise exception 'Territorial projection required first';end if;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.project_public_record_facts(jsonb) from public,anon,authenticated;
grant execute on function public.project_public_record_facts(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
