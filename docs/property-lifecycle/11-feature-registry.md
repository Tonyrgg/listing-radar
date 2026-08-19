# Feature Registry

| Capability | Milestone status | Source of truth | Notes |
| --- | --- | --- | --- |
| Additive V2 schema | Phase 1 | Supabase migrations | No legacy rewrite |
| Durable job queue | Phase 1 | `lifecycle_jobs` | Leases, retry, dedupe, dead letter |
| Normalized listing contract | Phase 1 | V2 domain schema | Runtime validated and versioned |
| Adapter health gate | Phase 1 | `adapter_health`, `sync_runs` | Blocks absence decisions |
| Strict geography | Phase 1 | Geography resolver | Bitonto, Palombaio, Mariotto only |
| Iconacasa adapter | Phase 1 | Golden fixtures + adapter | Sale inventory/detail |
| PuntoCasa adapter | Phase 1 | Golden fixtures + adapter | Dedicated status parsing |
| Vistocasa adapter | Phase 3 complete | Embedded-map golden fixtures + adapter | Sold graphic and original-media header evidence |
| Studi Santi adapter | Phase 3 complete | Sitemap golden fixtures + adapter | Miogest identity and filename batch dates |
| Ad Maiora adapter | Phase 3 complete | Visible-archive + WordPress REST golden fixtures | Backend-only records excluded from absence baseline |
| Studio Casa adapter | Phase 3 complete | Casa.it publisher-search + detail golden fixtures | Portal modification is not market-start evidence; contact data excluded |
| Futura adapter | Phase 3 complete | Agesta paginated inventory + original-gallery fixtures | Current-cycle article date plus original-media age bound |
| Snapshots and evidence | Phase 1 | V2 history tables | Append-only observations |
| Missing crawl safety | Phase 1 | Sync engine | Repeated complete healthy runs |
| Explicit sold status | Phase 1 | Lifecycle policy | No sale inferred from disappearance |
| Property Identity v1 | Phase 1 | Candidate scorer | Auto/review/new outcomes |
| True market age | Phase 1 | Property age interval | Survives relaunch/switch |
| Manual overrides | Phase 1 schema/domain | Override ledger | Append-only authority |
| Identity review UI | Deferred Phase 2 | Future UI/read model | No UI in first milestone |
| Property timeline UI | Deferred Phase 2 | Future UI/read model | No UI in first milestone |
| Additional agencies | Phase 3 active | Adapter registry | Garofalo Immobiliare is next; continue one gated source at a time |
| Production scheduler | Deferred Phase 4 | External scheduler/enqueue API | Explicit authorization required |
| Legacy backfill | Deferred | Repeatable migration job | Preserve timestamp uncertainty |
| Building enrichment | Schema/job only | Approved future provider | No automated conclusions yet |
| External notifications/actions | Deferred | Audited automation | Separate approval required |

## Change protocol

Every feature moving from deferred to active must identify its owner, data/evidence contract, health and failure behavior, test fixture coverage, migration impact, privacy/legal constraints, and rollback method. This registry is updated with each accepted milestone.
