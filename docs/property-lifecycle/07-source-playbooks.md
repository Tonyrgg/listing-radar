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

## Vistocasa Bitonto

Inventory URL: <https://www.vistocasa.com/it/ricerca.aspx?catalogoproduttoriid=56>

- The visible WebForms cards are paged, but the first response embeds the complete agency result set as map `marker` elements. On 2026-08-19 this contained 115 unique records: 112 sale and 3 rental records.
- Treat the embedded map payload as the inventory mechanism; require every marker transaction to classify and every sale marker to yield a numeric `ArticoliId`. Loss of those markers freezes absence decisions.
- Use numeric `ArticoliId` as source identity and the dedicated `BIT.*` detail field as agency reference.
- Scope gallery extraction to `/immobili/fotoimmobile{ArticoliId}/`; never ingest related-card media.
- `Venduto.jpg` inside that scoped gallery is strong sold evidence. It is retained as evidence/fingerprint input but classified as a sold graphic and never selected as a representative property photo.
- Catalog presence without the sold graphic is not promoted to an explicit active source status because this catalog also retains sold records.
- During deep sync, original gallery `Last-Modified` is bounded market-age evidence with source-specific semantics. Generic detail-page `Last-Modified` is ignored.
- Map coordinates are retained as approximate evidence unless another public source proves they are exact.

## Studi Santi Immobiliare

Inventory URL: <https://studisantiimmobiliare.it/sitemap.xml>

- The public sitemap is the complete sale inventory mechanism. On 2026-08-19 it exposed 107 sale detail URLs after excluding the `/it/Vendite/` index itself.
- Most URLs contain both a `V000xxx` agency reference and a global numeric Miogest ID. The numeric ID is source identity; the agency code remains a matching hint. One currently public historical URL lacks the agency-code segment and safely falls back to its numeric ID plus detail breadcrumb.
- Fetch every sale detail from the sitemap, then enforce strict geography. The sitemap includes municipalities outside Bitonto, Palombaio, and Mariotto.
- Read facts from dedicated detail list items and preserve exact public civics where present.
- Scope media to the `img-lighbox` gallery and collapse thumbnail/crop variants by Miogest image ID. Related listing thumbnails are excluded.
- Miogest image filenames embed `YYYYMMDDHHMMSS`. Use the earliest scoped batch as a day-bounded commercial-start estimate; preserve the raw filename timestamp and note that timezone is absent and media may be reused.
- Sitemap `lastmod` is not market-start evidence: current entries expose a common value that does not agree with newer gallery batches.
- No reliable dedicated status marker is currently exposed, so status remains `UNKNOWN` rather than inferred from catalog presence.

## Responsible access

Respect each source’s public robots policy, keep concurrency and request rates low, use bounded retries/timeouts, identify the application where configuration permits, cache detail responses during a run, and never use forbidden/private endpoints or attempt authentication bypass.

## Change response

Required selector/marker loss, implausible count collapse, pagination loops, or excessive parse failures produce `STRUCTURE_CHANGED`/`DEGRADED`. Positive observations may be retained when trustworthy, but absence transitions are frozen and a review item is created.
