begin;

-- These tables predate the API's revoked-by-default grants. Existing RLS
-- policies already allow authenticated reads; state the intended grants
-- explicitly so a clean Supabase install behaves like the existing project.
grant select on public.street_registry_sources,
 public.street_registry_import_runs, public.street_registry_centers,
 public.street_registry_streets, public.street_registry_street_zones,
 public.street_registry_work_items to authenticated;

grant select,insert,update,delete on public.street_registry_sources,
 public.street_registry_import_runs, public.street_registry_centers,
 public.street_registry_streets, public.street_registry_street_zones,
 public.street_registry_work_items to service_role;
grant select on public.street_registry_worker_queue to service_role;

notify pgrst, 'reload schema';
commit;
