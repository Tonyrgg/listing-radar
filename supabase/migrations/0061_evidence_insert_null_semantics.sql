begin;
create or replace function public.insert_logical_evidence() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into evidence_rows(id,property_id,publication_id,snapshot_id,sync_run_id,evidence_kind,source_url,
 extraction_method,claim_key,raw_value,normalized_value,confidence,observed_at,source_recorded_at,evidence_hash,metadata,created_at)
 values(new.id,new.property_id,new.publication_id,new.snapshot_id,new.sync_run_id,new.evidence_kind,new.source_url,
 new.extraction_method,new.claim_key,new.raw_value,new.normalized_value,new.confidence,new.observed_at,new.source_recorded_at,new.evidence_hash,new.metadata,new.created_at);
 return new;
end $$;
commit;
