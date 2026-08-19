begin;

alter table public.agency_listings
  add column exit_confirmed_at timestamptz,
  add column outcome_source text,
  add column outcome_confidence numeric(5,4)
    check (outcome_confidence is null or outcome_confidence between 0 and 1);

alter table public.opportunities
  add column level text not null default 'NONE'
    check (level in ('NONE', 'WATCH', 'INTERESTING', 'HIGH', 'HOT')),
  add column reasons jsonb not null default '[]'::jsonb;

alter table public.manual_overrides
  add column previous_value jsonb,
  add column source text not null default 'USER',
  add column source_reference text;

create table public.post_exit_checks (
  id uuid primary key default gen_random_uuid(),
  agency_listing_id uuid not null references public.agency_listings(id) on delete restrict,
  publication_id uuid references public.publications(id) on delete restrict,
  job_id uuid references public.lifecycle_jobs(id) on delete set null,
  checked_at timestamptz not null default now(),
  technical_disappearance_confirmed boolean not null default false,
  explicit_sale_evidence boolean not null default false,
  switched_agency_evidence boolean not null default false,
  private_relist_evidence boolean not null default false,
  reappearance_evidence boolean not null default false,
  outcome text not null check (outcome in (
    'CLOSED_SOLD',
    'CLOSED_SWITCHED',
    'CLOSED_TO_PRIVATE',
    'CLOSED_WITHDRAWN',
    'OFF_MARKET_NO_SALE_EVIDENCE',
    'NEEDS_VERIFICATION',
    'REAPPEARED'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index post_exit_checks_agency_listing_idx
  on public.post_exit_checks (agency_listing_id, checked_at desc);
create index post_exit_checks_outcome_idx
  on public.post_exit_checks (outcome, checked_at desc);

create trigger prevent_post_exit_checks_mutation
  before update or delete on public.post_exit_checks
  for each row execute function public.prevent_property_lifecycle_history_mutation();

alter table public.post_exit_checks enable row level security;
grant select on table public.post_exit_checks to authenticated;
grant select, insert, update, delete on table public.post_exit_checks to service_role;

create policy "authenticated read post_exit_checks"
  on public.post_exit_checks
  for select
  to authenticated
  using (true);

create index opportunities_level_idx
  on public.opportunities (level, status, score desc, detected_at desc);

comment on table public.post_exit_checks is
  'Append-only evidence ledger for confirmed agency exits and their classified outcomes.';
comment on column public.opportunities.level is
  'Transparent V1 acquisition priority: NONE, WATCH, INTERESTING, HIGH, or HOT.';

commit;
