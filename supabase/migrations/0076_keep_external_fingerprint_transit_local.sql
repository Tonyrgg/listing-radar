begin;
-- These groups now live locally only until their verified external receipt.
-- Interning their values would leave dictionary garbage after every transfer.
do $$declare d text;begin
 select pg_get_functiondef('public.fingerprint_pack_archive()'::regprocedure)into d;
 d:=replace(d,$old$if new.component_refs is not null then raise exception 'Direct archive references forbidden'; end if;$old$,$new$if new.component_refs is not null then raise exception 'Direct archive references forbidden'; end if;
 if exists(select 1 from public.fingerprint_archive_external_config where singleton)then
  if new.observation_ids is not null or new.observation_snapshots is not null or new.observation_times is not null then raise exception 'Direct packed transit values forbidden';end if;
  return new;
 end if;$new$);
 if position('Direct packed transit values forbidden'in d)=0 then raise exception 'Archive pack function not recognized';end if;execute d;
end$$;
alter foreign table radar_external.retired_rows options(add fetch_size '1000');
notify pgrst,'reload schema';
commit;
