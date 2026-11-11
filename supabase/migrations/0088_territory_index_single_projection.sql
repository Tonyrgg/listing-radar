begin;
-- Evaluate the full JSON snapshot once, including the tombstone check. The
-- previous correlated anti-join could expand it again for every indexed record.
create or replace function public.territory_index_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 with incoming as materialized (
  select r.collection,r.record_key,r.value from public.territory_state_records(new.state) r
 ), upserted as (
  insert into public.territory_workspace_records(workspace_id,collection,record_key,revision,value,deleted)
  select new.id,r.collection,r.record_key,new.revision,r.value,false from incoming r
  on conflict(workspace_id,collection,record_key) do update
   set revision=excluded.revision,value=excluded.value,deleted=false
   where territory_workspace_records.value is distinct from excluded.value or territory_workspace_records.deleted
  returning 1
 )
 update public.territory_workspace_records indexed
 set revision=new.revision,value=null,deleted=true
 where indexed.workspace_id=new.id and not indexed.deleted
 and (indexed.collection,indexed.record_key) not in (select collection,record_key from incoming);
 return new;
end $$;
commit;
