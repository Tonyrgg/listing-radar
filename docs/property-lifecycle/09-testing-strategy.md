# Testing Strategy

## Test layers

1. **Contract tests:** runtime validation, null semantics, stable content hashing, and invalid-adapter-output rejection.
2. **Golden parser tests:** captured representative fixtures for all ten target agencies, covering their current HTML, XML, JSON/API, or public-portal contracts. Fixtures validate status, media, date, identity, geography, and source-specific failure behavior; they are sanitized, versioned, and never refreshed silently.
3. **Geography tests:** Bitonto, Palombaio, and Mariotto accepted; same-name ambiguity, province-only matches, Santo Spirito, Bari, and unknowns rejected.
4. **Health tests:** selector loss, count collapse, pagination failure, duplicate explosion, transport failure, and degraded partial output.
5. **Sync tests:** idempotent snapshots/events, repeated healthy missing transitions, unhealthy-run freeze, reappearance, explicit sold, and no false sold conclusion.
6. **Identity tests:** auto-match, review margin, contradiction, new property, image reuse, and manual override precedence.
7. **Age tests:** crawler first-seen, bounded historical evidence, republish, agency switch, and true-age preservation.
8. **Local database integration:** clean migration reset, constraints, RLS assumptions, queue claim/lease, immutable history, and one fixture-backed end-to-end sync.
9. **Regression gates:** root lint/typecheck/tests/build plus the existing desktop-worker suite.
10. **Bootstrap dry run:** deterministic in-memory identity simulation, unhealthy-source exclusion, cross-agency prediction, review prediction, existing-publication detection, and before/after table counts proving no lifecycle writes.
11. **Building intelligence:** exact-civic building identity, multi-civic parsing, intervention classification, referent-row deduplication, PII-field exclusion, incremental replay, append-only observations/events, and queued-source execution.
12. **Private Radar:** agency-to-private and simultaneous-private transitions, explicit removal, unchanged replay, strict geography, ambiguous identity, sold/manual conflicts, PII redaction, manual private-state precedence, and queued execution.
13. **Application read models:** dashboard metrics, ten-agency health summaries, archive dossiers, hydrated identity candidates, private-publication state, event timelines, and graceful missing-schema behavior. Route validation covers desktop/mobile rendering and browser console errors against local Supabase.

## Fixture policy

Aim for roughly 20 representative records per source as lawful and stable examples become available. The first milestone must at least cover active, sold/negotiation, missing fields, multiple localities, out-of-scope geography, media variants, and parser-structure failure. Tests must not depend on live availability.

## High-risk acceptance tests

- A `FAILED`, `DEGRADED`, or `STRUCTURE_CHANGED` run leaves missing streak/state unchanged.
- A valid first page with unvisited pagination remains `DEGRADED` and cannot create absence.
- The first healthy absence only produces `MISSING_PENDING`; the configured repeated threshold is required for `REMOVED`.
- Related-card text cannot mark an active PuntoCasa detail sold.
- A Vistocasa related-card sold graphic cannot mark the current property sold; only a listing-scoped graphic can.
- Vistocasa embedded map inventory loss freezes absence decisions.
- Studi Santi sitemap pages and rentals are excluded, out-of-scope details are filtered, and unrelated gallery media cannot influence the Miogest batch date.
- Ad Maiora must traverse all visible archive pages, join every visible URL to a WordPress ID, ignore backend-only published records for absence, and keep `dateModified` separate from `datePublished`.
- Studio Casa must use the complete Casa.it publisher search rather than the agency preview, reconcile raw pagination before excluding rentals, preserve portal modification separately from first-public evidence, exclude publisher contact data, and freeze absence decisions on portal challenge/structure loss.
- Futura must reconcile every Agesta `num_page`, keep `cod_annuncio` separate from agency reference, retain article publication as current-cycle evidence, and accept `Last-Modified` age evidence only from original listing-scoped gallery assets.
- A new publication matched to an existing property does not reset `true_market_start_at`.
- An ambiguous candidate creates review work and does not auto-merge.
- Replaying the same observation creates no duplicate snapshot or event.
- Replaying the same municipal practice feed creates no duplicate practice observation or building event.
- Street-only practices remain unmatched, and no practice is attached directly to a property without unit-level evidence.
- A private advert can close an exited agency listing as `CLOSED_TO_PRIVATE`, while simultaneous agency/private marketing leaves the agency active.
- Historical private events cannot keep a removed publication active; current property state follows `private_publications.state`.
- Private seller name, phone, email, and contact URL never enter V2 private-publication content.
- Equal private identity candidates enter review, sold/manual evidence is not overwritten, and out-of-scope private records are excluded.
- Lifecycle refresh controls enqueue jobs without performing source network work in the request.
- Human review decisions are audit records; they do not silently merge or erase property history.

## Evidence of completion

The readiness report records exact commands, test counts, migration result, local integration result, known warnings, and remaining deferred scope.
