# Property Import V2

Property Import V2 replaces only the Tecnocloud import engine. SISTER acquisition,
the persisted acquisition graph, the desktop shell and the archive remain inputs.
No V1 runner or CRM implementation is used by the V2 engine.

## Source of truth

- SISTER is authoritative for people, supplied personal fields, private owners,
  shares, property address and cadastral data.
- An absent SISTER value never clears an existing personal value.
- Existing and imported phone numbers are preserved as a normalized union up
  to the four Tecnocloud phone slots; existing values keep priority and are
  never cleared to make room for a new value.
- Tecnocloud has two email slots. Imported emails have priority; existing emails
  fill any remaining slot.
- Private ownership is an exact replacement by person and share. The cadastral
  right is neither written nor verified. A former managed owner is removed only
  after every current SISTER owner has a usable fiscal code and is synchronized.
- Companies are categorically out of scope. If SISTER reports one, the complete
  property is quarantined before any CRM mutation. Usufruct is ignored; existing
  CRM usufruct links are protected and never created, updated or removed by V2.
- News and mandates are never read as property candidates and are never changed.

## Per-property transaction

Each property advances through an independent persisted checkpoint:

1. `queued`
2. `planned`
3. `people_resolved`
4. `people_synced`
5. `property_resolved`
6. `property_synced`
7. `ownerships_synced`
8. `verified`
9. `activity_synced`
10. `completed`

Every remote write must be idempotent and followed by a read. A property reaches
`completed` only when the CRM contains the expected address, complete cadastral
identity, exact managed-owner set and shares. Cadastral rights are deliberately
outside verification. Activity creation is last and must
perform its own read-before-write duplicate check.

Clicking `Salva` is never ownership evidence. The ownership checkpoint advances
only after the property card exposes every expected person, role and share. If a
save response is late or uncertain, the same checkpoint rereads first and may
repeat the idempotent add; a process-local "submitted" flag can never suppress
that recovery.

Tecnocloud stores the primary owner in `Proprietario Predefinito` / `Quota
Proprietario`, outside the `Soggetti collegati` card used for co-owners. V2 reads
and synchronizes these two surfaces separately, then verifies their combined
owner set. It never attempts to add the primary owner again as a co-owner.

A lookup is committed only when the selected CRM option has made the input
`readonly` and its container exposes `slds-has-selection`. Matching visible text,
an `aria-selected` search row, or a closed results list are not sufficient. An
already committed lookup is retained; a different selection is removed through
the component action before a replacement is typed. This rule applies to birth
place, municipality, primary owner and co-owner lookups.

Birth-place and municipality searches additionally ignore Lightning's immediate
search-term row, wait for the real Salesforce record identifier, stabilize the
result list and require a unique city/province match before clicking.

All navigation on the single Tecnocloud tab is serialized. Searches for two
owners, related-property pairing and the global cadastral guard never run in
parallel against the same page. An exact-CF result may be reused only inside
the current worker process and only until the first write for that CF; the
cache is invalidated on create, overwrite and merge and never survives a
restart. This removes the immediate duplicate search without weakening crash
recovery.

## Identity rules

- A person is searched only by normalized fiscal code.
- Multiple people may be merged only when the normalized fiscal code is exactly
  identical. The merge driver must select every left-column value before save.
- A property is exact only when full address and all cadastral fields coincide.
- One address match with different cadastral fields means update that property.
- The full related-property list is inspected. Names such as
  `IM - Via Publio Virgilio Marone 2 [25] - Abbadessa` are compared as
  `Via Publio Virgilio Marone 2 [25]`; the bracketed internal remains significant.
- Multiple indistinguishable address matches are quarantined, never guessed.

## Recovery

- Transient element or portal errors trigger a bounded local recovery from the
  current checkpoint, not a full run restart.
- Local recovery closes only unfinished dialogs. It does not navigate to the
  Tecnocloud home: the retried operation opens its own required record, avoiding
  an unrelated full-page refresh before every attempt.
- Exhausted property-local errors quarantine only that property and the batch
  continues.
- Login expiry or a portal-wide outage pauses the batch.
- Every quarantine retains stage, reason, evidence and audit events.
- A batch containing even one quarantined property is incomplete: quarantined
  items never increase the completed counter and the desktop must not show the
  successful-import state. An explicit resume keeps verified checkpoints but
  receives a fresh bounded retry budget.

## HTTP and UI

The hybrid port uses an internal Tecnocloud HTTP operation only after its contract
has been observed and verified. Endpoint observations retain only method, path,
query-key names and payload shape; cookies, headers and field values are never
stored. Unverified operations use the independent UI driver.

## Controlled production test data

Tecnocloud has no staging tenant. Test people must contain a clear marker in
`Note private`; test properties use the same marker in `Note catasto`. Fiscal
codes are supplied or explicitly approved before creation so the worker never
generates a plausible real-person identity by accident.
