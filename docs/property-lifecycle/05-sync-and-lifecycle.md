# Sync, Diff, and Lifecycle Rules

## Healthy sync sequence

1. Claim a leased job and create a `sync_run`.
2. Run adapter health and fetch a complete inventory.
3. Normalize and geography-filter every usable item.
4. Resolve or create publication and agency-listing records.
5. Resolve property identity, persist evidence and a snapshot, then emit positive-observation events.
6. Compare the complete observed source-key set with previously active publications for that agency.
7. Increment missing streaks only for keys absent from this `HEALTHY`, complete inventory.
8. Commit run counts/outcome and release the job.

Persistence is idempotent by agency/source key, snapshot content hash, and event deduplication key.

## Missing safety

The default removal threshold is two consecutive complete healthy inventory runs. First absence changes `ACTIVE` to `MISSING_PENDING`, records `missing_since`, and emits `PUBLICATION_MISSING_PENDING`. A later healthy observation resets the streak and emits `PUBLICATION_REAPPEARED`. Reaching the threshold changes the publication to `REMOVED`; it does not by itself claim a sale.

`DEGRADED`, `FAILED`, or `STRUCTURE_CHANGED` runs never increment or reset missing streaks and never close an agency listing.

## Sold and exit logic

An explicit, dedicated source status can set publication state to `SOLD_MARKED` and emit `SOURCE_MARKED_SOLD`. Closing an agency listing as `CLOSED_SOLD` requires policy-defined confidence from that evidence. Removal without sale evidence remains `EXIT_PENDING` until follow-up evidence classifies it, eventually defaulting to `OFF_MARKET_NO_SALE_EVIDENCE` rather than inventing a sale.

Switching, private sale, and withdrawal are separate conclusions. They require corroborating cross-source or manual evidence and are never inferred from a single missing run.

## Relaunch and true age

A new source key or URL may create a new publication while matching the same durable property. `first_seen_at` belongs to the publication; `true_market_start_at` belongs to the property and retains the earliest supported interval across publications and agencies. A relaunch emits `PUBLICATION_RELAUNCHED` or `AGENCY_SWITCH_DETECTED` when evidence supports it, without resetting true market age.

## Private Radar lifecycle

`SYNC_PRIVATE_RADAR` pages through legacy records classified as private and imports only explicit Bitonto, Palombaio, or Mariotto observations. Exact/strong identity can match an existing property; ambiguous candidates create a provisional review property and ranked review work instead of an automatic merge.

An active private publication after a confirmed non-sold agency exit closes the agency relationship as `CLOSED_TO_PRIVATE` and emits `AGENCY_TO_PRIVATE`. Simultaneous active agency and private marketing emits `PRIVATE_RELIST` but leaves the agency active. Sold evidence or a manually confirmed agency state is preserved and produces a lifecycle conflict for review. Private-only first observations do not fabricate relist events.

Private state is current data, not an inference from event history. `archived` legacy state or the latest `listing_snapshots.is_available=false` observation changes it to `REMOVED`; stale `last_seen_at` alone does nothing. Removal and reappearance are immutable events, and repeated identical bridge runs add no duplicate event.

## Manual authority

Manual overrides are append-only and must include a reason. The active override wins in read models, but the underlying derived state and evidence remain queryable. Superseding an override creates a new row linked to the prior row.
