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

## Ad Maiora Immobiliare

Inventory URL: <https://www.admaioraimmobiliare.it/vendita/>

- Traverse every `/vendita/page/{n}/` page and reconcile unique public cards with the archive count. On 2026-08-19 the archive exposed 44 records over 8 pages.
- The public WordPress REST collection currently contains more published property records than the visible sale archive (72 versus 44). Use it only to join stable WordPress post IDs and source timestamps to visible URLs; never include backend-only records in the active/absence baseline.
- Use WordPress post ID as source identity and the dedicated `ID Immobile` value as agency reference.
- Strict geography remains mandatory because the archive includes Santo Spirito and other out-of-scope locations.
- Public JSON-LD `datePublished` is the strongest current page-publication evidence. Preserve `dateModified` separately and never reset market age from it.
- If `datePublished` is unavailable, a WordPress `/uploads/YYYY/MM/` gallery path is weak month-bounded evidence. Original gallery `Last-Modified` is retained during deep sync for audit, not allowed to override a stronger explicit publication date.
- Scope media to the property slider, normalize safe size variants, and exclude related cards/chrome. Renderings and reused new-development imagery carry the same media-reuse limitation.
- `Vendita` is transaction taxonomy, not an explicit active status. Without a dedicated lifecycle label, normalized status remains `UNKNOWN`.

## Studio Casa Bitonto

Inventory URL: <https://www.casa.it/srp/?pId=1098672>

- Studio Casa currently has no independently discoverable public inventory site beyond its social profile. Use the public Casa.it publisher search as a portal-backed publication source, not as proof of the agency's entire mandate inventory.
- Do not use the agency landing page as the absence baseline: it is a ten-card preview. Traverse the publisher search's complete paginator and reconcile every raw record before permitting absence decisions. On 2026-08-19 it exposed 53 records over 3 pages: 52 sale and 1 rental.
- Use Casa.it listing ID as stable publication identity. Preserve the portal partner ID and agency reference, when present, as separate provenance/matching hints.
- Exclude non-sale records before operational ingestion. Strict geography remains mandatory: the validated sale inventory contained 47 Bitonto records and 5 out-of-scope records in Bari/Santo Spirito, Giovinazzo, or Grumo Appula.
- Parse facts and gallery roles from the public `__NEXT_DATA__` detail payload. Casa.it marks floorplans explicitly; use only property gallery media and exclude related recommendations.
- The source exposes a human-readable `modified` date but no reliable public creation/publication date. Preserve portal modification as provenance and never use it to reset market age. Market start remains low-confidence `CRAWLER_FIRST_SEEN` until stronger independent public evidence exists.
- Publisher-search presence is inventory evidence, not a dedicated lifecycle status. Status remains `UNKNOWN` unless a dedicated status/disabled field supplies an explicit signal.
- Portal map coordinates are retained as approximate/street-level evidence; portal position values do not by themselves prove an exact civic or exact property coordinates.
- Do not persist publisher phone/contact fields from the portal payload. The adapter retains only publisher identity and listing facts needed for lifecycle intelligence.

## Futura Immobiliare Bitonto

Inventory URL: <https://www.futurabitonto.it/web/immobili.asp?language=ita&pagref=88306&tipo_contratto=V>

- The AgestaNET/RisorseImmobiliari sale search is GET-pageable with `num_page={n}` even though its controls submit a form. Traverse every advertised page and reconcile the heading count. On 2026-08-19 it exposed 49 unique sale records over 6 pages.
- Use numeric `cod_annuncio` as source publication identity. Preserve the `10116...` agency reference separately; its category letters are not a global chronological sequence.
- Strict geography is mandatory. The validated inventory contained 41 Bitonto/Palombaio/Mariotto records and 8 out-of-scope records in Bari/Palese, Palo del Colle, Modugno, or Binetto.
- Parse commercial facts from dedicated `det_*` fields and hidden Agesta values. Coordinates embedded in the public map are retained as approximate evidence unless an exact civic is independently established.
- Public `article:published_time` is a day-bounded start for the current public cycle. It can represent a relaunch and must not erase older property evidence. Preserve `article:modified_time` separately and never substitute it for publication start.
- Use only original `agestanet.risorseimmobiliari.it/public/annunci/10116/{cod_annuncio}/...` gallery assets. During deep sync, a coherent original-asset `Last-Modified` batch may provide an older observable market-age bound; transformed/cache URLs are not eligible, and media reuse remains an explicit limitation.
- `Vendita` identifies the transaction, not a dedicated lifecycle state. Keep status `UNKNOWN` unless a future source-specific status marker is validated.

## Garofalo Immobiliare

Inventory URL: <https://garofaloimmobiliare.com/immobili>

- The visible inventory is client-rendered by Flazio. Use the same public `RealEstateManager/services/reader_realestate` endpoint as the page, preserve its complete sale filter contract, page with `start`/`length`, and reconcile `properties_count_all_filtered` before permitting absence decisions. On 2026-08-19 it exposed 40 visible sale records in one 100-record API page.
- Use the global numeric property `id` as source publication identity. Codes such as `T`, `D`, `I`, `L`, and `LT` are category/family references and are not one chronological sequence; retain the full code only as the agency reference.
- Strict geography is mandatory. The validated inventory contained 37 Bitonto records and 3 out-of-scope records in Bari, Bisceglie, or Cassano delle Murge. Public map coordinates are approximate and are omitted when they are geographically inconsistent with the declared monitored municipality.
- The API `created_at` value is a day-bounded start for the current Flazio source record. It can represent an import or relaunch and must not erase older property evidence. Preserve `updated_at` separately and never substitute it for creation/start.
- The API `sold=1` flag is deterministic sold evidence. Catalog presence and visible/active flags do not prove a dedicated active lifecycle state, so other current records remain `UNKNOWN`.
- Build gallery URLs only from original `https://globaluserfiles.com/media/{source}` records. Never ingest `/v1/...` derivatives: their `Last-Modified` reflects image transformation/cache creation rather than original upload. During deep sync, original-file `Last-Modified` is bounded market-age evidence, with media reuse retained as a limitation.
- Classify floorplans from the original source filename when it contains a dedicated plan label. Strip publisher contact calls-to-action, telephone numbers, email addresses, and links from normalized descriptions.

## Trio Casa

Inventory URL: <https://www.trovacasa.it/agenzie-immobiliari/trio-casa-s-a-s-bitonto-tc-92459/case-in-vendita>

- Trio Casa has no independently discoverable agency inventory site. Casa.it's former publisher page now returns a publisher 404, while Immobiliare.it blocks the local crawler. Use Trio Casa's dedicated, publicly accessible TrovaCasa sale page as a portal-publication baseline, not as proof of the agency's complete mandate inventory.
- Reconcile the page title count with every agency card and traverse an explicit `rel=next` paginator if it appears. On 2026-08-19 the live page exposed 10/10 unique sale records in one page: 8 Bitonto, 1 Bisceglie, and 1 Palo del Colle.
- Use the numeric TrovaCasa ID from `/annunci/{province}-tc-92459-{id}` as publication identity. Validate agency `92459` in inventory image tokens and on every detail. Preserve the numeric upstream portal `Riferimento` only as cross-portal provenance; it is not an agency reference.
- Parse facts from the labelled detail rows and retain an exact public civic when one is present. Strict geography excludes Bisceglie and Palo del Colle.
- The portal exposes no reliable public creation timestamp or dedicated lifecycle state. Market start remains low-confidence `CRAWLER_FIRST_SEEN`, and status remains `UNKNOWN`; neither catalog presence nor an external portal's update date proves contractual start or active mandate state.
- Scope media to the detail gallery token `X_92459_{listingId}_{imageId}`. TrovaCasa serves resized images with coherent `Last-Modified` values; during deep sync these are low-confidence public-availability bounds only, never exact contractual start. The source exposes neither original assets nor deterministic floorplan roles.
- Exclude publisher phone/email/link data from normalized descriptions and provenance payloads.

## Momento Casa

Inventory URL: <https://www.trovacasa.it/agenzie-immobiliari/momento-casa-bitonto-tc-96100/case-in-vendita>

- Momento Casa has no independently discoverable inventory site. Idealista currently exposes a broader publisher view but blocks the local crawler; use the directly crawlable dedicated TrovaCasa sale page as a portal-publication baseline, never as proof of the agency's full mandate inventory.
- Reconcile the title count with agency-scoped cards and follow an explicit `rel=next` paginator if present. On 2026-08-19 TrovaCasa exposed 4/4 unique sale publications, all in Bitonto. Other public portals showed additional records, which is why absence conclusions remain source-specific.
- Use the numeric TrovaCasa ID from `/annunci/{province}-tc-96100-{id}` as publication identity. Validate agency `96100` in each gallery token and detail publisher link. Preserve the upstream numeric `Riferimento` only for cross-portal matching, not as an agency reference.
- Parse labelled facts and retain exact public civics such as `Via Ammiraglio Vacca 56 e`; normalize a spaced civic suffix without changing the displayed source address. Strict geography remains mandatory even though the currently validated TrovaCasa subset is entirely in Bitonto.
- No reliable creation date or dedicated lifecycle state is exposed. Keep adapter market start at `CRAWLER_FIRST_SEEN` and status `UNKNOWN`. During deep sync, coherent resized-gallery `Last-Modified` values are low-confidence public-availability bounds, with reuse and portal-ingestion delay explicitly preserved as limitations.
- Exclude publisher contact fields and contact-like text from normalized output. Gallery media is source-scoped but does not expose original files or deterministic floorplan roles.

## Comune di Bitonto building practices

Current catalog: <https://dati.puglia.it/ckan/dataset/comune-di-bitonto-elenco-pratiche-edilizie_20241>

- The weekly CC BY 4.0 CSV is an enrichment source, not competitor inventory. BUILDING_DATA_SYNC accepts only approved HTTPS civic-data hosts, a 60-second fetch, and a 25 MB response ceiling.
- Prefer application code APE by default. Group rows by year plus Numero Pratica; Codice Pratica/Numero are fallbacks. Multiple raw rows commonly represent referents or repeated attributes and must not become duplicate practices.
- Never persist Cognome, Nome, Ragione Sociale, R.U.P., or the unfiltered free-text object. Persist only sanitized identifiers, dates, classification, address, status, and cadastral references.
- Create civic links only for exact addresses inside Bitonto, Palombaio, or Mariotto. Street-only records remain unmatched. Cadastral data stays at building-practice level and does not automatically identify a PROPERTY.
- On 2026-08-19 the current feed contained 11,326 rows: 8,935 APE rows grouped into 1,190 practices, with 7,745 duplicate/referent rows removed. A local import produced 497 civic links and safely left 695 practices unmatched; immediate replay produced zero new events.

## Responsible access

Respect each source’s public robots policy, keep concurrency and request rates low, use bounded retries/timeouts, identify the application where configuration permits, cache detail responses during a run, and never use forbidden/private endpoints or attempt authentication bypass.

## Change response

Required selector/marker loss, implausible count collapse, pagination loops, or excessive parse failures produce `STRUCTURE_CHANGED`/`DEGRADED`. Positive observations may be retained when trustworthy, but absence transitions are frozen and a review item is created.
