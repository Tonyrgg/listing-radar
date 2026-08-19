# Source Playbooks — First Milestone

Validated against public pages on 2026-08-19. Fixtures, not live pages, are the deterministic test authority.

## Iconacasa Bitonto

Inventory URL: <https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro>

- Restrict to sale detail links; the agency page mixes sale and rent.
- Traverse every public `?start=` inventory page. On 2026-08-19 the source exposed 6 pages; a first-page-only result is `DEGRADED`, never complete.
- Use the numeric `/property/{id}-...` value as the source external ID.
- Parse agency reference from the dedicated detail field.
- Scope gallery extraction to the property gallery, excluding chrome and related inventory.
- Parse locality from dedicated fields/title and pass it through the common geography resolver.
- Do not use generic response `Last-Modified` as market-start evidence.
- Public markup currently does not reliably expose the previously suspected `publish_up`/`modified` backend fields. If a lawful public endpoint later exposes them, capture them as evidence with source-specific semantics; do not equate `modified` to listing start.
- Old/stale source records are possible, so explicit availability and healthy inventory presence are separate signals.

## PuntoCasa

Inventory URL: <https://www.puntocasagroup.it/acquista-la-tua-casa-2/>

- Inventory includes locations outside Bitonto; strict geography filtering is mandatory.
- Traverse every public `/acquista-la-tua-casa-2/page/{n}/` page and reconcile the aggregate unique count with the advertised inventory count. On 2026-08-19 the source exposed 22 pages and 128 unique publication links.
- Use canonical `/property-item/{slug}/` as publication identity and dedicated reference fields as agency identity hints.
- Parse status from the property’s dedicated taxonomy/metadata only. Whole-page text can contain `Venduto` or `In trattativa` in unrelated cards.
- `Venduto` is strong explicit sold evidence; `In trattativa` is negotiation evidence, not sold.
- Scope media to the property gallery and normalize WordPress image variants to the original asset when safe.
- WordPress `/uploads/YYYY/MM/` paths provide weak bounded media-date evidence, not definitive publication start. Preserve the path and method.
- Ignore theme chrome, logos, avatars, and related-card media.

## Responsible access

Respect each source’s public robots policy, keep concurrency and request rates low, use bounded retries/timeouts, identify the application where configuration permits, cache detail responses during a run, and never use forbidden/private endpoints or attempt authentication bypass.

## Change response

Required selector/marker loss, implausible count collapse, pagination loops, or excessive parse failures produce `STRUCTURE_CHANGED`/`DEGRADED`. Positive observations may be retained when trustworthy, but absence transitions are frozen and a review item is created.
