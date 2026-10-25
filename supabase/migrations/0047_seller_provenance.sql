-- Local-only provenance and explicit V2 links. No contact or identity merge.
begin;
create function public.valid_seller_reference(p jsonb) returns boolean language plpgsql immutable as $$
declare m text;t text;
begin
 if p is null or jsonb_typeof(p)<>'object' or length(p::text)>4000
  or (p-array['module','sourceType','sourceId','sourceUrl','observedAt','publishedAt','evidenceSignature']::text[])<>'{}'::jsonb
  or not(p ?& array['module','sourceType','sourceId','sourceUrl','observedAt','publishedAt','evidenceSignature']) then return false; end if;
 m=p->>'module';t=p->>'sourceType';
 if ((m='WORKER' and t='worker_import') or (m='RADAR' and t='public_news') or
 (m='TONYBOOK' and t='local_registry') or (m='VAB' and t in ('meta_form','local_test'))) is not true then return false;end if;
 if coalesce(p->>'sourceId','')!~'^[A-Za-z0-9:._/-]{1,200}$'
  or coalesce(p->>'evidenceSignature','')!~'^[a-f0-9]{64}$'
  or (p->>'sourceUrl' is not null and (p->>'sourceUrl'!~'^https://[^/@ ]+(/|$)' or length(p->>'sourceUrl')>2000))
  or coalesce(p->>'observedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}(T.*(Z|[+-][0-9]{2}:[0-9]{2}))?$'
  or (p->>'publishedAt' is not null and p->>'publishedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}(T.*(Z|[+-][0-9]{2}:[0-9]{2}))?$') then return false;end if;
 perform (p->>'observedAt')::timestamptz;
 if p->>'publishedAt' is not null then perform (p->>'publishedAt')::timestamptz;end if;
 return true;
exception when others then return false;
end $$;
create table public.seller_case_sources (
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.seller_cases(id) on delete restrict,
 actor_id uuid not null references auth.users(id),reference jsonb not null check(public.valid_seller_reference(reference)),
 created_at timestamptz not null default now()
);
create unique index seller_source_identity on public.seller_case_sources(case_id,(reference->>'module'),(reference->>'sourceType'),(reference->>'sourceId'));
create table public.seller_case_property_links (
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.seller_cases(id) on delete restrict,
 property_id uuid not null references public.properties(id) on delete restrict,
 actor_id uuid not null references auth.users(id),note text not null check(length(trim(note)) between 1 and 2000),
 created_at timestamptz not null default now(),unique(case_id,property_id)
);
alter table public.seller_case_sources enable row level security;
alter table public.seller_case_property_links enable row level security;
create policy seller_sources_owner on public.seller_case_sources for select to authenticated using
 (exists(select 1 from seller_cases c where c.id=case_id and c.owner_id=auth.uid()));
create policy seller_links_owner on public.seller_case_property_links for select to authenticated using
 (exists(select 1 from seller_cases c where c.id=case_id and c.owner_id=auth.uid()));
revoke all on public.seller_case_sources,public.seller_case_property_links from anon,authenticated;
grant select on public.seller_case_sources,public.seller_case_property_links to authenticated;
grant all on public.seller_case_sources,public.seller_case_property_links to service_role;
create function public.attach_seller_case_source(p_case uuid,p_reference jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r seller_case_sources;
begin
 perform 1 from seller_cases where id=p_case and owner_id=auth.uid() for update;
 if not found then raise exception 'Case not available' using errcode='42501';end if;
 if not valid_seller_reference(p_reference) then raise exception 'Invalid provenance' using errcode='22023';end if;
 select * into r from seller_case_sources where case_id=p_case and reference->>'module'=p_reference->>'module'
  and reference->>'sourceType'=p_reference->>'sourceType' and reference->>'sourceId'=p_reference->>'sourceId';
 if found then
  if r.reference<>p_reference then raise exception 'Evidence changed; preserve original provenance' using errcode='40001';end if;
  return r.id;
 end if;
 insert into seller_case_sources(case_id,actor_id,reference) values(p_case,auth.uid(),p_reference) returning * into r;
 return r.id;
end $$;
create function public.link_seller_case_property(p_case uuid,p_property uuid,p_note text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r seller_case_property_links;
begin
 perform 1 from seller_cases where id=p_case and owner_id=auth.uid() for update;
 if not found then raise exception 'Case not available' using errcode='42501';end if;
 if p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Link explanation required';end if;
 select * into r from seller_case_property_links where case_id=p_case and property_id=p_property;
 if found then
  if r.note<>trim(p_note) then raise exception 'Link explanation changed' using errcode='40001';end if;
  return r.id;
 end if;
 insert into seller_case_property_links(case_id,property_id,actor_id,note) values(p_case,p_property,auth.uid(),trim(p_note)) returning * into r;
 return r.id;
end $$;
revoke all on function public.attach_seller_case_source(uuid,jsonb),public.link_seller_case_property(uuid,uuid,text) from public,anon;
grant execute on function public.attach_seller_case_source(uuid,jsonb),public.link_seller_case_property(uuid,uuid,text) to authenticated;
commit;
