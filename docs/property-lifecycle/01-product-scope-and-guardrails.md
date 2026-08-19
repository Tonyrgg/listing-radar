# Product Scope and Guardrails

## Goal

Property Lifecycle Radar V2 answers a property-level question: how has a real property moved through agencies, publications, states, and time? It preserves evidence and uncertainty instead of collapsing observations into a single mutable listing row.

## First milestone

The first implementation milestone covers:

- additive V2 schema and a durable job queue;
- a versioned normalized listing contract;
- adapter health and parser structure protection;
- Iconacasa and PuntoCasa inventory/detail ingestion;
- strict Bitonto, Palombaio, and Mariotto geography enforcement;
- observations, snapshots, evidence, and immutable lifecycle events;
- repeated-healthy-run missing protection;
- explicit sold-state handling;
- Property Identity v1 with candidate scores and review outcomes;
- true market age that survives relaunches;
- local tests and local Supabase end-to-end validation.

## Explicitly deferred

- Remaining agencies beyond Iconacasa and PuntoCasa.
- Production deployment, remote migrations, and scheduled production jobs.
- Replacement of the existing Listing Radar cron or UI.
- Automated legal ownership, cadastral, or building intelligence conclusions.
- Automatic merging when identity confidence is ambiguous.
- Property Lifecycle UI implementation.

## Non-negotiable boundaries

1. **Geography:** persist lifecycle inventory only when it resolves to Bitonto proper, Palombaio, or Mariotto. A generic province or postal-code match is insufficient.
2. **Evidence:** retain raw facts, source URL, observed time, extraction method, and confidence. Derived conclusions must point to supporting evidence.
3. **Health before absence:** a failed, degraded, or structurally changed source run cannot increment missing counters or close publications.
4. **Immutable history:** events are append-only. Corrections are new facts or manual overrides, never history rewrites.
5. **Identity caution:** matching creates candidates first. Only high-confidence, non-conflicting evidence may auto-match.
6. **Local-only delivery:** all mutable validation targets local Supabase. No production mutation is authorized.
7. **Legacy preservation:** V2 does not break, replace, or silently alter current Listing Radar behavior in this milestone.

## Definition of ready

The milestone is ready when migrations reset and lint locally, unit and integration tests pass, both source fixtures normalize through the common contract, unhealthy runs demonstrably cannot mark inventory missing, relaunch age is preserved, a local end-to-end sync writes expected V2 rows/events, and all baseline quality gates remain green.
