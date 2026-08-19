# Property Lifecycle V2 — Current System Audit

Status: complete  
Audited: 2026-08-19  
Branch: `property-lifecycle-v2`

## Existing application

Listing Radar is a Next.js 16 App Router application backed by Supabase. Its current ingestion path is listing-centric: `app/api/cron/scrape/route.ts` invokes every configured scraper synchronously, normalizes the results into the legacy `NormalizedListing` shape, calls `upsertListings`, creates a report, and may notify Telegram. The durable legacy model is centered on `listings`, `listing_sources`, and `listing_snapshots`.

That model remains operational and is not replaced by this milestone. Property Lifecycle V2 is additive and introduces a property-centric domain beside it.

## Existing ingestion strengths to retain

- Provider-specific HTML knowledge already exists under `src/lib/scrapers/providers`.
- Shared HTTP utilities provide timeouts, retry behavior, response parsing, and rate limiting.
- Legacy snapshots preserve useful observations.
- Supabase migrations, RLS conventions, and local development tooling are established.
- The app already knows the monitored municipality and priority sources.

## Gaps relative to V2

- A listing URL is treated too much like a property identity.
- Long-running network work happens inside a web request.
- Source health is not a hard prerequisite for absence decisions.
- Missing inventory, removal, sold evidence, agency switching, and relaunches are not modeled as separate states/events.
- There is no durable candidate-scoring workflow for property identity.
- “First seen” cannot distinguish crawler discovery from evidence-backed market start.
- Adapter output lacks a strict, versioned normalized contract and evidence provenance.
- The geography guardrail is not a reusable domain boundary.

## Worker boundary

The existing `worker/` package is an Electron/Playwright desktop workflow for cadastral and CRM operations. It is a separate bounded context. V2 ingestion will use a headless database-backed job runner in the root application, not extend the desktop worker.

## Database inventory

Legacy tables include public listings/snapshots/sources, incoming email listings, map data, CRM request and mandate imports, portfolio properties, and desktop worker tables. The required V2 entity names are currently available. New migrations must be additive; existing migrations and legacy tables are not rewritten.

## Deployment and safety findings

- Local Supabase is healthy after a clean reset and migration lint.
- Existing environment files may contain non-local endpoints. V2 validation must explicitly inject credentials reported by the local Supabase CLI.
- No production schema, data, scheduled job, or deployment is changed in this phase.
- The pre-existing uncommitted change in `src/components/sidebar-nav.tsx` is user-owned and excluded from V2 work and checkpoints.

## Baseline quality result

Before V2 changes: root lint, typecheck, 53 root tests, 123 desktop-worker tests, and the production Next.js build pass. The worker suite emits a pre-existing non-failing `MaxListenersExceededWarning`; it is not caused by V2.

## Live source audit

The following public pages were checked on 2026-08-19 to validate assumptions without bulk crawling:

- Iconacasa Bitonto agency inventory: <https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro>
- Representative Iconacasa detail: <https://www.iconacasa.com/index.php/opportunita/property/45212-bitonto-palombaio-vendita-appartamento>
- PuntoCasa inventory: <https://www.puntocasagroup.it/acquista-la-tua-casa-2/>
- PuntoCasa status archive: <https://www.puntocasagroup.it/property-status/in-trattativa/>
- Representative PuntoCasa detail: <https://www.puntocasagroup.it/property-item/bitonto-zona-via-mazzini/>

Iconacasa currently mixes sale and rental inventory, exposes a durable numeric ID in detail URLs and an agency reference on details, and does not expose trustworthy publication timestamps in public page markup. Its inventory is paginated with `?start=` offsets. PuntoCasa currently includes out-of-scope locations, paginates its inventory under `/page/{n}/`, uses WordPress upload paths that can provide bounded media-date evidence, and exposes explicit status taxonomy such as `Venduto` and `In trattativa`. Whole-page text is not safe for status detection because related cards can contain those labels.

## Decision

Build V2 alongside the legacy radar. Reuse source parsing knowledge and shared infrastructure where safe, but isolate V2 contracts, persistence, jobs, health gates, identity, lifecycle events, and tests. Defer UI replacement and any production rollout until the local first milestone is accepted.
