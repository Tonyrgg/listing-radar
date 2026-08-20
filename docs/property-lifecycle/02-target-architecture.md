# Target Architecture

## Bounded contexts

```text
Scheduler / CLI
      |
      v
 lifecycle_jobs  --->  Headless V2 worker
                            |
          +-----------------+------------------+
          |                 |                  |
      Adapter          Sync engine       Identity engine
          |                 |                  |
          +------ normalized observations ----+
                            |
                            v
                  Local Supabase V2 tables
                            |
                  Server-only read models
                            |
                  Lifecycle operator UI
```

The scheduler only enqueues work. A headless worker claims jobs atomically, invokes a source adapter, validates its health and output contract, then commits a sync transaction. Network crawling is not tied to a browser request lifetime.

## Layers

### Adapters

Adapters know source URLs, inventory structure, detail structure, status taxonomy, media extraction, and source-specific date evidence. They do not decide durable lifecycle transitions or property identity.

### Normalized contract

All adapters return the same versioned observation type. The contract separates source identity, commercial fields, geography, media, status evidence, date evidence, extraction warnings, and raw provenance.

### Sync engine

The sync engine records a `sync_run`, validates source health, persists snapshots/evidence, diffs publications, emits immutable events, and applies missing-run rules. It owns publication and agency-listing state transitions.

### Private Radar bridge

The bridge reads the existing private-listing archive without replacing its ingestion path. It applies strict geography, removes seller contact data, resolves the same property identity model, and persists a first-class current private-publication state. It emits agency-to-private, simultaneous-private, removal, reappearance, or conflict events only from explicit observations; record age alone never marks a private advert removed.

### Identity engine

Identity compares an observation to existing properties, stores scored candidates and feature contributions, and returns `AUTO_MATCH`, `REVIEW_REQUIRED`, or `NEW_PROPERTY`. It does not mutate historical observations to manufacture certainty.

### Persistence

V2 uses normalized core entities and append-only history. JSONB is reserved for source payloads, extraction metadata, scoring explanations, and evolving optional attributes—not as a substitute for core relational fields.

### Application surfaces

The `/lifecycle` route group reads V2 through a server-only repository. It exposes the signal briefing, acquisition opportunities, per-agency health and inventory, physical-property dossiers, the identity review queue, and the privacy-minimized Private Radar. Database credentials and raw queries never cross the server-component boundary.

Refresh actions enqueue `DEEP_SYNC_ALL` or `DEEP_SYNC_AGENCY`; they never crawl within a browser request. Authenticated manual sale, agency-outcome, verification, and review decisions append auditable overrides or queue records. A review decision records human judgment but does not silently merge or delete properties.

## Reliability model

- Jobs are retryable, leased, and idempotent by deterministic deduplication keys.
- Each sync has a run identity and source scope.
- Adapter health is evaluated before absence diffs.
- Publications require repeated successful complete inventories before removal.
- A job failure records diagnostics and leaves prior commercial state intact.
- Every external request has bounded timeout, retries, and source pacing.

## Coexistence

The legacy cron, tables, pages, and desktop worker continue unchanged. V2 code lives under `src/lib/property-lifecycle`, V2 jobs use their own table, and V2 migrations are additive. Lifecycle pages coexist under their own route group and degrade safely when the configured database has not received V2 migrations. Production scheduling, bootstrap, deployment, and legacy replacement still require separate approval.
