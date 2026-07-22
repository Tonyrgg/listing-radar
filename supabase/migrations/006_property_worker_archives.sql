-- Saved SISTER acquisitions can be imported later without scraping again.

alter table public.property_worker_jobs
  add column if not exists saved_at timestamptz,
  add column if not exists import_started_at timestamptz;

alter table public.property_worker_jobs
  drop constraint if exists property_worker_jobs_status_check;

alter table public.property_worker_jobs
  add constraint property_worker_jobs_status_check check (status in (
    'ready', 'running', 'needs_review', 'session_expired', 'portal_error',
    'data_incomplete', 'failed', 'paused', 'saved', 'completed'
  ));

drop index if exists public.property_worker_properties_cadastral_unique_idx;
create unique index if not exists property_worker_properties_job_cadastral_unique_idx
  on public.property_worker_properties (job_id, municipality, sheet, parcel, subaltern);

create index if not exists property_worker_jobs_saved_at_idx
  on public.property_worker_jobs (saved_at desc) where saved_at is not null;
