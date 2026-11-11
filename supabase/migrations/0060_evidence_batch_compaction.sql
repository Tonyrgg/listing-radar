begin;
create or replace function public.compact_evidence_contents(p_limit integer default 500) returns integer
language plpgsql security definer set search_path=public as $$
declare ids uuid[]; n integer;
begin
 if p_limit<1 or p_limit>1000 then raise exception 'Invalid batch';end if;
 select array_agg(id) into ids from (select id from evidence_rows where content_ref is null order by id limit p_limit for update skip locked) s;
 if ids is null then return 0;end if;
 insert into snapshot_components(hash,value)
 select distinct encode(extensions.digest(evidence_content(e)::text,'sha256'),'hex'),evidence_content(e)
 from evidence_rows e where id=any(ids) on conflict(hash) do nothing;
 update evidence_rows e set content_ref=c.id,source_url='',raw_value=null,normalized_value=null,metadata='{}'
 from snapshot_components c where e.id=any(ids)
 and c.hash=encode(extensions.digest(evidence_content(e)::text,'sha256'),'hex') and c.value=evidence_content(e);
 get diagnostics n=row_count;
 if n<>cardinality(ids) then raise exception 'Incomplete evidence compaction';end if;
 return n;
end $$;
commit;
