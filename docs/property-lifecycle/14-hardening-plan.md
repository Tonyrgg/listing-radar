# Piano di hardening di Property Lifecycle Radar V2

Data: 20 agosto 2026  
Branch: `property-lifecycle-v2`  
Baseline: validazione live del 19 agosto 2026, commit `1a50c0a`

## Scopo e criteri

Questo piano riguarda esclusivamente robustezza, correttezza e calibrazione delle funzionalità già presenti. Non introduce nuove feature, non coinvolge Supabase remoto o production e non sostituisce Listing Radar legacy.

Le priorità sono:

- **P0**: rischio di stato persistito incoerente o conclusione lifecycle prematura;
- **P1**: rischio operativo elevato, classificazione non sufficientemente dimostrata o volume di review non sostenibile;
- **P2**: limite reale della fonte o debito circoscritto che non compromette la sicurezza del core.

## P0

### H-01 — Persistenza atomica della observation

- **Causa tecnica:** `persistObservation` esegue scritture PostgREST separate su location, building, PROPERTY, agency listing, publication, snapshot, evidence, fingerprint, eventi, sale intelligence e opportunity. Le chiavi di deduplica limitano alcuni replay, ma non offrono rollback.
- **Rischio:** un errore intermedio può lasciare una publication senza snapshot, un evento senza aggiornamento lifecycle coerente, un price change duplicato al retry o una PROPERTY parzialmente aggiornata.
- **Soluzione:** calcolare in TypeScript il piano deterministico della observation e applicare tutte le mutazioni DB critiche tramite una singola RPC PostgreSQL. La funzione acquisisce un lock logico per agenzia/source key, usa chiavi idempotenti e restituisce gli identificatori committati. Gli upload su Storage, non transazionabili con PostgreSQL, avvengono dopo il commit e sono trattati come enrichment recuperabile.
- **Test necessario:** failure injection dopo publication, dopo snapshot, durante gli eventi e durante l’aggiornamento lifecycle; retry dello stesso payload; concorrenza sullo stesso source key.
- **Criterio di completamento:** a ogni failure iniettata il conteggio e il contenuto di tutte le tabelle critiche restano identici al pre-run, il `sync_run` registra il fallimento e il retry produce esattamente uno snapshot logico e al massimo un evento per dedupe key, senza doppio price change o missing event.

### H-02 — Post-Exit durevole e governato dal dominio

- **Causa tecnica:** `runPostExitCheck` classifica immediatamente il caso e la finestra temporale dipende dal momento in cui un job esterno viene accodato.
- **Rischio:** chiusura prematura come `OFF_MARKET_NO_SALE_EVIDENCE`, perdita del controllo dopo restart del worker e comportamento diverso cambiando orchestratore.
- **Soluzione:** persistere su `agency_listings` fase, tentativi e scadenze (`monitoring_phase`, `post_exit_check_due_at`, `next_check_at`, `check_attempt`, `last_check_at`). La prima rimozione confermata apre il monitor; la classificazione senza evidenza richiede almeno un controllo successivo dovuto. Un’RPC transazionale registra check, stato, evento e nuova pianificazione. Il worker legge il DB e può materializzare job sostituibili.
- **Test necessario:** `EXIT_PENDING` verso secondo healthy absence, `REAPPEARED`, `CLOSED_SOLD`, `CLOSED_SWITCHED`, `CLOSED_TO_PRIVATE` e `OFF_MARKET_NO_SALE_EVIDENCE`, inclusi restart/retry.
- **Criterio di completamento:** nessun esito dipende da memoria volatile o dal solo arrivo anticipato di un job; un job prematuro restituisce `NEEDS_VERIFICATION` e mantiene una scadenza DB; ogni transizione finale è idempotente e auditata.

## P1

### H-03 — Baseline progressiva Adapter Health

- **Causa tecnica:** la classificazione confronta marker, paginazione ed errori del singolo run, senza storia per agenzia.
- **Rischio:** un inventario strutturalmente valido ma troncato può risultare `HEALTHY` e alimentare falsi `MISSING_PENDING`/`REMOVED`.
- **Soluzione:** mantenere conteggi healthy recenti, mediana rolling, variabilità, fingerprint/versione schema e streak healthy/failure. Durante il warm-up usare soglie conservative e vietare absence evaluation finché la baseline non è affidabile. Un calo anomalo o schema drift degrada il run.
- **Test necessario:** primo run, secondo run, stabilizzazione, cali del 20% e 80%, zero inventory, failure consecutive e schema drift.
- **Criterio di completamento:** nessun run di warm-up o anomalo può chiudere publication; la baseline nasce soltanto da run sani reali, espone numerosità e variabilità e si aggiorna progressivamente senza inventare storico.

### H-04 — Candidate retrieval troppo ampio

- **Causa tecnica:** fino a 500 PROPERTY vengono sottoposte allo scoring; molti segnali mancanti vengono rinormalizzati e non esiste blocking confidence-aware sufficiente.
- **Rischio:** 2.179 coppie esplorative e 312 review su 572 publication, costi elevati e operatori esposti a casi non plausibili.
- **Soluzione:** separare retrieval, scoring e decisione. Applicare hard block solo su contraddizioni affidabili (Comune/frazione, tipo incompatibile, superficie fortemente divergente) e soft block quando location o attributi sono incompleti. Conservare motivi di inclusione/esclusione.
- **Test necessario:** appartamenti nello stesso building con mq/piano/prezzo simili ma foto diverse; stessa PROPERTY con nuova agenzia e nuove foto; input incompleti; regressione dei veri SAME.
- **Criterio di completamento:** riduzione misurabile di candidate e review senza perdere alcun SAME verificato nel Golden Dataset; ogni esclusione è spiegabile.

### H-05 — Golden Dataset reale e soglie Identity non calibrate

- **Causa tecnica:** i test sintetici dimostrano il comportamento del codice, non precision/recall sul mercato reale; nessun cross-agency SAME era stato provato con evidenza forte.
- **Rischio:** soglie scelte su intuizione, falsi merge di UNIT nello stesso BUILDING o falsi negativi su relaunch/switch.
- **Soluzione:** creare un dataset versionato con SAME/DIFFERENT verificabili e riferimenti alle evidenze pubbliche conservate; misurare precision, recall, FPR e FNR per retrieval, review e auto-match. L’auto-match cross-agency richiede precisione estremamente alta.
- **Test necessario:** test parametrico su tutto il Golden Dataset, inclusi high-scoring non-match e prove media/floorplan.
- **Criterio di completamento:** metriche riproducibili e soglie motivate; zero falso positivo AUTO_MATCH nel campione; eventuali limiti dovuti alla numerosità sono espliciti.

### H-06 — Review Queue rumorosa

- **Causa tecnica:** la decisione `REVIEW_REQUIRED` viene applicata a candidati deboli o scarsamente informativi e la queue non distingue valore informativo.
- **Rischio:** 312 casi non sostenibili, riduzione della qualità della review e occultamento dei casi davvero ambigui.
- **Soluzione:** migliorare retrieval/scoring; inviare in review solo pubblicazioni con candidato plausibile e sufficiente evidenza. I casi a bassa informazione restano misurati nel Dry Run ma non diventano task operativi.
- **Test necessario:** confronto prima/dopo di candidate, review, auto-match e discarded; audit manuale di un campione degli esclusi.
- **Criterio di completamento:** queue composta soltanto da casi azionabili, senza perdita dei SAME del Golden Dataset e con motivazione esplicita per ogni review.

### H-07 — Quattro adapter ancora PARTIAL

- **Causa tecnica:** Vistocasa non restituisce dati utili dalla POST ASMX osservata; Studio Casa può bloccare l’IP e non espone uno start proprietario; Trio e Momento dipendono da TrovaCasa e hanno soltanto first-seen a bassa confidence.
- **Rischio:** dipendenza da fonti secondarie, affidabilità temporale bassa e degradazione improvvisa non rilevata.
- **Soluzione:** riprovare live i percorsi primari, correggere solo problemi dimostrabili, aggiornare Golden Dataset/regressioni e mantenere confidence conservativa dove la fonte non offre evidenza migliore.
- **Test necessario:** inventory/detail live mirati, replay di payload conservati e verifica di ID, status, asset e start evidence.
- **Criterio di completamento:** ogni adapter raggiunge il massimo livello realmente dimostrabile; un PASS richiede fonte live stabile e campi critici provati. I limiti non risolvibili restano PARTIAL senza inferenze speculative.

## P2

### H-08 — Image/floorplan matching limitato a dHash e classificazione URL

- **Causa tecnica:** assenza di classificatore visuale/embedding; URL anonime possono non essere riconosciute come planimetrie.
- **Rischio:** falsi negativi media e floorplan, ma non falso lifecycle se l’auto-match resta conservativo.
- **Soluzione:** nessuna nuova feature in questo hardening. Mantenere il segnale non decisivo quando non corroborato e documentare la copertura reale.
- **Test necessario:** regressioni sulle trasformazioni reali già raccolte e sui floorplan disponibili.
- **Criterio di completamento:** nessuna promozione a prova forte oltre quanto dimostrato; limite riportato come PARTIAL se il campione resta insufficiente.

### H-09 — Limiti intrinseci delle date di inizio dei publisher

- **Causa tecnica:** Studio Casa, Trio e Momento non espongono un timestamp proprietario dell’inizio commerciale; Vistocasa espone soprattutto evidenza asset/crawler.
- **Rischio:** falsa precisione del true market age.
- **Soluzione:** preservare range, metodo e confidence; non trasformare first-seen o Last-Modified in data contrattuale.
- **Test necessario:** regressione dei metodi per agenzia e verifica che `modified`/Last-Modified non sostituiscano lo start.
- **Criterio di completamento:** ogni data è accompagnata da metodo, confidence e limite; quando non dimostrabile resta `UNKNOWN` o bound conservativo.

## Ordine di esecuzione e gate

1. H-01, H-02 e H-03 devono essere completati prima del Dry Run #2.
2. H-04, H-05 e H-06 vengono calibrati sul dataset live, senza obiettivo artificiale di produrre auto-match.
3. H-07 viene rivalidato live senza promuovere forzatamente gli adapter.
4. H-08 e H-09 non bloccano il core se restano conservativi e dichiarati.
5. Il giudizio `READY FOR STAGING` richiede tutti i P0 chiusi, absence safety dimostrata, quality gate verde e Identity con rischio di falso positivo accettabile sul Golden Dataset reale.
