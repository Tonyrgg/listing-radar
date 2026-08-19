# Testing Strategy

## Test layers

1. **Contract tests:** runtime validation, null semantics, stable content hashing, and invalid-adapter-output rejection.
2. **Golden parser tests:** captured representative Iconacasa and PuntoCasa HTML for inventory/detail/status/media/date cases. Fixtures are sanitized, versioned, and never refreshed silently.
3. **Geography tests:** Bitonto, Palombaio, and Mariotto accepted; same-name ambiguity, province-only matches, Santo Spirito, Bari, and unknowns rejected.
4. **Health tests:** selector loss, count collapse, pagination failure, duplicate explosion, transport failure, and degraded partial output.
5. **Sync tests:** idempotent snapshots/events, repeated healthy missing transitions, unhealthy-run freeze, reappearance, explicit sold, and no false sold conclusion.
6. **Identity tests:** auto-match, review margin, contradiction, new property, image reuse, and manual override precedence.
7. **Age tests:** crawler first-seen, bounded historical evidence, republish, agency switch, and true-age preservation.
8. **Local database integration:** clean migration reset, constraints, RLS assumptions, queue claim/lease, immutable history, and one fixture-backed end-to-end sync.
9. **Regression gates:** root lint/typecheck/tests/build plus the existing desktop-worker suite.

## Fixture policy

Aim for roughly 20 representative records per source as lawful and stable examples become available. The first milestone must at least cover active, sold/negotiation, missing fields, multiple localities, out-of-scope geography, media variants, and parser-structure failure. Tests must not depend on live availability.

## High-risk acceptance tests

- A `FAILED`, `DEGRADED`, or `STRUCTURE_CHANGED` run leaves missing streak/state unchanged.
- A valid first page with unvisited pagination remains `DEGRADED` and cannot create absence.
- The first healthy absence only produces `MISSING_PENDING`; the configured repeated threshold is required for `REMOVED`.
- Related-card text cannot mark an active PuntoCasa detail sold.
- A new publication matched to an existing property does not reset `true_market_start_at`.
- An ambiguous candidate creates review work and does not auto-merge.
- Replaying the same observation creates no duplicate snapshot or event.

## Evidence of completion

The readiness report records exact commands, test counts, migration result, local integration result, known warnings, and remaining deferred scope.
