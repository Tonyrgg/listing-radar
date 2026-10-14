# Phase 2 — External Market Evidence

Implementazione del 14 ottobre 2026. Base: 57b0581 e completamento semantico 0022–0023. Migration 0022–0025 applicate sul progetto online collegato su richiesta esplicita alle 23:50 CEST. Nessun deploy web/runtime, push Git, import o backfill production. Le migration precedenti restano intatte.

## Stato dell'implementazione

La base di raccolta, verifica e interpretazione è implementata su Property Lifecycle V2. **L'accesso live completo dei portali non è certificato**: l'audit ha ricevuto 403 sia con HTTP diretto sia con Chrome headless ordinario senza bypass, anche sugli URL Crocifisso reali. Tutte le nuove fonti nascono disabilitate. Un adapter testato con contratto DOM sintetico non è dichiarato validato contro il markup live.

Audit eseguito prima degli adapter: [20-external-market-source-audit.md](20-external-market-source-audit.md).

## Implemented

- `external/policy.ts`: policy `external_market_evidence_v1`, confidence per metodo, precisione delle date, identità della evidence e rotazione DEEP.
- `external/adapters.ts`: identità pubbliche stabili, contratto di inventory Wikicasa nello scope configurato, pagination/count/fingerprint, normalizzazione V2 e verificatori di publication note. Casa riusa il formato pubblico PDP documentato dalle fixture V2 esistenti. JSON-LD è accettato solo per il nodo della property pertinente.
- `external/http.ts`: una richiesta alla volta per fonte, pausa 1,5 s, timeout 20 s, due retry esponenziali, Retry-After rispettato anche dal retry della queue, limiti di dimensione, stop su 403/challenge/circuito aperto, redirect non seguiti, nessun endpoint privato o bypass.
- `external/runtime.ts`: job con lease/retry V2, baseline esistente, inventory → diff → detail, conferma leggera della presenza, agency registry esatta, resolver V2, revisione dei casi probabili/ambigui, perceptual hash tramite pipeline esistente in DEEP.
- Scheduler fan-out V2: una Wikicasa abilitata entra nei giri SYNC/DEEP; BOOTSTRAP non abilita nuove fonti. Le verifiche Immobiliare.it di URL noti sono accodate quando un rapporto entra in EXIT_PENDING / OFF_MARKET_NO_SALE_EVIDENCE, soltanto se la fonte è abilitata.
- Registry: `agencies.market_role` distingue OUR_AGENCY / COMPETITOR / PRIVATE / UNKNOWN; mapping per ID esterno o nome normalizzato esatto con provenance. Nessuna attribuzione automatica del ruolo a tutto il marchio Tecnocasa. La nostra agency resta in archivio e nelle metriche, ma non alimenta nuove opportunità competitor.
- Matching: “terratetto” resta nella famiglia delle case indipendenti, evitando lo scarto della candidata Crocifisso. La differenza di tipologia conserva la contraddizione nel punteggio: revisione, non merge forzato.
- Se riferimento esplicito e indirizzo completo coincidono, un forte scostamento di prezzo viene messo in revisione invece di generare una property duplicata. Le revisioni usano la queue e l'azione SAME/DIFFERENT V2 esistenti; la successiva ingestion rispetta la decisione risolta nel medesimo contesto agency.
- Historical import selettivo: `scripts/property-lifecycle-external-evidence.ts`. Default dry-run; scrittura consentita dal comando solo verso Supabase locale e fonte SEARCH_INDEX abilitata. URL originale, URL della cattura, data del claim e osservazione separati. Non crea publication o presenza corrente.
- Intelligence e scheda esistenti: prima evidence trasversale con provenance, badge fonte, dettagli espandibili, date dichiarate e osservate distinte, prezzo precedente con data sconosciuta, agente esplicito, panoramica essenziale delle agenzie e salute/flag delle nuove fonti in `/fonti`.
- Cache delle viste separata per URL del database, per evitare che una fixture locale riutilizzi cache di un diverso ambiente.

## Migrations

### 0024_external_market_evidence.sql

Configurazione/flag delle fonti, identity mapping delle agenzie, health/run leggeri, metadata delle publication V2 e RPC atomiche. `market_observer_source_runs` conserva diagnostica e conteggi, **non un secondo archivio immobiliare**. I dati commerciali restano in properties / agency_listings / publications / snapshots / evidence / events.

`enabled` abilita raccolta; `projections_enabled` abilita interpretazione nei nuovi detail. `missing_enabled` ha un vincolo **false**: nessuna nuova fonte Phase 2 può autorizzare missing mediante un semplice cambio di flag. Una successiva abilitazione del missing richiederà una migration e nuova validazione tecnica.

La registry parte vuota e i ruoli UNKNOWN. Nessun mapping o appartenenza alla nostra agenzia è inventato. Per una nuova agenzia senza adapter proprio: registrare dati pubblici verificati, un adapter_key distinto `external-only:<slug>`, `enabled=false` per il crawler del sito, e mapping del portale. La raccolta esterna legge il mapping indipendentemente dall'abilitazione del crawler agency. Non accodare un SYNC_AGENCY per un adapter inesistente.

### 0025_external_market_projections.sql

Estende le stesse viste Intelligence e la stessa hydration della property, calcolo trasversale della prima evidence, storico prezzo dichiarato, provenance, agente, disaccordi fra date e metriche agency. Scoring centrale con evidence/versione e selezione del rapporto corrente. La nuova wrapper conserva la semantica Phase 1; le publication esterne sono escluse anche dal missing di un eventuale inventory agency sul medesimo host. L'arricchimento di una publication primaria già nota, come Studio Casa, conserva invece la precedente ownership dell'inventory: il verificatore non la sostituisce.

## Behavior before / after

| Tema | Dopo questa fase |
|---|---|
| Fonte bloccata | Run FAILED e nessuna assenza commerciale |
| Inventory incompleta o totale non dimostrato | DEGRADATA; nessun missing; solo positivi validati |
| Detail invariato | Stesso snapshot; last_seen avanza; evidence significativa deduplicata |
| FAST invariato | Conferma leggera di presenza; non ridata prezzo o detail |
| Published claim antecedente | Migliora earliest evidence quando interpretazione abilitata; first_seen invariato |
| Data portale | Non modifica estimated_acquisition_at |
| Modified claim | Evidence separata; non è publication, acquisizione o ribasso |
| Previous asking senza data | Prezzo precedente noto; change_date NULL e upper bound osservativo, senza precisione inventata |
| Due prezzi simultanei | Conflitto di fonte; non crea PRICE_DROP fra publication |
| URL 404/410 o etichetta non disponibile | Evidence di indisponibilità; non missing, vendita o uscita confermata |
| Venduto senza data | Sold observed; sold_at NULL |
| Venduto con data valida | Sold_at dichiarato; altre publication attive producono conflitto/probabile e revisione |
| Data vendita futura/malformata | Claim conservato a confidence ridotta e interpretazione da verificare |
| Vendita anteriore al monitoraggio | Observed DOM e age non misurabili restano NULL; UI “Età mercato non ricostruibile” |
| Nuova publication | Semantica parallela/relisting e reactivation di Phase 1 conservata |
| Agency propria | Intelligence interna conservata; opportunità competitor soppressa |
| Acquisition OS | Stesso lead/signale/attività idempotenti, con score, evidence e versione aggiornati |

Lo score usa la policy centrale Phase 1 con input arricchiti; il payload identifica `scoreVersion=external_market_evidence_v1`. Il numero di ribassi da previous asking è conservativo: evita di sommare lo stesso ribasso dichiarato e osservato o le copie su più portali. Non è una scadenza di incarico.

## Source coverage

| Fonte | Implementato | Validazione reale | Abilitazione |
|---|---|---|---|
| Wikicasa | Inventory geografica/paginata con gate conservativo; detail/evidence; diff/DEEP | Fatti pubblici da indice per più agenzie; HTTP 403; markup e paginazione live da certificare | Off; nessun missing |
| Immobiliare.it | Verificatore di URL noti e trigger exit; sold/under-offer/date/prezzi | Esempi reali Crocifisso e Silvio Pellico via indice; HTTP 403; selettori live da certificare | Off; nessun inventory generalizzato |
| Casa.it | Verificatore PDP/date modified/price/agency | Fixture HTML V2 esistente; HTTP live 403 | Off; nessun nuovo inventory generalizzato |
| Agency websites | Adapter V2 esistenti preservati; matrice A/B/C/D nell'audit | Nessun nuovo inventory A/B mancante certificato | Nessun adapter duplicato |
| Idealista | Contratto/verificatore conservativo sperimentale | DOM sintetico; nessuna fixture live certificata | Off; nessun missing |
| Search/index | Import selettivo evidence-oriented | Fatti da retrieval pubblici; confidence inferiore | Off; niente scraping generalizzato |

## Manual validation sample

Questo è un **piccolo controllo tecnico di retrieval**, non il confronto umano richiesto su 30–50 property. `tests/fixtures/property-lifecycle/external/real-retrieval-facts.json` contiene fatti estratti e dichiara INDEX_CAPTURE; non è un file HTML live. `access-audit.json` conserva metadati di richieste HTTP reali, senza token challenge. I contratti DOM sintetici sono dichiarati nei test. Nessuna fixture è importata in produzione.

| Fonte / ID | Agency / zona | Prova recuperata | Limite |
|---|---|---|---|
| [Wikicasa 29812570](https://www.wikicasa.it/annuncio/29812570) | RE/MAX Stella Polare 2, Via Crocifisso 52 | 5/05/2026; asking 195k, precedente 225k; rif. 41091011-176 | Copia indicizzata, data ribasso assente |
| [Immobiliare 128823342](https://www.immobiliare.it/annunci/128823342/) | Via Crocifisso 52, stesso riferimento | Asking 155k, precedente 195k; modified 22/09/2026 | Modified non dimostra la data del ribasso; agency non inventata nella fixture |
| [RE/MAX branch](https://stella-polare.remax.it/vendita-casa-indipendente/bitonto/centro-41091011-176) | Crocifisso 52 | 155k e ultimo aggiornamento 22/09/2026 | Retrieval indice; non nuovo adapter certificato |
| [Wikicasa 30533235](https://www.wikicasa.it/annuncio/30533235) | Ad Maiora, Via Vitale Giordano | 25/07/2026; 175k; 140 mq | HTTP 403; successivo web open 410; non prova presenza attuale |
| [Wikicasa 30644308](https://www.wikicasa.it/annuncio/30644308) | Studi Santi, Mariotto / Via Leopardi | 12/08/2026; 75k; 93 mq | Retrieval indice |
| [Wikicasa 28897794](https://www.wikicasa.it/annuncio/28897794) | Studi Santi, Mariotto / Via Bonasia | 29/01/2026; 80k precedente 100k | Nessuna data del ribasso |
| [Wikicasa 30171085](https://www.wikicasa.it/annuncio/30171085) | Tecnocasa Bitonto Matteotti | 13/06/2026; 159k; 113 mq | Ruolo OUR solo dopo mapping configurato e confermato |
| [Immobiliare 117666673](https://www.immobiliare.it/annunci/117666673/) | BENVENUTA Casa, Silvio Pellico 6 | Venduto il 12/02/2025 | Retrieval indice; non conferma live corrente |
| [Wikicasa 30814521](https://www.wikicasa.it/annuncio/30814521) | Modugno, Gabetti citata nel testo | 12/09/2026; 115k | Controllo OUT_OF_SCOPE; non spacciare questa pagina per Gabetti Bitonto |

RE/MAX, Studi Santi, Ad Maiora e Tecnocasa hanno esempi in scope; **Gabetti Bitonto resta senza fixture in scope certificata**. Il recupero del caso Crocifisso dimostra i prezzi dichiarati e la data di pubblicazione, non date esatte di tutte le variazioni. Il nodo responsabile Nicola Sicolo è esposto dalla vecchia pagina RE/MAX recuperata nell'audit; non è dedotto dal brand e non è stato importato come agente corrente.

## Test results

- Unit TS: **380 passati / 43 file** (58 nuovi casi fonte/contratto/policy/resolver, oltre alle regressioni precedenti).
- Integration: **96 passati, 25 skipped / 7 file passati, 2 skipped**. Dentro questi: **82 test SQL PostgreSQL/PGlite** sulle migration effettive (50 Phase 1 + 32 Phase 2), inclusi ACL, lease fonte, missing vietato, ownership del crawler primario, agency propria e Acquisition OS idempotente. Le suite che richiedono Supabase/Docker non disponibile restano skipped.
- Browser locale read-only: **20 scenari**, 390 / 1024 / 1600 px, viste Intelligence e property, filtri, paging delle prove, provenance di età/prezzo, metriche agenzia e salute delle fonti. Fixture isolata dal database e cache separata per ambiente; nessuna validazione production.
- E2E generale: **1 passato / 7 skipped**; non confonderlo con le 20 regressioni UI effettivamente eseguite.
- Typecheck, lint, build Next.js e design:check: eseguiti con esito positivo. CLI historical import verificata in dry-run, senza scritture.
- PGlite esegue PostgreSQL reale locale in WASM; setup dei ruoli/auth e digest emula il contesto minimo Supabase. Non certifica rete, cron o autorizzazioni dell'ambiente target.

## False positive risks / unknowns

1. HTML live, paginazione e inventory complete Wikicasa ancora da validare. Gate incompleto = nessun missing; non rilassare selettori per ottenere numeri.
2. Un indice può mostrare copie vecchie: Crocifisso 195k vs 155k è un caso concreto. Non prova stato o prezzo attuale; confidence ridotta.
3. Registry, branch Tecnocasa della nostra struttura, RE/MAX/Gabetti e matching di 30–50 case richiedono conferma umana. Un nome ambiguo va in review.
4. Date di ribasso, tempi di incarico e prezzi di compravendita non esposti restano sconosciuti. Asking finale non è sold price.
5. Idealista non ha accesso/markup live certificati. Le agenzie mancanti non hanno ancora inventory A/B verificate.
6. Applicazione 0022–0025 e smoke SQL sul target verificati. Primo run con nuovo runtime, scheduler online e deploy web/runtime restano da eseguire.
7. Spegnere `enabled` ferma nuovi job; un job in corso ricontrolla i flag ogni 30 secondi fra le richieste e ogni scrittura è comunque protetta in DB. Una richiesta già partita può terminare. Le prove già accettate restano conservate. `projections_enabled` è un gate di rollout: dopo l'attivazione non usarlo come rollback semantico, perché read model e proiezioni materializzate richiedono una revisione coordinata. Per correggere esiti accettati usare override/evidence correttive o procedura dedicata. Riaccensione delle projections forza un nuovo detail mediante il marker della publication.

## Performance

Job serializzati per fonte usando il lease della queue esistente; nessuna nuova queue. Max 100 pagine, 5 MB/detail; requests HTTP sequenziali. FAST salta detail con marker invariato; fetch su publication nuova, marker cambiato, stato non attivo, flag interpretation cambiato, DEEP o rotazione settimanale. Marker non affidabile = detail necessario. Media/hash solo in DEEP, con pipeline V2. Health baselines riutilizzate, indice parziale sulle nuove evidence e indice latest-run; nessuna riscrittura/compattazione retroattiva.

## Data backfill

**Nessun backfill di dati commerciali.** Le nuove colonne nullable non inventano date; agenzie UNKNOWN e fonti off. Il read model rilegge le prove V2 esistenti con le nuove regole. Non cancella né compatta snapshot, non migra il legacy, non duplica CRM e non tocca SISTER/Tecnocloud.

## Deployment / rollout

Applicazione eseguita tramite Supabase CLI sul progetto collegato `eqqmglsxwbsihrlecnun`, dopo verifica che CLI e connettore puntassero allo stesso target e dry-run limitato alle quattro migration. History completa 0001–0025; secondo dry-run senza migration pendenti. Nessuna seed o configurazione ruoli globale applicata. Al controllo successivo: 666 property, 666 rapporti agency, 666 publication, 66.801 snapshot e 153.578 evidence; database 600 MB, nessun sync RUNNING. Questi sono conteggi post-applicazione, non un confronto prima/dopo.

Smoke di sola lettura riuscito: vista Intelligence su 666 property, vista metriche agency e hydration di una property. ACL verificate: RPC di scrittura riservate a service_role; hydration disponibile ad authenticated, nessuna delle RPC controllate eseguibile da anon. Tutte e cinque le fonti hanno `enabled=false`, `projections_enabled=false`, `missing_enabled=false`. Nessuna osservazione/import commerciale o rivalutazione massiva eseguita.

1. **Completato:** applicazione e verifica sul target di 0022 e 0023.
2. Consegnare Phase 1 web + lifecycle runtime, fare smoke e monitorare i primi run sani delle fonti esistenti.
3. **Schema completato:** applicate 0024 e 0025, verificate ACL/viste SQL. Restano smoke PostgREST e consegna web/lifecycle runtime Phase 2. Le migration Phase 2 sono state anticipate, mantenendo tutte le fonti spente; l'attivazione resta successiva ai controlli Phase 1. Nessun aggiornamento del desktop SISTER è richiesto.
4. Confermare registry e OUR_AGENCY. Solo dopo audit HTTP/HTML live affidabile abilitare Wikicasa `enabled=true`, `projections_enabled=false`. Missing resta vietato.
5. Scheduler verification: SYNC_ALL/DEEP_SYNC_ALL accodano la fonte una volta; controllare lease, retry, 429/403, conteggi, fingerprint, baseline, delta e numero di detail. Fonte spenta: nessun fetch.
6. Confronto umano su almeno 30–50 property: match/civico, agency, prezzo, published claim, duplicati e campioni negativi. Nessun flag projections fino all'accettazione del campione.
7. Abilitare projections Wikicasa, nuovo DEEP/detail e smoke su timeline/score/lead. Monitorare primi run e conflitti.
8. Certificare e abilitare Immobiliare come verifier/cross-check; poi Casa, siti agency A/B realmente verificati, Idealista e import storici selettivi.

Esempio di **configurazione operatore dopo la validazione**: una riga `market_observer_sources` per portale, con flag separati. Le migration sono applicate online; nessun flag è stato acceso e nessun deploy web/runtime è stato eseguito.

## Files changed — Phase 2

- Migrations: `0024_external_market_evidence.sql`, `0025_external_market_projections.sql`.
- Runtime: `src/lib/property-lifecycle/external/{policy,http,adapters,identity,runtime}.ts`, `jobs/{queue,worker}.ts`, metodo resolver esterno in `persistence/repository.ts`, famiglia terratetto in `identity/scoring.ts`.
- Read/UI: `read-models/{external,intelligence,presentation,repository,server,types}.ts`, `src/components/casa/riga-di-vita.tsx`, `app/(private)/intelligence/page.tsx`, `app/(private)/fonti/page.tsx`. La stessa scheda casa usa la hydration arricchita; nessuna nuova pagina concorrente.
- Test/fixture: `external-market-evidence.test.ts`, `external-market-migration.test.ts`, suite SQL Phase 1 eseguita anche con 0024/0025, regression presentation, `external/{real-retrieval-facts,access-audit}.json`, fixture/check UI e script historical import.
- Docs: questo report, source audit, nota onboarding. Modifiche Phase 1 già nel workspace preservate.
