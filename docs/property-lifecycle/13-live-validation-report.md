# Validazione live di Property Lifecycle Radar V2

Data: 19 agosto 2026  
Branch: `property-lifecycle-v2`  
Base iniziale: `5bbc0d3`  
Ambiente: Supabase locale Docker, fonti pubbliche live, nessun collegamento o scrittura production

## A. Executive Summary

La validazione ha interrogato realmente tutte le dieci fonti e ha normalizzato **639 record raw**, di cui **572 pubblicazioni** in Bitonto, Palombaio o Mariotto. Il Bootstrap Dry Run finale, eseguito su Supabase locale appena resettato, prevede **571 PROPERTY**, una duplicazione/relaunch same-agency, **zero auto-match cross-agency** e **312 pubblicazioni da sottoporre a review**. Le tabelle sono rimaste vuote dopo il run: `properties=0`, `publications=0`, `sync_runs=0`, `snapshots=0`.

Stato adapter: **6 PASS, 4 PARTIAL, 0 FAIL**. Le quattro classificazioni PARTIAL non indicano adapter fittizi: acquisiscono dati live, ma hanno limiti sostanziali su fonte primaria, rate limiting o data inizio. La raccomandazione finale è **NOT READY FOR STAGING**, soprattutto perché nessun match cross-agency è stato dimostrato abbastanza forte da autorizzare un auto-merge e la coda review è ampia.

## B. Stato dei 10 adapter

| Agenzia | Stato | Fonte e inventory live | Raw / accettati / esclusi | Motivo sintetico |
| --- | --- | --- | ---: | --- |
| Iconacasa | PASS | `iconacasa.com/index.php/opportunita` + JSON `ajaxSearchCustomByAgenzia` | 101 / 101 / 0 | JSON riconciliato 101/101, ID e `publish_up` reali, superfici corrette. |
| Vistocasa Bitonto | PARTIAL | `vistocasa.com/it/immobili.aspx` e record mappa WebForms | 112 / 109 / 3 | Inventory live e Venduto validati; `/ws/ws_pubblici.asmx/js` espone `ElencoGeoCase`, ma la POST di sessione restituisce payload vuoto e l'adapter usa i record pubblici embedded. Coordinate solo area/centro zona. |
| Studi Santi | PASS | sitemap e detail `studisantiimmobiliare.it`, ecosistema Miogest | 107 / 86 / 21 | ID globali, reference e timestamp filename reali; batch gallery coerenti. |
| Ad Maiora | PASS | archivio WordPress + REST pubblico | 44 / 35 / 9 | Property ID, JSON-LD publish date e asset originali verificati. |
| Studio Casa Bitonto | PARTIAL | publisher Casa.it | 52 / 46 / 6 | Dry Run finale sano via payload inventory completo; la fonte ha però prodotto 403 intermittenti durante la prima scansione detail. Data inizio solo first crawler evidence. |
| Futura Immobiliare | PASS | AgestaNET/RisorseImmobiliari | 49 / 41 / 8 | `cod_annuncio`, reference, article published e gallery originali verificati. |
| Garofalo Immobiliare | PASS | API Flazio + `globaluserfiles.com` | 40 / 36 / 4 | Asset originali recuperati senza usare cache/CDN Last-Modified; reference non interpretate come sequenza. |
| Trio Casa | PARTIAL | publisher pubblico TrovaCasa | 10 / 8 / 2 | Inventory live corretta, ma nessun timestamp proprietario o fonte agenzia più forte: confidence intenzionalmente bassa. |
| PuntoCasa Bitonto | PASS | WordPress `puntocasagroup.it/acquista-la-tua-casa-2/` | 120 / 106 / 14 | Venduto, trattativa, upload path e asset originali validati; otto affitti trovati e correttamente esclusi dopo fix. |
| Momento Casa | PARTIAL | publisher pubblico TrovaCasa | 4 / 4 / 0 | Dati live e civici reali, ma start soltanto crawler-first-seen e nessun timestamp proprietario dimostrabile. |

## C. Inventario reale rilevato

Distribuzione geografica accettata: **519 Bitonto, 39 Palombaio, 14 Mariotto**.

| Agenzia | Prezzo | mq | vani | piano | civico | coordinate presenti | immagini | planimetrie |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ad Maiora | 31/35 | 35/35 | 32/35 | 10/35 | 20/35 | 35/35 | 35/35 | 0 |
| Futura | 41/41 | 41/41 | 41/41 | 38/41 | 3/41 | 41/41 | 41/41 | 0 |
| Garofalo | 36/36 | 36/36 | 32/36 | 31/36 | 0 | 31/36 | 36/36 | 4 |
| Iconacasa | 95/101 | 101/101 | 101/101 | 101/101 | 0 | 0 | 101/101 | 0 |
| Momento | 4/4 | 4/4 | 4/4 | 0 | 2/4 | 0 | 4/4 | 0 |
| PuntoCasa | 97/106 | 99/106 | 81/106 | 81/106 | 0 | 0 | 106/106 | 0 dichiarate |
| Studi Santi | 86/86 | 86/86 | 86/86 | 68/86 | 38/86 | 0 | 86/86 | 0 dichiarate |
| Studio Casa | 46/46 | 46/46 | 46/46 | 39/46 | 5/46 | 46/46 | 46/46 | 0 nel payload primario |
| Trio | 8/8 | 8/8 | 8/8 | 0 | 2/8 | 0 | 8/8 | 0 |
| Vistocasa | 108/109 | 109/109 | 105/109 | 109/109 | 0 | 108/109 | 109/109 | 53 |

Le coordinate presenti non implicano precisione esatta: Vistocasa, Futura, Garofalo e Studio Casa espongono valori ripetuti/di zona. Non sono stati promossi a `EXACT_COORDINATES`.

### Campione minimo di 30 annunci live

`—` significa informazione non dimostrata dalla fonte.

| Agenzia | external_id / ref | URL | zona / civico | prezzo | mq | vani | piano | start stimato; metodo; confidence | stato / sale signal |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Iconacasa | 45212 / BTN150 | [45212](https://www.iconacasa.com/index.php/opportunita/property/45212-bitonto-palombaio-vendita-appartamento) | Palombaio / — | 137.000 | 144 | 3 | terra | 2026-06-18; `ICONACASA_PUBLISH_UP`; 0,85 | UNKNOWN |
| Iconacasa | 45211 / BTN152 | [45211](https://www.iconacasa.com/index.php/opportunita/property/45211-bitonto-palombaio-vendita-appartamento) | Palombaio / — | 99.000 | 105 | 3 | 1 | 2026-06-18; `ICONACASA_PUBLISH_UP`; 0,85 | UNKNOWN |
| Iconacasa | 44340 / BTN139 | [44340](https://www.iconacasa.com/index.php/opportunita/property/44340-bitonto-santi-medici-vendita-appartamento) | Bitonto / — | 230.000 | 127 | 4 | 2 | 2026-05-04; `ICONACASA_PUBLISH_UP`; 0,85 | UNKNOWN |
| Vistocasa | 9931 / BIT.T284 | [9931](https://www.vistocasa.com/it/immobile.aspx?articoliid=9931) | Bitonto / — | 290.000 | 100 | 3 | 5 | ≤2026-08-19; crawler; 0,30 | SOLD; `Venduto.jpg` |
| Vistocasa | 10002 / BIT.T292 | [10002](https://www.vistocasa.com/it/immobile.aspx?articoliid=10002) | Bitonto / — | 190.000 | 95 | 3 | 4 | ≤2026-08-19; crawler; 0,30 | UNKNOWN |
| Vistocasa | 9068 / BIT.T265 | [9068](https://www.vistocasa.com/it/immobile.aspx?articoliid=9068) | Bitonto / — | 95.000 | 70 | 3 | 3 | ≤2026-08-19; crawler; 0,30 | SOLD; `Venduto.jpg` |
| Studi Santi | 1219 / V000199 | [1219](https://studisantiimmobiliare.it/it/Vendite/bitonto/stabile---palazzo/v000199/1219) | Bitonto / — | 9.000 | 70 | 2 | rialzato | 2021-09-29; filename Miogest; 0,70 | UNKNOWN |
| Studi Santi | 1240 / V000219 | [1240](https://studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000219/1240) | Bitonto / — | 92.000 | 65 | 3 | 2 | 2021-11-09; filename Miogest; 0,70 | UNKNOWN |
| Studi Santi | 1282 / V000256 | [1282](https://studisantiimmobiliare.it/it/Vendite/bitonto/ufficio/v000256/1282) | Bitonto / — | 135.000 | 87 | 1 | terra | 2024-03-07; filename Miogest; 0,70 | UNKNOWN |
| Ad Maiora | 17425 / 0954 | [17425](https://www.admaioraimmobiliare.it/immobile/elegante-trivani-ristrutturato-in-vendita-a-bitonto-zona-centro) | Bitonto / — | 170.000 | 70 | 3 | 2 | 2026-07-29; JSON-LD; 0,90 | UNKNOWN |
| Ad Maiora | 17312 / 0948 | [17312](https://www.admaioraimmobiliare.it/immobile/quadrivani-di-140-mq-in-vendita-a-bitonto-in-zona-via-matteotti) | Via Vitale Giordano / — | 175.000 | 140 | 4 | 3 | 2026-07-23; JSON-LD; 0,90 | UNKNOWN |
| Ad Maiora | 17361 / 0953 | [17361](https://www.admaioraimmobiliare.it/immobile/trivani-con-terrazzino-in-vendita-in-zona-ospedale-a-bitonto) | Via Damascelli / 57 | 128.000 | 94 | 3 | 3 | 2026-07-22; JSON-LD; 0,90 | UNKNOWN |
| Studio Casa | 54523377 | [54523377](https://www.casa.it/immobili/54523377) | Via Giuseppe Ancona / — | 179.000 | 125 | 4 | 4 | ≤2026-08-19; crawler; 0,20 | UNKNOWN |
| Studio Casa | 54520194 | [54520194](https://www.casa.it/immobili/54520194) | Corso Vittorio Emanuele / — | 109.000 | 112 | 3 | 1 | ≤2026-08-19; crawler; 0,20 | UNKNOWN |
| Studio Casa | 54514222 | [54514222](https://www.casa.it/immobili/54514222) | Bitonto / — | 65.000 | 105 | 4 | — | ≤2026-08-19; crawler; 0,20 | UNKNOWN |
| Futura | 2587000 / 10116RA46927 | [2587000](https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2587000&language=ita) | Via Cavallotti / — | 179.000 | 94 | 4 | 2 | 2026-08-04; Agesta article; 0,85 | UNKNOWN |
| Futura | 2571864 / 10116RA36903 | [2571864](https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2571864&language=ita) | Piazza Cattedrale / — | 115.000 | 122 | 3 | 1 | 2026-05-22; Agesta article; 0,85 | UNKNOWN |
| Futura | 2569835 / 10116RA64474 | [2569835](https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2569835&language=ita) | Mariotto, Via Caprera / — | 89.000 | 75 | 3 | 1 | 2026-05-14; Agesta article; 0,85 | UNKNOWN |
| Garofalo | 16104 / I69 | [16104](https://garofaloimmobiliare.com/realestate-detail/reid/16104/via-giuseppe-oronzo-martucci-3-vani) | Via Martucci / — | 95.000 | 120 | 3 | terra/1/2 | 2026-08-04; Flazio created; 0,88 | UNKNOWN |
| Garofalo | 16092 / M25 | [16092](https://garofaloimmobiliare.com/realestate-detail/reid/16092/traversa-via-delle-mattine-3-vani) | Traversa Via delle Mattine / — | 69.000 | 100 | 3 | 2 | 2026-07-31; Flazio created; 0,88 | UNKNOWN |
| Garofalo | 14496 / T08 | [14496](https://garofaloimmobiliare.com/realestate-detail/reid/14496/via-palombaio-3-vani-locale) | Palombaio / — | 190.000 | 95 | 3 | 1 | 2026-06-15; Flazio created; 0,88 | UNKNOWN |
| Trio | 72626464 | [72626464](https://www.trovacasa.it/annunci/ba-tc-92459-72626464) | Via Bruno Buozzi / — | 189.000 | 103 | 3 | — | ≤2026-08-19; crawler; 0,25 | UNKNOWN |
| Trio | 72461820 | [72461820](https://www.trovacasa.it/annunci/ba-tc-92459-72461820) | Via Ammiraglio Vacca / 28 | 145.000 | 100 | 3 | — | ≤2026-08-19; crawler; 0,25 | UNKNOWN |
| Trio | 72069824 | [72069824](https://www.trovacasa.it/annunci/ba-tc-92459-72069824) | Bitonto / — | 59.000 | 55 | 1 | — | ≤2026-08-19; crawler; 0,25 | UNKNOWN |
| PuntoCasa | TR23 | [TR23](https://www.puntocasagroup.it/property-item/bitonto-zona-via-mazzini) | Via Mazzini / — | 450.000 | 219 | 6 | 1 | 2024-10; WP upload; 0,40 | ACTIVE / Vendita |
| PuntoCasa | DP1 | [DP1](https://www.puntocasagroup.it/property-item/bitonto-zona-contessa-2) | Bitonto / — | 400.000 | 240 | 6 | + | 2026-03; WP upload; 0,40 | ACTIVE / Vendita |
| PuntoCasa | slug attico design | [attico](https://www.puntocasagroup.it/property-item/bitonto-attico-design-zona-villa-comunale) | Bitonto / — | 365.000 | — | 3 | 5 | 2025-07; WP upload; 0,40 | ACTIVE / Vendita |
| Momento | 70534497 | [70534497](https://www.trovacasa.it/annunci/ba-tc-96100-70534497) | Via Traetta / 107B | 147.000 | 115 | 4 | — | ≤2026-08-19; crawler; 0,25 | UNKNOWN |
| Momento | 70534493 | [70534493](https://www.trovacasa.it/annunci/ba-tc-96100-70534493) | Viale Giovanni XXIII / — | 174.000 | 90 | 4 | — | ≤2026-08-19; crawler; 0,25 | UNKNOWN |
| Momento | 70534492 | [70534492](https://www.trovacasa.it/annunci/ba-tc-96100-70534492) | Via Ammiraglio Vacca / 56e | 110.000 | 100 | 4 | — | ≤2026-08-19; crawler; 0,25 | UNKNOWN |

## D. Affidabilità data inizio per agenzia

| Agenzia | Metodo reale | Record | Affidabilità / limite |
| --- | --- | ---: | --- |
| Iconacasa | `publish_up` JSON | 101 | 0,85; migliore proxy pubblico noto. `modified` non è start. |
| Vistocasa | crawler first seen | 109 | 0,30; Last-Modified foto è solo evidenza asset, non mandato. |
| Studi Santi | timestamp filename Miogest | 86 | 0,70; batch coerente, può precedere la pubblicazione. |
| Ad Maiora | JSON-LD `datePublished` | 35 | 0,90; rendering/nuove costruzioni richiedono cautela. |
| Studio Casa | crawler first seen | 46 | 0,20; distinto da `last_portal_update`, nessuna falsa data contrattuale. |
| Futura | data articolo Agesta | 41 | 0,85. |
| Garofalo | `created_at` property Flazio | 36 | 0,88; non usa Last-Modified CDN. |
| Trio | crawler first seen | 8 | 0,25; nessun timestamp proprietario inventato. |
| PuntoCasa | mese `/uploads/YYYY/MM/` | 106 | 0,40; filename WhatsApp è corroborante ma non start autonomo. |
| Momento | crawler first seen | 4 | 0,25; nessun timestamp proprietario inventato. |

Distribuzione globale: confidence 0,20: 46; 0,25: 12; 0,30: 109; 0,40: 106; 0,70: 86; 0,85: 142; 0,88: 36; 0,90: 35.

## E. Affidabilità posizione per agenzia

Distribuzione globale: **70 EXACT_ADDRESS, 167 STREET_ONLY, 335 APPROXIMATE_AREA, 0 EXACT_COORDINATES, 0 UNKNOWN**.

Ad Maiora ha 20 civici esatti; Studi Santi 38; Studio Casa 5; Futura 3; Trio 2; Momento 2. Le coordinate ripetute di Vistocasa/Futura/Garofalo/Studio Casa sono trattate come area o centro zona. L'override manuale di location resta autorevole e i test integration verificano che l'automazione non lo degradi.

## F. Capacità rilevamento venduto per agenzia

Distribuzione live: **74 SOLD, 74 ACTIVE, 4 NEGOTIATION, 420 UNKNOWN**. Vistocasa produce 42 SOLD da grafica/property status dedicata; PuntoCasa 27 SOLD e 4 NEGOTIATION; Garofalo 5 SOLD. `SOLD_CONFIRMED` e `NOT_SOLD_CONFIRMED` richiedono evidenza/manual override; la scomparsa da sola non genera vendita. I test coprono Mark Sold, Mark Not Sold e precedenza umana.

## G. Image matching

Prova reale Vistocasa su listing 9931: 25 asset processati, 23 foto, una planimetria e un `Venduto.jpg`, zero logo/recommended listing. Algoritmo effettivo: `DHASH64`, non pHash. Soglia media forte: **0,80**.

| Trasformazione reale | Foto | Planimetria |
| --- | ---: | ---: |
| file identico | 1,0000 | 1,0000 |
| resize | 0,9688 | 1,0000 |
| JPEG ricompresso | 0,9844 | 0,9844 |
| conversione WebP | 0,9531 | 0,9063 |
| immagine non correlata | 0,3594 | 0,6406 |
| foto contro planimetria | 0,4219 | — |

Nell'audit cross-agency finale su 572 record e 924 fingerprint non esiste alcuna coppia media forte ≥0,80 sul primo/deep matching. Esito: pipeline media **PASS** per trasformazioni della stessa immagine; prova di identity cross-agency **PARTIAL**.

## H. Floorplan matching

Le 53 planimetrie Vistocasa e quattro Garofalo sono state separate da foto e grafica venduto quando la fonte/URL le etichetta. Resize, ricompressione e WebP mantengono similarità alta. Non esiste però un classificatore visuale/embedding: URL anonime possono restare foto e nessuna planimetria cross-agency identica è stata dimostrata. Stato **PARTIAL**.

## I. Property Identity

Il Dry Run finale non auto-mergea alcun caso cross-agency. L'audit ampio conta **2.179 coppie cross-agency con score esplorativo ≥0,55**, ma nessuna ha media forte; sono candidate di review, non match confermati.

| # | Coppia | loc | addr | mq | vani/piano | prezzo | img/deep | floorplan | testo | tempo | finale | Valutazione manuale |
| ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 1 | Studi Santi 3813 / Garofalo 14139 | 1 | 1 | 1 | 1 / 0 | 0 | 0,703 / 0,703 | — | 0,099 | 0,797 | 0,915 | Non-match probabile: €88k vs €50k, piano 1 vs terra, nessuna immagine forte. |
| 2 | Futura 2540073 / PuntoCasa 6UYIU | 1 | 1 | 1 | — / 0 | 0 | 0,609 / 0,688 | — | 0,099 | 0,570 | 0,876 | Non-match: €345k vs €150k, piani incompatibili. |
| 3 | Vistocasa 7465 / Studi Santi 3728 | 1 | — | 1 | 1 / 0 | 0 | 0,703 / 0,719 | — | 0,079 | 0,274 | 0,868 | Non-match probabile: €50k vs €202k. |
| 4 | Vistocasa 6878 / Studi Santi 3804 | 1 | — | 1 | 1 / 0 | 0 | 0,656 / 0,734 | — | 0,146 | 0,567 | 0,847 | Non-match probabile: piano e prezzo divergono. |
| 5 | Vistocasa 8092 / Studi Santi 3728 | 1 | — | 1 | 1 / 0 | 0,564 | 0,641 / 0,750 | — | 0,158 | 0,274 | 0,840 | REVIEW, immagine sotto soglia forte. |
| 6 | Garofalo 10991 / PuntoCasa GU77 | 1 | 1 | 1 | 1 / 1 | 1 | 0,453 / 0,719 | — | 0,154 | 0,671 | 0,837 | Plausibile, ma senza civico/media forte: non auto-merge. |
| 7 | Studi Santi 3702 / PuntoCasa KJ | 1 | — | 1 | 1 / 0 | 0,632 | 0,656 / 0,672 | — | 0,086 | 0,488 | 0,836 | REVIEW. |
| 8 | Studi Santi 3619 / PuntoCasa 7Y1 | 1 | — | 0,93 | — | — | 0,719 / 0,719 | — | 0,055 | 0,848 | 0,834 | REVIEW; immobile complesso, segnali incompleti. |
| 9 | Vistocasa 8540 / Studi Santi 3702 | 1 | — | 1 | 1 / 1 | 0 | 0,625 / 0,797 | — | 0,047 | 0,214 | 0,833 | High-scoring non-match: €25k vs €174k. |
| 10 | Studi Santi 3702 / Studio Casa 51722406 | 1 | — | 1 | 1 / 0 | 0 | 0,625 / 0,797 | — | 0,115 | 0,214 | 0,833 | High-scoring non-match: prezzo/piano incompatibili. |

Il fix richiede reference same-agency o immagine/planimetria ≥0,80 per auto-match. Gli indirizzi composti soltanto da Bitonto/Palombaio/Mariotto non contano più come address evidence.

## J. True Market Age / Relaunch

Caso live controllato PuntoCasa: `bitonto-via-mazzini-2` e `bitonto-via-mazzini` condividono reference `ARYA`, titolo e batch media aprile 2026. Il Dry Run li associa alla stessa PROPERTY (score 0,9102) come duplicazione same-agency. Lo scenario integration cambia `source_key`, crea una seconda publication, mantiene `true_market_start_lower_bound=2024-03-01`, incrementa `relaunch_count=1` ed emette `PUBLICATION_RELAUNCHED`. La publication age può ripartire; il true market age no.

## K. Lifecycle safety

HTTP 500/blocked response, timeout reale, JSON malformato, inventory vuoto, marker/selettore assente e struttura cambiata sono coperti da client/inventory regression. `DEGRADED`, `FAILED` e `STRUCTURE_CHANGED` congelano sempre l'absence evaluation. Servono due inventory complete e `HEALTHY` consecutive prima di `REMOVED`; la prima assenza produce `MISSING_PENDING`.

Gli scenari controllati classificano:

- `ACTIVE → EXIT_PENDING → REAPPEARED`;
- `ACTIVE → EXIT_PENDING → CLOSED_SOLD` solo con segnale esplicito;
- `CLOSED_SWITCHED` con altra agenzia attiva;
- `CLOSED_TO_PRIVATE` con private publication attiva;
- `OFF_MARKET_NO_SALE_EVIDENCE` in assenza degli altri segnali.

Quest'ultimo stato genera opportunità `HIGH` con reasons `agency_exit_confirmed` e `no_sale_evidence`; non è uno stato morto. Un errore Playwright non è applicabile ai dieci adapter, che non usano Playwright; il worker browser opzionale non alimenta direttamente le chiusure agency.

## L. Bootstrap Dry Run

Run finale: 11m32s, Supabase locale fresh reset migration 028, `max-assets=1`, exit code 0.

| Agenzia | raw | accepted | excluded | errors | warning unici | health |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Ad Maiora | 44 | 35 | 9 | 0 | 20 | HEALTHY |
| Futura | 49 | 41 | 8 | 0 | 23 | HEALTHY |
| Garofalo | 40 | 36 | 4 | 0 | 18 | HEALTHY |
| Iconacasa | 101 | 101 | 0 | 0 | 45 | HEALTHY |
| Momento | 4 | 4 | 0 | 0 | 5 | HEALTHY |
| PuntoCasa | 120 | 106 | 14 | 0 | 17 | HEALTHY |
| Studi Santi | 107 | 86 | 21 | 0 | 53 | HEALTHY |
| Studio Casa | 52 | 46 | 6 | 0 | 28 | HEALTHY |
| Trio | 10 | 8 | 2 | 0 | 8 | HEALTHY |
| Vistocasa | 112 | 109 | 3 | 0 | 25 | HEALTHY |

Totali: 639 raw; 572 accepted; 571 PROPERTY previste; 1 duplicate same-agency; 0 auto-match cross-agency; 312 review required; 242 warning unici, soprattutto asset limit e confidence/status mancanti; zero source failure. Sale distribution: 74 SOLD, 74 ACTIVE, 4 NEGOTIATION, 420 UNKNOWN. Location distribution: 70 exact address, 167 street, 335 area.

## M. Building Intelligence

Fonte CSV pubblica live: HTTP 200, 5.168.604 byte. Import: 11.326 righe input, 8.935 `application=ape`, 1.190 pratiche raggruppate/inserite, 7.745 duplicate di riga, 695 non associabili, 396 BUILDING, 497 link building e 497 eventi. Replay: zero insert/update/eventi, 1.190 unchanged. Nessun campo personale fra 25 record campionati; zero PROPERTY prima/dopo, quindi nessuna pratica civico è stata promossa a immobile specifico. Stato **PASS non bloccante**.

## N. Private Radar

I test integration confermano separazione `private_publications`/agency publication, candidate identity, evento AGENCY → PRIVATE, opportunità HOT e minimizzazione di nome, telefono ed email. Email e contatti legacy non diventano inventory concorrenti. Override manuali private restano autorevoli. Nessuna fonte privata live è stata acquisita in questo task: il requisito era compatibilità e isolamento, non nuova raccolta.

## O. UI integrity

Workspace `/lifecycle` caricata su dataset live locale: Dashboard, Opportunities, Agencies, Archive, dossier PROPERTY, Review e Private Radar. Prima dei fix Archive falliva `URI too long` e Review portava Next a circa 5,4 GB; dopo batching e top-candidate cap, Playwright dedicato passa **3/3 in 10,6 s** su 1440×1000 e 390×844, senza errori runtime, fallback dati o overflow. Screenshot desktop/mobile sono prodotti dal test. Conteggi verificati contro DB. Nota: il dataset screenshot precedente al fresh reset includeva otto affitti poi eliminati dal parser; i conteggi finali provengono dal Dry Run pulito, non dallo screenshot.

## P. Problemi trovati e corretti

Sono stati trovati **11 problemi reali**: JSON/start/superficie Iconacasa; coordinate Vistocasa malformate; rate limiting Studio Casa; affitti PuntoCasa classificati vendita; auto-merge identity aggressivo; URI troppo lunghe in persistenza; URI troppo lunghe nei read model; esplosione candidate Review; outcome manuale post-exit non valido; leak listener worker; parsing UTF-16 degli artefatti. Tutti hanno un fix mirato e regressioni/prove live; non sono state aggiunte feature di prodotto.

## Q. Limiti noti

- Nessun match cross-agency confermato da media/civico forte; identity resta PARTIAL.
- 312 review required indicano recall ampio e rumore operativo elevato.
- Observation persistence non è una transazione unica.
- Health non usa ancora baseline storica del conteggio sano.
- La finestra temporale post-exit dipende dall'orchestrazione del job.
- Floorplan matching non ha classificatore visuale/embedding.
- Vistocasa ASMX non ha restituito inventory utile nella sessione osservata.
- Studio Casa può bloccare l'IP; il payload inventory riduce ma non elimina il rischio sorgente.
- Trio e Momento dipendono da publisher portal e start a bassa confidence.
- Chrome debugging opzionale non era attivo e non è necessario per questi adapter.

## R. Eventuali azioni richieste all'utente

Prima dello staging serve una decisione su: baseline health per agenzia; transazione/RPC atomica per observation; policy e finestra del post-exit scheduler; capacità operativa di smaltire 312 review; criterio per promuovere almeno alcuni cross-agency match con prova manuale. Non serve alcuna azione production e non è richiesto alcun deploy.

## S. Raccomandazione finale

**NOT READY FOR STAGING**.

La raccolta live dei dieci adapter è reale e il core lifecycle è safety-first, ma Property Identity cross-agency e floorplan matching non hanno ancora evidenza sufficiente; inoltre restano tre rischi architetturali (baseline health, atomicità, finestra post-exit) che staging renderebbe operativi.

## Quality gate finale

| Gate | Esito |
| --- | --- |
| Supabase fresh reset | PASS, migration 001–028 applicate su locale |
| Supabase db lint | PASS, nessun errore schema |
| ESLint | PASS |
| TypeScript | PASS |
| Root unit/regression | PASS, 168/168 in 21 file |
| Adapter regression | PASS, 53 test (inclusi nei 168) |
| Worker | PASS, 123/123 in 17 file; nessun `MaxListenersExceededWarning` |
| Integration locale | PASS, 27/27 in 3 file |
| Playwright | PASS, 4/4 desktop/mobile/dossier/smoke |
| Next.js production build | PASS, Next 16.2.9 |

Il primo tentativo integration post-fix ha correttamente intercettato una regressione: la policy identity prudente bloccava anche i match Private Radar senza media. La policy finale è contestuale e testata: cross-agency richiede reference/media forte; Private Radar può usare civico esatto condiviso con fatti coerenti. La suite completa è stata rieseguita da fresh reset dopo la correzione.
