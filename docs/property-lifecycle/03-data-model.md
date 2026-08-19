# Data Model

## Entity chain

```text
agencies -> agency_listings -> publications -> snapshots
    |              |                 |             |
    |              v                 v             v
    |          properties <-------- events      evidence
    |              |
    |              +-> locations / buildings
    |              +-> image_fingerprints
    |              +-> floorplan_fingerprints
    |              +-> opportunities
    |
    +-> sync_runs -> adapter_health

properties -> property_match_candidates -> review_queue
listings -> private_publications -> properties
private_publications -> private_property_match_candidates -> review_queue
properties -> manual_overrides
buildings   -> building_events
buildings   <- building_practice_buildings <- building_practice_records
building_practice_records -> building_practice_observations
building_data_import_runs -> building_practice_observations
lifecycle_jobs drives work independently of HTTP requests
```

## Core ownership

- `agencies`: one monitored source/agency configuration and adapter key.
- `properties`: durable real-world identity and market-age anchors.
- `agency_listings`: one agency’s commercial relationship with a property, possibly spanning multiple publications.
- `publications`: one externally addressable source record/URL and its availability state.
- `snapshots`: immutable normalized observations from a publication at a point in time.
- `events`: immutable lifecycle facts or derived transitions with confidence and evidence links.
- `evidence`: source facts supporting status, dates, location, identity, or event conclusions.
- `locations`: normalized geography plus raw source location and resolution confidence.
- `buildings`: optional building identity shared by properties.
- fingerprint tables: perceptual or cryptographic identity hints for images and floorplans.
- `property_match_candidates`: identity score, outcome, feature contributions, and competing candidate rank.
- `private_publications`: privacy-minimized bridge to one legacy private advert, including current `ACTIVE`/`REMOVED` state; seller names and contacts stay outside V2.
- `private_property_match_candidates`: ranked, auditable private-to-property identity candidates.
- `manual_overrides`: explicit human authority with author, reason, effective time, and supersession chain.
- `review_queue`: actionable ambiguity, parser anomaly, identity review, or lifecycle review.
- `opportunities`: derived business opportunities; recomputable from history.
- `building_events`: append-only building-level observations.
- `building_data_import_runs`: source/version/count diagnostics for each incremental civic-data import.
- `building_practice_records`: current sanitized projection of one deduplicated public practice.
- `building_practice_observations`: append-only content versions for changed practices.
- `building_practice_buildings`: civic-level links; these never imply a specific unit/property.
- `sync_runs`: run scope, completeness, counts, outcome, and diagnostics.
- `adapter_health`: time-series health checks and structural signals.
- `lifecycle_jobs`: leased durable queue with attempts and deduplication.

## State vocabularies

Publication: `ACTIVE`, `MISSING_PENDING`, `REMOVED`, `SOLD_MARKED`.

Agency listing: `ACTIVE`, `EXIT_PENDING`, `CLOSED_SOLD`, `CLOSED_SWITCHED`, `CLOSED_TO_PRIVATE`, `CLOSED_WITHDRAWN`, `OFF_MARKET_NO_SALE_EVIDENCE`.

Adapter health: `HEALTHY`, `DEGRADED`, `FAILED`, `STRUCTURE_CHANGED`.

Identity outcome: `AUTO_MATCH`, `REVIEW_REQUIRED`, `NEW_PROPERTY`.

Private publication: `ACTIVE`, `REMOVED`.

Job type: `SYNC_AGENCY`, `SYNC_ALL`, `DEEP_SYNC_AGENCY`, `DEEP_SYNC_ALL`, `BOOTSTRAP_AGENCY`, `BOOTSTRAP_ALL`, `POST_EXIT_CHECK`, `BUILDING_DATA_SYNC`, `SYNC_PRIVATE_RADAR`.

## Time semantics

- `observed_at`: when the crawler saw a fact.
- `source_recorded_at`: timestamp explicitly supplied by the source.
- `market_start_lower_bound` / `market_start_upper_bound`: bounded date estimate with provenance.
- `first_seen_at`: first successful crawler observation.
- `true_market_start_at`: best supported earliest start for the durable property, not reset by republishing.
- `last_seen_at`: latest healthy observation.
- `missing_since`: first complete healthy run in the current missing sequence.

## Integrity rules

- Publication source keys are unique per agency.
- Snapshots and events are append-only.
- One publication can have many observations, but repeated identical payloads use a content hash for idempotency.
- Absence counters advance only from complete `HEALTHY` sync runs.
- Manual overrides outrank derived state while preserving both records.
- Core foreign keys use restricted deletion or nullification; history is never cascade-deleted accidentally.
- A property receives a building only from an exact, in-scope civic address. Street-only and approximate locations never create building identity.
- Municipal-practice storage excludes direct person/company/RUP fields and keeps property association null unless future unit-level evidence supports it.
- Current private property state is derived from active `private_publications`, never from historical private events. Only explicit archive state or the latest unavailable snapshot removes a private publication.
- Private identity ambiguity and any relist against sold or manually confirmed agency evidence enter review instead of silently rewriting authoritative state.
