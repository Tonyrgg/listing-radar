begin;
create or replace function public.lifecycle_insert_fingerprint()returns trigger language plpgsql security definer set search_path=public as $$
declare ids bigint[];
begin
 if exists(select 1 from fingerprint_archive_pending_expanded a where a.publication_id is not distinct from new.publication_id
  and((a.row_data->>'canonical_url'=new.canonical_url and a.row_data->>'algorithm'=new.algorithm and a.observations @>jsonb_build_array(jsonb_build_object('snapshot_id',new.snapshot_id)))or a.observations @>jsonb_build_array(jsonb_build_object('id',new.id))))then raise exception 'Duplicate historical fingerprint'using errcode='23505';end if;
 select array_agg(id)into ids from fingerprint_archive_receipts where publication_id is not distinct from new.publication_id;
 -- NULL AND EXISTS is not FALSE: a NULL array previously invoked the unbounded
 -- compatibility reader. Branch before the subquery, including when offline.
 if coalesce(cardinality(ids),0)>0 then
  if exists(select 1 from read_external_fingerprint_groups(ids)a where
   (a.row_data->>'canonical_url'=new.canonical_url and a.row_data->>'algorithm'=new.algorithm and a.observations @>jsonb_build_array(jsonb_build_object('snapshot_id',new.snapshot_id)))or a.observations @>jsonb_build_array(jsonb_build_object('id',new.id)))then raise exception 'Duplicate historical fingerprint'using errcode='23505';end if;
 end if;
 insert into image_fingerprint_current values(new.*);return new;
end$$;
notify pgrst,'reload schema';
commit;
