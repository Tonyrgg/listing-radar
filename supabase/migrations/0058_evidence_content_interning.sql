begin;
set local lock_timeout='5s';
alter table public.evidence rename to evidence_rows;
alter table public.evidence_rows add column content_ref bigint references public.snapshot_components(id);
create view public.evidence with(security_invoker=true) as
 select e.id,e.property_id,e.publication_id,e.snapshot_id,e.sync_run_id,e.evidence_kind,
 case when content_ref is null then e.source_url else c.value->>'source_url' end source_url,
 e.extraction_method,e.claim_key,
 case when content_ref is null then e.raw_value else c.value->>'raw_value' end raw_value,
 case when content_ref is null then e.normalized_value when (c.value->>'normalized_sql_null')::boolean then null else c.value->'normalized_value' end normalized_value,
 e.confidence,e.observed_at,e.source_recorded_at,e.evidence_hash,
 case when content_ref is null then e.metadata else c.value->'metadata' end metadata,e.created_at
 from public.evidence_rows e left join public.snapshot_components c on c.id=e.content_ref;
grant select on public.evidence to authenticated,service_role;
grant insert on public.evidence to service_role;
do $$ declare r record; begin
 for r in select a.attname,pg_get_expr(d.adbin,d.adrelid) expr from pg_attribute a
 join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.evidence_rows'::regclass loop
 execute format('alter view public.evidence alter column %I set default %s',r.attname,r.expr);end loop;
end $$;
create function public.evidence_content(v public.evidence_rows) returns jsonb
language sql immutable as $$select jsonb_build_object('source_url',v.source_url,'raw_value',v.raw_value,
 'normalized_value',v.normalized_value,'normalized_sql_null',v.normalized_value is null,'metadata',v.metadata)$$;
create function public.pack_evidence_content() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.content_ref is not null then raise exception 'Direct evidence references forbidden';end if;
 new.content_ref:=snapshot_component_intern(evidence_content(new));
 new.source_url:='';new.raw_value:=null;new.normalized_value:=null;new.metadata:='{}';return new;
end $$;
create trigger pack_evidence_content before insert on public.evidence_rows for each row execute function public.pack_evidence_content();
create function public.protect_evidence_content_migration() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and old.content_ref is null and new.content_ref is not null
 and (to_jsonb(old)-array['source_url','raw_value','normalized_value','metadata','content_ref'])
 =(to_jsonb(new)-array['source_url','raw_value','normalized_value','metadata','content_ref'])
 and new.source_url='' and new.raw_value is null and new.normalized_value is null and new.metadata='{}'
 and exists(select 1 from snapshot_components where id=new.content_ref and value=evidence_content(old)) then return new;end if;
 raise exception 'Evidence is append-only';
end $$;
drop trigger prevent_evidence_mutation on public.evidence_rows;
create trigger prevent_evidence_mutation before update or delete on public.evidence_rows
 for each row execute function public.protect_evidence_content_migration();
-- Preserve every pre-existing read path and write uniqueness constraint.
do $$ declare r record; definition text; begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.prosrc ~* 'insert into (public\.)?evidence\M' loop
  definition:=pg_get_functiondef(r.oid);
  definition:=regexp_replace(definition,'insert into (public\.)?evidence\M','insert into public.evidence_rows','gi');execute definition;
 end loop;
 for r in select distinct c.oid,c.relname from pg_depend d join pg_rewrite rw on rw.oid=d.objid
 join pg_class c on c.oid=rw.ev_class join pg_namespace n on n.oid=c.relnamespace
 where d.refobjid='public.evidence_rows'::regclass and c.relkind='v' and n.nspname='public' and c.relname<>'evidence' loop
  definition:=pg_get_viewdef(r.oid,true);
  definition:=regexp_replace(definition,'\mevidence_rows\M','evidence','g');
  execute format('create or replace view public.%I with(security_invoker=true) as %s',r.relname,definition);
 end loop;
end $$;
create function public.insert_logical_evidence() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into evidence_rows select (jsonb_populate_record(null::public.evidence_rows,to_jsonb(new))).*;
 return new;
end $$;
create trigger insert_logical_evidence instead of insert on public.evidence for each row execute function public.insert_logical_evidence();
create function public.compact_evidence_contents(p_limit integer default 500) returns integer
language plpgsql security definer set search_path=public as $$
declare r public.evidence_rows;n integer:=0;
begin
 if p_limit<1 or p_limit>1000 then raise exception 'Invalid batch';end if;
 for r in select * from evidence_rows where content_ref is null order by id limit p_limit for update skip locked loop
  update evidence_rows set content_ref=snapshot_component_intern(evidence_content(r)),source_url='',raw_value=null,normalized_value=null,metadata='{}' where id=r.id;
  n:=n+1;end loop;return n;
end $$;
revoke all on function public.evidence_content(public.evidence_rows),public.pack_evidence_content(),public.protect_evidence_content_migration(),public.insert_logical_evidence(),public.compact_evidence_contents(integer) from public,anon,authenticated;
grant execute on function public.compact_evidence_contents(integer) to service_role;
notify pgrst,'reload schema';
commit;
