# Jobs and Operations

## Job types

- `SYNC_AGENCY`: normal complete inventory sync for one agency.
- `SYNC_ALL`: enqueue normal syncs for all enabled agencies.
- `DEEP_SYNC_AGENCY`: inventory plus forced detail refresh for one agency.
- `DEEP_SYNC_ALL`: fan out deep syncs.
- `BOOTSTRAP_AGENCY`: initial history-safe ingestion without absence transitions.
- `BOOTSTRAP_ALL`: fan out bootstrap jobs.
- `POST_EXIT_CHECK`: gather follow-up evidence for an unresolved exit.
- `BUILDING_DATA_SYNC`: enrich a known building through an approved provider.

## Queue semantics

Jobs are stored in `lifecycle_jobs`. A worker atomically claims one eligible row using `FOR UPDATE SKIP LOCKED`, sets a lease and attempt count, then acknowledges success or records a retryable failure. Expired leases are reclaimable. `dedupe_key` prevents duplicate active work. Exponential retry timing is bounded; exhausted jobs move to `DEAD_LETTER` and generate review/operational visibility.

The job payload is validated by type before execution. Unknown fields are ignored only when backward-compatible; missing required identifiers fail before network work.

## Operational controls

- Per-adapter pacing, request timeout, and concurrency limits.
- Global worker shutdown handling and lease release/expiry.
- Structured logs keyed by job, sync run, agency, adapter, and publication.
- Run counters for discovered, normalized, in-scope, excluded, errored, missing, transitioned, and unchanged records.
- Adapter health history and latest agency health.
- Dry-run/fixture mode for parser validation.

## Bootstrap dry run

Day Zero starts with the local-only lifecycle:bootstrap:dry-run command. It reads
enabled agencies and existing V2 identity state, then performs health validation,
normalization, strict geography filtering, bounded asset fingerprinting, and
in-memory identity simulation. It prints a versioned JSON report containing raw
and accepted counts, predicted property/publication writes, existing-publication
duplicates, cross-agency matches, review cases, source failures, and warnings.

The pipeline never creates sync runs, snapshots, evidence, events, jobs, or
operational records. Actual BOOTSTRAP_AGENCY and BOOTSTRAP_ALL jobs require an
explicit payload flag, approved=true, after the report has been reviewed. Bootstrap
mode still disables absence evaluation, so first ingestion cannot manufacture
historical disappearance.

## Scheduler boundary

The future scheduler/API only enqueues jobs and returns quickly. It never performs a full crawl. Production scheduling is deferred; local CLI execution is sufficient for this milestone.

## Local safety

Local execution must reject non-loopback Supabase URLs unless an explicit future deployment mechanism authorizes them. Validation obtains local credentials from the local Supabase CLI and does not load a possibly remote `.env.local` implicitly.
