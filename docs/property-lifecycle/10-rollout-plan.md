# Rollout Plan

## Phase 0 — Environment bootstrap

Complete: dedicated branch, local Supabase/Docker validation, migration reset/lint, browser/image dependencies, baseline gates, and environment documentation.

## Phase 1 — Local V2 foundation

Completed foundation milestone: additive schema, queue, contracts, source health, Iconacasa and PuntoCasa adapters, sync/lifecycle rules, identity v1, true age, deterministic fixtures, and local end-to-end tests.

Current expansion: content/perceptual media evidence, location and sale intelligence, post-exit monitoring, opportunities, and one-at-a-time agency onboarding. All ten target agencies have now passed their source-specific fixture, live inventory, geography, and health gates; migration/database validation is repeated at each checkpoint. Portal-backed agencies remain explicitly scoped to their observable publication source.

Day Zero dry-run support is complete. It simulates all import decisions in memory,
reports source failures and review candidates, and is integration-tested to leave
every lifecycle table unchanged. A real V2 bootstrap remains approval-gated and
has not been run.

Building Memory and the municipal Building Intelligence importer are complete
locally. Exact civic listings reuse durable buildings; the official weekly CSV is
sanitized, grouped by stable practice identity, incrementally versioned, and
linked only at building level. Current-feed import and replay both passed locally.

Private Radar integration is complete locally. The existing private ingestion
path remains unchanged; a queued bridge now creates privacy-minimized current
private publications, participates conservatively in Property Identity, records
agency-to-private acquisition signals, and routes ambiguity/conflicts to review.
No production schedule or legacy replacement has been enabled.

Exit criteria: all checks in `09-testing-strategy.md` pass and legacy behavior remains green. No production deployment follows automatically.

## Phase 2 — Application surfaces

Complete locally: server-only read models and a dedicated `/lifecycle` workspace now cover the signal briefing, opportunities, agency health/inventory, physical-property archive and timelines, evidence, identity review, and Private Radar. Existing Listing Radar remains available for side-by-side comparison, with a dashboard entry point and no sidebar migration.

Refresh controls enqueue deep-sync jobs and never execute crawler work in the request. Authenticated corrections and review decisions are audit-preserving; unauthenticated local sessions remain read-only. These surfaces have not triggered a real bootstrap, enabled a scheduler, deployed production code, or replaced legacy behavior.

## Phase 3 — Additional agencies

Onboard one adapter at a time through fixture, health, geography, and bootstrap gates. Bootstrap runs cannot infer historical missing transitions. Compare source inventory and review exclusions before enabling normal sync.

## Phase 4 — Controlled production shadowing

Requires separate authorization and operational review. Apply additive migrations, run V2 in shadow mode, monitor health/counts/cost, and prohibit external notifications or legacy replacement. Backout means disabling V2 scheduling; additive history remains intact.

## Phase 5 — Lifecycle operations

After evidence quality is measured, enable review workflows, post-exit checks, opportunity derivation, and carefully selected automation. Any automation that affects people, messages, or external systems requires its own approval and audit trail.

## Backward compatibility

Legacy tables and cron remain independent throughout the first phases. No dual-write is required initially. A later migration/backfill must be explicit, repeatable, and provenance-preserving; V2 never silently treats legacy crawler timestamps as definitive market start.
