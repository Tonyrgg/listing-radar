# Operational rollout e verifica del mercato, 19 ottobre 2026

## Release status

Target: eqqmglsxwbsihrlecnun. Web: https://listing-radar-mu.vercel.app . Release funzionale 6768fe4 (precedenti 2212ef0 e 38c7568). Migrations 0022–0026 confermate; nuove 0028–0033 applicate, 0027 condivisa invariata. Nessuna modifica al desktop SISTER/Tecnocloud.

Il campione è congelato al 2026-10-19T17:33:32.122Z: 50 property su un catalogo di 667 in quel momento. Il normale scheduler continua a osservare nuovi annunci; il numero live può crescere. I file di verifica sono report locali, non un nuovo archivio del prodotto.

Ultimo conteggio production (2026-10-19T17:49:44.552Z): **673 property**. Primo giro GitHub completato il 19 ottobre alle 19:47 CEST (17:47 UTC), **12 job, 0 errori di coda, 8 agenzie sane su 10**. Studi Santi e Studio Casa sono FAILED senza missing. Rimane un solo post-exit in RETRY, attempts 0, waitingForEvidence=true.

| Elemento | Stato |
| --- | --- |
| DB / RPC / schema cache | History allineata, RPC e viste chiamate tramite PostgREST |
| Web | Deploy production riuscito, smoke autenticato eseguito |
| Lifecycle runtime | Scheduler GitHub riattivato; primo giro osservato, stato dettagliato sotto |
| RE/MAX | Known publication verifier ON, projections ON, missing OFF; inventario vuoto |
| Altre fonti Phase 2 | Live OFF; capture storiche conservate come evidence |
| Registry | 12 agenzie: 11 competitor, 1 OUR_AGENCY specifica confermata dall’utente |
| Acquisition OS | Replay reale idempotente, campi umani preservati |


## Phase 1 smoke

| Controllo reale | Esito |
| --- | --- |
| unchanged | PASS |
| closeHealthyAbsences | PASS |
| failedSource | PASS |
| postExit | PASS |
| realSamePublicationPriceChange | PASS_HISTORICAL_REAL_OBSERVATIONS |
| acquisition | PASS |
| parallelPublication | NOT_AVAILABLE_IN_LIVE_SAMPLE |


Tre scansioni Momento: 6 ricevute riusano le stesse 2 snapshot; last_seen avanza. Due publication assenti arrivano a 2 assenze sane ma restano MISSING_PENDING entro il grace period. Il fetch Studi Santi fallisce (403): nessuna variazione delle publication né missing. Il post-exit arretrato resta in attesa di nuove prove sane e non consuma tentativi. Il price change è verificato nello storico di osservazioni reali della stessa publication, senza modificare prezzi in production. Non è stato costruito un falso caso live multi-publication: le relative regressioni PostgreSQL coprono parallela ≠ relisting e active + missing.

## Fix necessari

- **0031** ripristina le letture fingerprint circoscritte alla snapshot, già introdotte in 0018 e perse quando 0022 ha sostituito la RPC. Prima: due timeout production da circa 8–9 secondi sul cambio di versione Crocifisso. Dopo: run sani completati in circa 1,4–1,9 secondi, replay invariato senza nuove snapshot. Il nuovo test fallisce realmente senza fix e passa con fix; nessuna compattazione/cancellazione.
- **0028–0030** configurano registry e rollout RE/MAX in due stadi: prima osservazione, poi interpretazione dopo un run sano. Il provider ID RE/MAX è condiviso da due filiali: mapping solo sul nome completo della sede.
- **0032** conserva 13 claim storici già presenti nelle fixture (Wikicasa 4, Immobiliare 3, RE/MAX 6). Collegamento alla property, publication_id NULL per non contaminare la serie prezzi RE/MAX; origine, timestamp originale, metodo e hash dell’artifact conservati. I flag live dei portali sono ripristinati nella stessa transazione.
- **0033** registra la conferma umana della specifica sede Tecnocasa, confidence 1, senza classificare il marchio intero come OUR_AGENCY.
- Scheduler: accoda soltanto publication RE/MAX già persistite, con intervallo minimo centralizzato di 24 ore, paginazione per ID e dedupe dei job attivi. Verifica production del selettore: 0 job perché la publication era appena stata verificata. Nessun crawling di inventario.
- UI Venduti: “Ultimo prezzo richiesto” e distinzione esplicita dal prezzo di vendita.

## Golden case Crocifisso

[Scheda production](https://listing-radar-mu.vercel.app/casa/53390232-8a25-446e-b832-4841f513e877). Property creata una sola volta dopo autorizzazione esplicita e resolver V2 su 666 candidati, nessuna corrispondenza plausibile.

| Campo | Risultato reale |
| --- | --- |
| Agenzia | RE/MAX Stella Polare — Bari Via Caduti del Lavoro |
| Agente dichiarato | Nicola Sicolo |
| Asking corrente | 155.000 € |
| Prima osservazione V2 | 2026-10-19T17:15:31.017+00:00 |
| Publication claim RE/MAX | 2026-05-05T00:00:00+00:00 |
| Prima evidenza pubblica | 2026-05-05T00:00:00+00:00 |
| Età pubblica | 167+ giorni |
| Modified attuale RE/MAX | 2026-10-17T00:00:00+00:00 |
| Modified nella capture RE/MAX precedente | 22/09/2026, conservato come claim storico |
| Acquisition date | UNKNOWN |
| Stato | ACTIVE |
| Acquisition Opportunity Score | 25 /100; {"observed_age":25} |
| Ribassi osservati stessa publication | 0 |
| Relisting | 0 |
| Snapshot | 2 (observation-only e successiva interpretazione) |
| Evidence | 25 di cui 13 capture storiche |


Wikicasa: asking 195.000 / precedente 225.000, capture indicizzata del 14/10, confidence massima 0,65. Immobiliare: asking 155.000 / precedente 195.000, modifica dichiarata 22/09. Questi claim non dimostrano date esatte dei ribassi né presenza corrente. La versione live RE/MAX dichiara ora modifica 17/10: non è stato forzato il vecchio valore 22/09. Nessun PRICE_DROP o RELISTED generato da questi prezzi cross-source. Initial asking osservato V2 e current asking sono entrambi 155.000; i prezzi storici deboli restano consultabili nelle prove e non gonfiano lo score.

## RE/MAX live verifier

9 URL noti, 8 HTTP 200 e parse riusciti (88,9% accesso sul campione), 1 redirect 308 in REVIEW. Estrazione prezzo, datePosted e agente: 8/8 risposte utilizzabili; è copertura tecnica, non precisione umana certificata. 7 dichiarano filiale Caduti del Lavoro e Nicola Sicolo; 1 dichiara Camillo Rosalba e Giammarco Patimo. Quest’ultimo non è attribuito a Caduti/Nicola. Una sola publication RE/MAX è in produzione; le altre non generano nuove property automaticamente.

| Riferimento | HTTP/parse | Asking | datePosted | Agenzia/agente | Resolution |
| --- | --- | --- | --- | --- | --- |
| 41091011-176 | 200 / OK | 155.000 € | 2026-05-05T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | AUTO_MATCH |
| 41091011-172 | 200 / OK | 40.000 € | 2026-04-13T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | NEW_PROPERTY |
| 41091011-200 | 200 / OK | 225.000 € | 2026-10-01T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | NEW_PROPERTY |
| 41091011-199 | 200 / OK | 213.000 € | 2026-10-05T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | NEW_PROPERTY |
| 41091011-117 | 200 / OK | 263.900 € | 2025-08-04T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | REVIEW_REQUIRED |
| 41091011-181 | 200 / OK | 395.000 € | 2026-05-23T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | NEW_PROPERTY |
| 41091011-178 | 200 / OK | 103.000 € | 2026-05-09T00:00:00.000Z | REMAX Stella Polare - Bari Via Caduti del Lavoro / Nicola Sicolo | NEW_PROPERTY |
| 41091011-191 | 308 / REVIEW | UNKNOWN | UNKNOWN | UNKNOWN | HTTP_REVIEW |
| 21260228-77 | 200 / OK | 600.000 € | 2026-07-03T00:00:00.000Z | REMAX Stella Polare - Bari Via Camillo Rosalba / Giammarco Patimo | AGENCY_BRANCH_REVIEW |


Il rif. 41091011-117 ha un candidato V2 con score 0,7142, in review IDENTITY nel prodotto; nessun merge. Cinque altri casi produrrebbero NEW_PROPERTY e sono trattenuti fuori dall’ingestion, rispettando l’autorizzazione a una sola nuova scheda RE/MAX. Il read model agent portfolio contiene solo evidence esplicite della singola publication (attualmente Nicola, 1 scheda); nessuna statistica definitiva.

## 50 property: matching e data quality

| Agenzia | Property nel campione |
| --- | --- |
| RE/MAX Stella Polare — Bari Via Caduti del Lavoro | 1 |
| Studi Santi Immobiliare | 15 |
| Ad Maiora Immobiliare | 7 |
| Futura Immobiliare Bitonto | 4 |
| Iconacasa Bitonto — Piazza Aldo Moro | 6 |
| PuntoCasa Bitonto | 13 |
| Vistocasa Bitonto | 2 |
| Garofalo Immobiliare | 2 |


Distribuzione richiesta non disponibile: nostra Tecnocasa 0 e RE/MAX 1 nel catalogo V2. Non sono state create property per riempire artificialmente il campione.

**Ground truth umana indipendente: 0/50. Tutte le 50 schede sono REVIEW.** Gli expected sono intenzionalmente NULL, i detected sono separati. Precision di identity/agency/address/price/date, false merge/split, relisting e sold rimangono NULL, non 0% e non 100%. Nessun target 95/98% è certificato. La conferma umana della registry non equivale alla revisione delle 50 property.

Provenance strutturale dei riferimenti usati negli score: **1422/1422 (100%)**, con URL HTTPS, metodo, osservazione e confidence. Questo controlla tracciabilità e integrità dei riferimenti, non la verità dei claim o la completezza semantica dello score.

Il verificatore HTTP conservativo ha ottenuto 3 risposte 200 nel campione, una sola con testo primario utilizzabile e 2 body senza dettaglio leggibile. 49 casi richiedono ulteriore verifica. Il gate su contenuti può segnalare challenge anche in pagine con widget captcha non bloccanti: non è una misura del numero di portali realmente inaccessibili. Controllo browser indipendente su Iconacasa 42658: pagina “Immobile non trovato”, nessun segnale di vendita. Nessun bypass eseguito.

| Limite della verifica HTTP | Casi |
| --- | --- |
| PRIMARY_TEXT_AVAILABLE | 1 |
| ACCESS_OR_CONSERVATIVE_CONTENT_GATE | 38 |
| URL_NOT_AVAILABLE | 2 |
| REDIRECT_REQUIRES_REVIEW | 7 |
| JAVASCRIPT_OR_EMPTY_BODY | 2 |


Non ci sono FAIL umani da aggregare per address ambiguity/civic missing/etc.: questa è una classificazione dei limiti di accesso, non una frequenza degli errori del matching. Il caso RE/MAX da rivedere mostra indirizzo parziale e mq simili; il ramo ufficio mostra agency branch ambiguity.

## Failed Listing e score calibration

Top 20 congelati disponibili, 0 giudizi umani indipendenti. L’uscita senza vendita pesa 85 prima del cap a 100; diverse righe restano alte pur con zero ribassi. Il valore commerciale non è ancora validato e i pesi non vengono dichiarati calibrati. I dettagli e tutte le componenti sono nel pacchetto locale.

20 candidati esplorativi senza sold forte nel campione: 6 con almeno 120 giorni noti, 1 con ribassi, **0 con entrambi**. Non esistono quindi 10 casi che soddisfino tutti i criteri nel campione; non vengono inventati. HIGH/MEDIUM/LOW/FALSE POSITIVE rimangono da assegnare umanamente.

Ricerca anche sull’intero database live: **28 candidati esplorativi, 0 con stato exit/off-market + almeno 120 giorni + ribassi osservati + nessun sold forte**. Il limite non deriva soltanto dalla selezione delle 50 schede.

## Sold cases

10 casi reali esaminati a livello DB/evidence; tutti hanno status SOLD e claim primario storico “Venduto” del parser dedicato PuntoCasa, con provenienza. sold_at è NULL in tutti i 10: la fonte non fornisce una data di compravendita utilizzabile. Non si sostituisce con sold_observed_at. La verifica indipendente rimane NOT_ENOUGH_EVIDENCE per 10/10; non è una smentita dei claim conservati e non cambia override o classificazioni senza prove contrarie. Last asking non è sold price.

## UI smoke autenticato

/intelligence (Mercato, Opportunità, Usciti, Venduti), /fonti, scheda Crocifisso, timeline, espansione evidence, prezzi per publication, score e /acquisition caricati con sessione utente reale. Provenance visibile: fonte, URL, data dichiarata, observed_at, confidence. Il precedente problema dello strumento Windows è risolto tramite il browser connesso. Nessun login automatizzato o disattivazione dell’autenticazione.

Su Crocifisso l’espansione mostra 21 prove distinte ricavate dai 25 record conservati, compresi Wikicasa 195k/precedente 225k e Immobiliare 155k/precedente 195k, con la dicitura «Data della variazione non dichiarata». Le letture usano una cache di 60 secondi con aggiornamento in background: la prima apertura può servire la versione precedente; il successivo reload ha mostrato tutte le prove nuove. Non è stata disabilitata la cache né dichiarata una lettura istantanea dopo ogni job remoto.

Il tempo di comprensione “meno di 10 secondi” non è stato misurato con un utente: lo smoke dimostra accesso e leggibilità dei contenuti, non una validazione di usabilità quantitativa.

## Test results

- Vitest completo: **514 PASS, 25 SKIP**, 55 file passati e 2 saltati. I test che richiedono Supabase locale non sono stati dichiarati passati né puntati a production.
- PostgreSQL/PGlite: suite migration eseguite, compreso rollout, idempotenza capture e regressione fingerprint. La nuova regressione fallisce senza 0031 e passa con la correzione.
- typecheck web PASS, lint PASS, build Next.js PASS, deploy Vercel PASS. Il typecheck globale monorepo aveva errori precedenti nel confine desktop/test: non viene certificato; la build web usa tsconfig.web.json con controlli strict.
- Smoke remoto del nuovo scheduling: source ON, 0 richieste entro le 24 ore. Non viene simulato il trascorrere di un giorno in production.

## Data backfill

667 proiezioni ricalcolate centralmente, 0 errori, usando soltanto le osservazioni già presenti. Nessun incarico, sold_at o data ribasso inventati. Una sola nuova scheda RE/MAX autorizzata, 13 claim storici append-only, registry operativa e conferma umana della specifica filiale. Le normali scansioni agenzia possono osservare nuovi annunci secondo il flusso V2 esistente.

## Source status

| Fonte | Stato | Limiti |
| --- | --- | --- |
| RE/MAX | PRIMARY LIVE | Solo known URL; missing false; 24h minimo; 1 publication live |
| Wikicasa | EVIDENCE ONLY | Live disabled, capture indicizzate 0,65 |
| Immobiliare.it | EVIDENCE ONLY | Live disabled, nessun sold verifier live certificato |
| Casa.it | DISABLED / NOT READY | Nessuna attivazione Phase 2 |
| Idealista | DISABLED / NOT READY | Nessuna attivazione |
| Search/index | EVIDENCE ONLY | Capture curate esistenti, nessun crawler motori |
| Siti agenzia esistenti | PRIMARY LIVE con health | Solo adapter V2 già operativi; fallimenti non autorizzano missing |


## Production readiness

| Area | Conclusione | Motivo |
| --- | --- | --- |
| Market Observer core | READY WITH LIMITATIONS | Invarianti reali e SQL verificate; alcune fonti restano degradate/non disponibili |
| RE/MAX verifier | READY WITH LIMITATIONS | Known URL funzionante; campione piccolo e matching incerto in review |
| Opportunity ranking | NOT READY per prioritizzazione certificata | 0/20 giudizi commerciali indipendenti; peso uscita dominante |
| Sold Radar | NOT READY per precisione certificata | Vista operativa; 10/10 casi senza conferma indipendente |
| External evidence overall | READY WITH LIMITATIONS | RE/MAX limitato e capture storiche; target sul campione non certificati |


L’esito operativo è un rollout controllato funzionante con limiti misurati. Non è ancora una validazione commerciale completa dei 50 immobili. Per chiudere l’accettazione occorrono expected/reviewer/giudizio umano sulle schede, sui Top 20 e sui 10 venduti; soltanto allora si calcolano le precision e si ricalibra lo score. Nessuna nuova fonte va allargata sulla base delle sole metriche strutturali.

## Deployment e monitoraggio

Ordine eseguito: controllo schema 0022–0026 → web compatibile → smoke core → registry → RE/MAX observation-only → run sano → projection controllata → correzione timeout → replay sano → riattivazione scheduler → scheduling known URL → smoke UI. Flag per fonte reversibili, missing sempre vietato per RE/MAX.

Per sospendere il rollout aggiungere una nuova migration che spenga enabled/projections_enabled di REMAX, mantenendo missing_enabled=false; i job già accodati drenano senza fetch quando la fonte è OFF. Non cancellare evidence o snapshot. Su un ambiente nuovo la migration 0030 rifiuta l’attivazione senza un run verificatore sano: il gate operativo richiede validazione, non va aggirato.

## Runtime osservato

| Agenzia | Stato | Health | Normalizzate | Missing |
| --- | --- | --- | --- | --- |
| Vistocasa Bitonto | SUCCEEDED | HEALTHY | 112 | 0 |
| Trio Casa S.A.S. | SUCCEEDED | HEALTHY | 10 | 0 |
| Studio Casa Bitonto | FAILED | FAILED | 0 | 0 |
| Studi Santi Immobiliare | FAILED | FAILED | 0 | 0 |
| PuntoCasa Bitonto | SUCCEEDED | HEALTHY | 84 | 17 |
| Momento Casa | SUCCEEDED | HEALTHY | 2 | 2 |
| Iconacasa Bitonto — Piazza Aldo Moro | SUCCEEDED | HEALTHY | 107 | 0 |
| Garofalo Immobiliare | SUCCEEDED | HEALTHY | 42 | 2 |
| Futura Immobiliare Bitonto | SUCCEEDED | HEALTHY | 57 | 0 |
| Ad Maiora Immobiliare | SUCCEEDED | HEALTHY | 45 | 1 |


Snapshot runtime salvato nel pacchetto locale; vedere il workflow [39295207828](https://github.com/Tonyrgg/listing-radar/actions/runs/39295207828) per il primo giro completo. Workflow success non significa che tutte le fonti siano sane: contano i singoli sync_runs.

Il primo giro ha eseguito 2212ef0, con tutte le correzioni DB già applicate. Il successivo 6768fe4 aggiunge la selezione periodica degli URL noti, verificata sul target senza accodare fetch inutili: il primo controllo dopo 24 ore deve ancora avvenire. Il deploy web di 6768fe4 è riuscito; il commit successivo di report non cambia il runtime.

## Files changed

- supabase/migrations/0028–0033: registry, rollout e conferma filiale, ripristino letture limitate, capture curate.
- src/lib/property-lifecycle/external/scheduling.ts e policy.ts: selezione dei soli URL noti dovuti.
- scripts/property-lifecycle-remote-worker.ts e .github/workflows/property-lifecycle.yml: collegamento alla coda esistente.
- app/(private)/intelligence/page.tsx: etichetta asking nella vista Venduti.
- tests/integration/external-market-migration.test.ts, market-rollout-migration.test.ts e tests/property-lifecycle/external-scheduling.test.ts: regressioni.
- docs/PROJECT-ONBOARDING.md e questo report.

Nella stessa fase 61af17f ha separato il typecheck web dai test desktop in next.config.ts, tsconfig.web.json e package.json, correggendo un tipo esplicito nel test territorio; nessuna implementazione desktop modificata.
