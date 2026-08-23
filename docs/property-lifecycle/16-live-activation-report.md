# Report di attivazione live di Property Lifecycle Radar V2

Data: 23 agosto 2026
Branch operativo: `live-activation-2026-08-23`
Perimetro: database remoto di produzione di Listing Radar, fonti pubbliche live, dataset open data del Comune di Bitonto.

Questo non è un Dry Run. Le scritture nelle strutture Lifecycle sono reali e intenzionali. Nessuna tabella legacy è stata modificata.

---

## A. Supabase target utilizzato

| Voce | Valore |
|---|---|
| Project ref | `yykjxgwrhzoogpxtgssi` |
| Nome progetto | `listing-radar` |
| Region | `eu-west-1` |
| PostgreSQL | 17.6.1.127 |
| Environment | **PRODUCTION** — stesso ref in `.env.local` e nel progetto Vercel `prj_VJ4RvM2...` |
| Legacy presente prima | SÌ, 30.381 righe su 33 tabelle |
| Lifecycle presente prima | NO, zero tabelle su 29 |

L'ambiguità sull'ambiente è stata risolta prima di qualsiasi scrittura: non esiste un progetto DEV/STAGING separato, e il target è stato confermato esplicitamente prima delle migration.

## B. Backup effettuato

Percorso, **fuori dal repository** per non versionare dati sensibili:
`C:\Users\ruggi\listing-radar-backups\20260823-180842-preV2\`

| File | Contenuto | Dimensione |
|---|---|---|
| `schema-public.sql` | schema completo pre-migration | 92 KB |
| `data-public.sql` | dati di tutte le 33 tabelle con contenuto | 38 MB |
| `roles.sql` | ruoli database | 297 B |
| `migration-state-before.json` | stato migration remoto | 1,4 KB |
| `row-counts-before.json` | conteggi riga per tabella | — |
| `linked-project.json` | identificazione progetto | — |

Timestamp: 2026-08-23 18:08–18:12. Metodo: `supabase db dump` via CLI autenticata. Nessun backup precedente è stato sovrascritto.

## C. Migration prima / dopo

**Prima:** la history remota (`supabase_migrations.schema_migrations`) era **completamente vuota**, pur essendo lo schema legacy 001–015 già applicato. Il database non era mai stato gestito via CLI.

Questo rendeva `supabase db push` **distruttivo**: avrebbe rieseguito tutte e 34 le migration, incluse
`013:199 delete from public.internal_zones`, `015:69 delete from public.listings` e `010:17 drop column map_area_id`.

**Procedura adottata in due passi:**

1. `supabase migration repair --status applied` per le 18 versioni 001…015 — scrive **solo** righe nella tabella di history, zero DDL e zero DML sui dati. Prima del repair è stato verificato oggetto per oggetto che quelle migration fossero realmente già applicate: `listings.crm_status` (004), `latitude/longitude/coordinates_source` (005), `portfolio_properties.latitude` (009), assenza di `internal_zones.map_area_id` (010), `internal_zones.zone_number` (013/014), `listings.property_identity_key` più la tabella `listing_sources` e la RPC `merge_listing_records` (015).
2. `supabase db push` — ha applicato **solo** le 016 fino alla 031.

Successivamente è stata applicata anche la **032** (vedi sezione W).

**Dopo:** 35 migration su 35 applicate, ultima `032_property_lifecycle_sale_conflict`, nessuna mancante.

**Verifica di non regressione del legacy:** conteggi riga confrontati prima e dopo, con **0 differenze su 36 tabelle e 30.381 righe invariate**. Le migration 016–031 toccano il legacy solo nella `028`, con due `grant select, insert, update ... to service_role` su `listings` e `listing_snapshots`: permessi, nessun DDL né DML.

## D. Stato dei 10 adapter

**10 PASS, 0 PARTIAL, 0 FAIL.** Zero errori, zero missing.

| Adapter | Esito | Raw | Accettati | Esclusi | Durata |
|---|---|---:|---:|---:|---:|
| Iconacasa | PASS | 101 | 101 | 0 | 890 s |
| Vistocasa Bitonto | PASS | 112 | 109 | 3 | 543 s |
| Studi Santi | PASS | 107 | 86 | 21 | 732 s |
| Ad Maiora | PASS | 44 | 35 | 9 | 373 s |
| Studio Casa Bitonto | PASS | 52 | 46 | 6 | 356 s |
| Futura Immobiliare | PASS | 49 | 41 | 8 | 257 s |
| Garofalo Immobiliare | PASS | 40 | 36 | 4 | 180 s |
| Trio Casa | PASS | 10 | 8 | 2 | 29 s |
| PuntoCasa Bitonto | PASS | 120 | 106 | 14 | 440 s |
| Momento Casa | PASS | 4 | 4 | 0 | 10 s |
| **Totale** | | **639** | **572** | **67** | **3.811 s** |

I quattro adapter classificati PARTIAL nel doc 15 hanno prodotto in questo run inventario completo e detail senza errori. Il PARTIAL del doc 15 riguardava la qualità dell'evidence disponibile alla fonte — assenza di timestamp proprietari, coordinate di zona — non un difetto del crawler: quel limite **resta** ed è riflesso nella confidence, non nell'esito del run.

## E. Inventario raw

**639 annunci grezzi**, identici alla baseline del doc 15 agenzia per agenzia. La sanity check del paragrafo 8 è superata senza scostamenti: nessuna differenza da spiegare, quindi nessun blocco cautelativo sulla disappearance evaluation dovuto a variazione di mercato.

## F. Publication accettate

**572 publication** dentro il perimetro Bitonto / Palombaio / Mariotto. **67 record esclusi** perché fuori perimetro geografico: analizzati tecnicamente ma non promossi a inventario operativo, come impone il paragrafo 9.

Tutte le 727 location risultano nel comune di Bitonto; **zero** record in Palombaio o Mariotto in questo ciclo di mercato.

## G. PROPERTY create

**573 property**: 572 da agenzia più 1 da Private Radar.

Il rapporto è di 1 property per publication: **nessun merge cross-agency automatico**, coerentemente con la policy conservativa. La distribuzione di `identity_status` è 402 `PROVISIONAL`, 171 `REVIEW`, **0 `MERGED`**, 0 `CONFIRMED`.

## H. Agency Listing create

**572 agency listing**, tutti collegati a una property, zero orfani. Stati: 498 `ACTIVE`, 74 `SOLD`.

## I. Building create

**456 building**: 66 dal bootstrap degli annunci e 390 dall'import Building Intelligence.

Solo **71 property su 573** sono collegate a un building. Non è un difetto: il paragrafo 31 impone di associare PROPERTY a BUILDING soltanto quando l'address evidence è sufficiente, e la maggioranza degli annunci non espone un civico.

## J. Location distribution

| Precision | Conteggio |
|---|---:|
| `EXACT_ADDRESS` | 459 |
| `STREET_ONLY` | 150 |
| `APPROXIMATE_AREA` | 118 |
| `EXACT_COORDINATES` | 0 |
| `UNKNOWN` | 0 |
| **Totale** | **727** |

Delle 459 `EXACT_ADDRESS`, circa 390 provengono dai civici delle pratiche edilizie; le location derivate dalle publication sono 69 `EXACT_ADDRESS`, 150 `STREET_ONLY` e 118 `APPROXIMATE_AREA`.

`EXACT_COORDINATES` è **zero**: nessuna coordinata di zona o di centro abitato è stata promossa a coordinata esatta, come richiesto dai paragrafi 12 e 23.

## K. Start evidence distribution

Ogni adapter ha usato esattamente il metodo di evidence previsto dai paragrafi 11–20.

| Metodo | Property | Confidence | Agenzia |
|---|---:|---:|---|
| `ICONACASA_PUBLISH_UP` | 101 | 0,85 | Iconacasa |
| `VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED` | 109 | 0,55 | Vistocasa |
| `WORDPRESS_UPLOAD_PATH_YYYY_MM` | 106 | 0,40 | PuntoCasa |
| `MIOGEST_IMAGE_FILENAME_YYYYMMDDHHMMSS` | 86 | 0,70 | Studi Santi |
| `CRAWLER_FIRST_SEEN` | 46 | 0,20 | Studio Casa |
| `WORDPRESS_JSON_LD_DATE_PUBLISHED` | 35 | 0,90 | Ad Maiora |
| `FLAZIO_PROPERTY_CREATED_AT` | 30 | 0,88 | Garofalo |
| `FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED` | 27 | 0,60 | Futura |
| `AGESTA_ARTICLE_PUBLISHED_DATE` | 14 | 0,90 | Futura |
| `TRIO_TROVACASA_MEDIA_LAST_MODIFIED` | 8 | 0,50 | Trio Casa |
| `GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED` | 6 | 0,65 | Garofalo |
| `MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED` | 4 | 0,50 | Momento Casa |
| **Totale** | **572** | | |

Le 46 property Studio Casa hanno confidence 0,20 perché la fonte non espone alcun timestamp proprietario: resta `CRAWLER_FIRST_SEEN`, senza fingere una data di inizio, come impone il paragrafo 15.

`relaunch_count` è **0 per tutte le 573 property**: nessun rilancio storico è stato inventato.

## L. Sale distribution

| Stato | Property |
|---|---:|
| `SOLD_CONFIRMED` | 74 |
| `PROBABLE_SOLD` | 1 |
| `UNKNOWN` | 498 |
| `NOT_SOLD_CONFIRMED` | 0 |

Le 74 `SOLD_CONFIRMED` derivano tutte da un marcatore "Venduto" esplicito della fonte, con `source_status = SOLD` e 74 eventi `SOURCE_MARKED_SOLD`. L'unica `PROBABLE_SOLD` è il caso di evidence contraddittoria descritto nella sezione W.

Le publication in trattativa sono **4**, con `source_status = NEGOTIATION` e stato publication `ACTIVE`: la trattativa resta tracciata sulla publication e non viene promossa a stato di vendita della property.

**Nessuna scomparsa è stata interpretata come vendita.** Non essendoci osservazioni precedenti, non esistono ancora publication `MISSING` o `REMOVED`.

## M. Image fingerprint count

**7.345 immagini** effettivamente scaricate, decodificate e hashate, ciascuna con SHA-256 e DHASH64, per 14.690 righe. In più **1.583** asset registrati con il solo `SOURCE_URL_SHA256` perché non scaricabili. Totale righe in `image_fingerprints`: **16.273**.

Il cap è `maxAssets = 24` per publication, con delay di 250 ms fra le richieste.

## N. Floorplan fingerprint count

**58 planimetrie** scaricate e hashate, con SHA-256 e DHASH64 per 116 righe, più 1 registrata per solo URL. Totale righe in `floorplan_fingerprints`: **117**.

Nessun match strutturale avanzato è stato dichiarato: la similarità di planimetria resta evidence, non certezza autonoma.

## O. Representative images salvate

**571 property su 573** conservano almeno un'immagine rappresentativa, per un totale di **1.045 path**, con un massimo di 2 per property. Le due property senza immagine sono annunci la cui gallery non era scaricabile.

Il resto della gallery **non** è conservato: di ogni altro asset restano soltanto fingerprint e metadata, e i file temporanei sono stati eliminati dopo il processing, come impone il paragrafo 21.

## P. Review Queue

**196 casi aperti**, nessuno auto-risolto.

| Tipo | Conteggio |
|---|---:|
| `IDENTITY` | 171 |
| `GEOGRAPHY` | 24 |
| `LIFECYCLE` | 1 |

Le review di identità sono 171 contro le 121 della baseline del doc 15. **La differenza è spiegata e non indica una regressione di precisione.** Il Dry Run #2 girava con `max-assets=1`, quindi una sola immagine per annuncio e confronto fotografico quasi sempre indisponibile. Questo bootstrap ha processato 7.345 immagini invece di circa 639, e in ogni review campionata la feature `image` risulta `available: true` con similarità fra 0,78 e 0,81. Più evidence fotografica significa più coppie che superano la soglia di retrieval: 2.288 candidati generati.

L'auto-match cross-agency resta **0**, quindi l'aumento di review non ha prodotto alcuna fusione automatica.

## Q. Opportunities

**573 opportunity**, tutte di tipo `ACQUISITION`.

| Livello | Stato | Conteggio |
|---|---|---:|
| `WATCH` | `OPEN` | 321 |
| `NONE` | `EXPIRED` | 177 |
| `NONE` | `DISMISSED` | 75 |
| `HOT` / `HIGH` / `INTERESTING` | — | **0** |

Zero opportunity HOT, HIGH o INTERESTING è il risultato **corretto** per un Day Zero: quelle categorie richiedono un'uscita dall'agenzia o un passaggio a privato realmente osservati, e al primo bootstrap il Radar non ha ancora osservato alcuna transizione. Le 75 `DISMISSED` corrispondono alle property vendute, secondo la regola `SOLD_CONFIRMED => NONE` del paragrafo 30.

Una opportunity HIGH fabbricata è stata individuata e rimossa: vedi sezione W.

## R. Building Intelligence

Sorgente: `comune-di-bitonto-elenco-pratiche_2024.csv` dal portale open data Maggioli. Esito `SUCCEEDED`, 0 warning, 0 errori, durata 92 s.

| Indicatore | Valore | Baseline paragrafo 32 |
|---|---:|---:|
| Righe input | 11.326 | ~11.326 |
| Righe eleggibili (`ape`) | 8.935 | 8.935 |
| Pratiche raggruppate | 1.190 | 1.190 |
| Righe duplicate scartate | 7.745 | — |
| Pratiche non associate | 695 | — |
| Building collegati | 497 | — |
| Eventi building creati | 497 | — |
| Building creati | 390 | ~396 |

Nessun nome di persona è stato usato come lead. Nessuna pratica è stata associata automaticamente a una PROPERTY specifica: il collegamento è a livello di civico e building.

## S. Private Radar

**1 private publication**, 1 property `ACTIVE_PRIVATE`, 2 candidati di match, 1 review aperta.

Il numero è basso ma **corretto**: il database legacy contiene una sola inserzione con `seller_type = private` su 388 totali, contro 384 di agenzia e 3 unknown. Il bridge ha collegato esattamente quella. Nessun contatto o email è stato trasformato in inventario, e nessun manual override esistente è stato alterato.

Nessun `AGENCY_TO_PRIVATE` è stato dichiarato: richiederebbe un'identità dimostrata che al Day Zero non esiste.

## T. Adapter Health baseline

Tutte e 10 le agenzie hanno una baseline persistita con `successful_run_count = 1` e `consecutive_healthy_runs = 1`. Tutti i run risultano `HEALTHY` con reason `baseline_warmup`.

| Agenzia | Inventory osservato | Run |
|---|---:|---:|
| Iconacasa | 101 | 1 |
| Vistocasa | 112 | 1 |
| Studi Santi | 107 | 1 |
| Ad Maiora | 44 | 1 |
| Studio Casa | 52 | 1 |
| Futura | 49 | 1 |
| Garofalo | 40 | 1 |
| Trio Casa | 10 | 1 |
| PuntoCasa | 120 | 2 |
| Momento Casa | 4 | 1 |

**Nota terminologica:** il doc 15 parla di uno stato `WARMING_UP`, ma quella stringa non esiste nel codice. Il meccanismo equivalente è `HEALTH_BASELINE_MIN_SAMPLES = 3` con il flag `baselineReady`, che richiede almeno 3 campioni **e** 3 run sani consecutivi; finché è falso, `absenceEvaluationAllowed` è falso e le transizioni di assenza restano bloccate.

**PuntoCasa ha 2 run** perché è stata ri-sincronizzata dopo la correzione descritta nella sezione W. È una seconda osservazione reale, non un run fabbricato. Nessun run #2 o #3 è stato inventato per portare artificialmente la baseline a READY.

## U. Stato scheduler / worker

Workflow: `.github/workflows/property-lifecycle.yml`, eseguito su GitHub Actions.

| Job | Cadenza (UTC) | Europe/Rome (CEST) |
|---|---|---|
| FAST SYNC, tutte le agenzie | `0 4,9,13,17 * * *` | 06:00 / 11:00 / 15:00 / 19:00 |
| DEEP SYNC, 1 agenzia a rotazione | `30 1 * * *` | 03:30 |
| BUILDING_DATA_SYNC | `30 2 * * 1` | 04:30 del lunedì |
| POST_EXIT_CHECK | guidato da `next_check_at` | — |

Il POST_EXIT non ha bisogno di uno scheduler dedicato: la migration 031 accoda il job dall'interno della RPC quando rileva un'uscita e lo ripianifica se il check arriva prima della scadenza. Il worker deve solo drenare la coda rispettando `run_after`.

**Vincolo che ha determinato la cadenza:** il repository è privato, quindi GitHub Actions Free offre 2.000 minuti al mese e un limite rigido di 6 ore per job. Un DEEP SYNC quotidiano dell'intero mercato con gallery completa costa circa 63 minuti di esecuzione e circa 1.900 minuti al mese: non sostenibile. Da qui la rotazione di una agenzia al giorno con `LIFECYCLE_DEEP_MAX_ASSETS = 6`, che dà a ogni agenzia un deep sync circa settimanale.

Il crawling massivo **non** passa da richieste sincrone Vercel.

I secret `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_PROJECT_REF` sono configurati nel repository.

## V. Campione manuale 30 listing

30 publication verificate, 3 per ciascuna delle 10 agenzie, confrontando il database con le pagine pubbliche.

Nessuna discrepanza su prezzo, superficie, vani, indirizzo, stato o relazione property. Verifica puntuale su Ad Maiora 17361: il DB riporta `128.000 € / 94 mq / 3 vani / Via Dottor Domenico Damascelli 57`, e la pagina pubblica riporta gli stessi valori.

Due anomalie apparenti sono state investigate ed **entrambe si sono rivelate corrette**:

- Un conteggio di 54 fingerprint su una publication con `maxAssets = 24` sembrava aritmeticamente impossibile. In realtà `image_fingerprints` contiene una riga **per algoritmo**: 24 `DHASH64`, 24 `SHA256` e 6 `SOURCE_URL_SHA256` su 30 URL distinti. Il cap è rispettato.
- Un appartamento Vistocasa a 7.000 € per 60 mq sembrava un affitto finito nell'inventario vendita. La pagina pubblica riporta "Vendita" e quel prezzo: è un immobile reale del centro storico. Gli altri prezzi bassi corrispondono a capannoni, depositi, uffici, terreni agricoli e cantine.

## W. Errori trovati e corretti

### W.1 — Migration history vuota (bloccante, corretto prima di scrivere)

Descritto nella sezione C. Senza il repair, il push avrebbe cancellato righe di produzione da `listings` e `internal_zones`.

### W.2 — Il worker schedulato non calcolava alcun fingerprint immagine

`executeAgencySync` non passava `assetProcessor` a `runAgencySync`. Poiché il motore processa gli asset solo in modalità `DEEP_SYNC` e `BOOTSTRAP`, ogni deep sync schedulato avrebbe persistito publication **senza alcun fingerprint**: l'evidence fotografica avrebbe smesso di accumularsi subito dopo il Day Zero, degradando silenziosamente l'identity nel tempo.

Corretto fornendo un processor di default, mantenuto iniettabile per i test, con il cap configurabile via `LIFECYCLE_DEEP_MAX_ASSETS`.

### W.3 — Uscita dall'agenzia fabbricata per property mai pubblicate da un'agenzia

In `repository.ts`, quando la valutazione delle opportunity non trovava alcun agency listing, il fallback passava alla regola uno stato `OFF_MARKET_NO_SALE_EVIDENCE` **hardcoded**, che produce un'opportunity `HIGH` con reason `agency_exit_confirmed`.

Per la property privata, che ha zero agency listing e zero eventi, il sistema ha così dichiarato un'uscita dall'agenzia che il Radar non ha **mai osservato**, in violazione diretta dei paragrafi 30 e 42, presentandola per giunta come opportunity a priorità massima.

Corretto rendendo lo stato nullable e limitando i rami di uscita a un listing realmente osservato. Aggiunti due test di regressione. Dopo la correzione l'opportunity fabbricata è sparita: 0 HOT, HIGH e INTERESTING.

### W.4 — Un sold graphic sovrascriveva una trattativa esplicita

La RPC atomica trattava qualunque sold graphic come evidence deterministica di vendita:

```sql
elsif v_status = 'SOLD' or v_sold_graphic then
    v_sale_status := 'SOLD_CONFIRMED';
```

Una publication PuntoCasa dichiarata "In trattativa", con `source_status = NEGOTIATION` e confidence 0,97, portava un overlay "venduto" fra i propri asset ed è stata scritta come `SOLD_CONFIRMED` **senza sollevare alcuna review**, perdendo la distinzione VENDITA / TRATTATIVA / VENDUTO imposta dai paragrafi 19 e 28.

Corretto con la migration `032`, che aggiunge un ramo di conflitto: se un sold graphic contraddice uno stato esplicito della fonte diverso da SOLD, il risultato è `PROBABLE_SOLD` con review aperta, coerentemente con il trattamento già previsto per una publication attiva in conflitto. Validata su Supabase locale con reset completo dalla 001 alla 032 prima del push in produzione. PuntoCasa è stata poi ri-sincronizzata: `SOLD_CONFIRMED` da 75 a 74, `PROBABLE_SOLD` da 0 a 1, incoerenze 0.

### W.5 — Race sull'orologio nell'accodamento dei job

`run_after` veniva impostato dall'orologio del client mentre la coda lo confronta con l'orologio del database: il drain che segue nello stesso secondo non trovava nulla da reclamare. È un difetto reale anche per il workflow schedulato, dove enqueue e drain sono consecutivi. Corretto retrodatando `run_after` di 60 secondi.

## X. Quality Gate

| Gate | Esito |
|---|---|
| ESLint | PASS, 0 problemi |
| Typecheck | PASS |
| Test unit root | PASS, 181/181 in 23 file |
| Test worker | PASS, 123/123 in 17 file |
| Test integration / failure / lifecycle | PASS, 29/29 in 3 file |
| Next.js production build | PASS |
| Supabase reset locale 001→032 | PASS |
| Supabase DB lint (remoto) | PASS, nessun errore di schema |
| Migration state remoto | PASS, 35/35, nessuna mancante |
| Integrità referenziale | PASS, 0 orfani, 0 duplicati source key, 0 job falliti |
| Legacy invariato | PASS, 0 differenze su 30.381 righe |
| Playwright smoke | PASS |
| Playwright Lifecycle | **FAIL parziale**, vedi sotto |

**Playwright Lifecycle:** 3 test falliscono, tutti sulla medesima asserzione `expect(errors).toEqual([])`. Gli errori raccolti sono **esclusivamente** fallimenti del WebSocket di hot-reload di Next in modalità dev: filtrando il rumore HMR, gli errori runtime reali sono **0** su tutte e sei le superfici, sia desktop sia mobile. Tutte le asserzioni sostanziali passano prima di quella riga: dossier agenzia HTTP 200, dossier proprietà HTTP 200, heading "Timeline completa" visibile.

Non è possibile eseguire la suite contro un build di produzione senza credenziali di login: `src/lib/auth.ts` impone l'autenticazione quando `NODE_ENV = production`, indipendentemente da `AUTH_REQUIRED`. È una scelta di sicurezza corretta, non un difetto.

## Y. Blocker residui

1. **Suite Playwright Lifecycle non completabile in questo ambiente.** Serve eseguirla con `LIFECYCLE_E2E_BASE_URL`, `LIFECYCLE_E2E_EMAIL` e `LIFECYCLE_E2E_PASSWORD` contro un server di produzione autenticato. In alternativa, l'asserzione dovrebbe filtrare il rumore HMR quando gira in dev.

2. **Adapter Health non è ancora READY.** Nove agenzie su dieci hanno un solo run osservato, PuntoCasa due. Servono almeno 3 run sani consecutivi per agenzia prima che le transizioni di assenza siano abilitate. Con la cadenza FAST 4 volte al giorno la soglia si raggiunge entro il primo giorno di esercizio. **Fino ad allora nessuna scomparsa definitiva può essere generata**, ed è il comportamento voluto.

3. **Nessun SAME cross-agency ancora dimostrato.** Il limite centrale del doc 15 resta aperto: 0 auto-match e 171 review di identità da valutare operativamente. Il volume di review è cresciuto rispetto alla baseline perché ora esiste evidence fotografica reale, ma nessuna di queste coppie è stata confermata.

4. **DEEP SYNC completo non sostenibile su GitHub Actions Free.** La rotazione di una agenzia al giorno con `LIFECYCLE_DEEP_MAX_ASSETS = 6` è un compromesso: ogni agenzia riceve un deep sync circa settimanale invece che quotidiano. Un budget Actions a pagamento o un host dedicato rimuoverebbe il vincolo.

5. **Il cron di GitHub non segue l'ora legale.** Gli orari indicati sono corretti in CEST; in CET ogni run cade un'ora prima.

6. **Zero inventario in Palombaio e Mariotto.** Nessun record del mercato corrente ricade in quelle frazioni. Da riverificare ai prossimi cicli per escludere un limite di parsing delle località.

7. **Deploy Vercel non modificato.** Il database Lifecycle è popolato e la workspace è raggiungibile, ma nessuna configurazione di produzione né alcun dominio è stato toccato. La sostituzione visiva del Listing Radar legacy resta una decisione separata.
