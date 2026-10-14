# Market Observer: completamento della correttezza semantica

Data: 14 ottobre 2026. Base: `57b0581`. Ambito: Property Lifecycle V2, web e runtime Lifecycle. Migration 0022–0023 applicate sul target online alle 23:50 CEST, su richiesta esplicita, insieme a 0024–0025. Web e runtime aggiornati non ancora distribuiti. Nessun intervento sul desktop SISTER/Tecnocloud o sul legacy.

## Migrazioni

0014–0021 sono già condivise e applicate online: non sono modificate né riutilizzate per questa consegna.

- **0022_market_observer_semantics.sql** completa le RPC esistenti: inventario concluso prima del missing, chiavi osservate persistite, protezione dalle letture tardive, rilanci con precedente cessato e intervallo minimo, rientri con memoria del precedente episodio, classificazione del rapporto con versione/prove/motivi, vendita aggregata e aggiornamento idempotente dei segnali commerciali.
- **0023_market_observer_projections.sql** aggiorna le viste esistenti e aggiunge una proiezione dei prezzi per rapporto agenzia. Selezione deterministica della pubblicazione, discordanza prezzi esplicita, data vendita dichiarata distinta da data osservazione, DOM e anzianità pubblica separati. Non crea un secondo archivio.

Le definizioni delle RPC sostituiscono quelle precedenti con la stessa firma e conservano permessi e atomicità. Nessuna cancellazione, compattazione o riscrittura delle osservazioni storiche in queste migrazioni.

## Prima / dopo

| Area | Lacuna residua prima | Comportamento dopo |
|---|---|---|
| Snapshot | Fast path affidato al solo hash; nuovo segnale grafico poteva essere ignorato | Controllo anche su prezzo/stato e nuova prova grafica; versione invariata riutilizzata, presenza registrata nella ricevuta |
| Missing | Applicato con run ancora RUNNING | Solo SUCCEEDED, concluso, sano, completo, baseline pronta e chiavi coerenti con l'inventario salvato |
| Ordine | Una lettura tardiva poteva retrocedere presenza/prezzo | Dettaglio anteriore a last_seen respinto; inventario anteriore alla presenza o a un run più recente non applica assenze |
| Grace | Parametri con fallback sparsi | Policy in market_observer_config; override agency.settings validati e limitati |
| Post-exit | Fine scansione oltre la scadenza poteva sembrare una nuova osservazione | Scansione iniziata dopo la scadenza, chiavi realmente salvate e assenza per ogni pubblicazione; alternativa: rimozione esplicita nuova e affidabile |
| Pubblicazioni parallele | Un nuovo ID sul medesimo host era sufficiente per un rilancio | Una pubblicazione ancora attiva/pending/venduta impedisce di dedurre un nuovo ciclo |
| Rientri | Contatore non completo; chiusura poteva essere azzerata senza memoria esplicita | Rientri reali contati una volta, eventi immutabili con precedente stato, chiusura, esito e data |
| Vendita | Grafica riconosciuta nel deep non sempre partecipava all'aggregazione | Prove della versione corrente aggregate; conflitti e prove deboli restano probabili e verificabili |
| Prezzi | La fonte elaborata più tardi poteva diventare arbitrariamente rappresentativa | Fonte attiva, preferenza per host del catalogo agenzia, recenza e identità stabile; divergenze riducono la confidence |
| Date | sold_at era osservazione del segnale | sold_at solo da claim publication.soldAt esplicito, valido e affidabile; sold_observed_at conserva separatamente il momento della prova |
| Scoring | Base già centralizzata nella 0015 | Conservata versione 2 e pesi configurabili; regressione specifica sul vecchio rapporto chiuso mentre uno nuovo è attivo |
| Acquisition OS | Il replay restituiva il lead senza aggiornare il segnale | Aggiorna score, prove, motivi e agenzia senza duplicare lead/attività o cambiare prossima azione umana |
| UI | Filtri limitati e storico troncato | Agenzia, località, zona dichiarata, stato, anzianità, score, ribasso ed esito; pagine di eventi/prove accessibili dalla stessa scheda |

## Regole di classificazione

La proiezione di `agency_listings` conserva `market_exit_classification`, confidence, evidence IDs, data della classificazione, versione **3**, motivi e provenance delle pubblicazioni e dei run di assenza. La data della classificazione non avanza per una semplice osservazione invariata. Non viene creata una seconda timeline.

Gli override umani del rapporto e della classificazione prevalgono; il motore vendita della proprietà conserva la priorità dei suoi override. Una vendita esplicita forte senza contraddizioni è confermata; contraddizioni o prove deboli sono probabili. Una pubblicazione attiva impedisce di concludere l'uscita dell'intero rapporto. Una semplice assenza non cancella una prova di vendita. Trattativa, ritiro, cambio agenzia, ripubblicazione e uscita sconosciuta restano distinti. `EXPIRED_POSSIBLE` è disponibile per una decisione esplicita; nessuna anzianità produce automaticamente una scadenza.

Rilancio: precedenti pubblicazioni cessate, nessuna ancora attiva/pending/venduta e intervallo minimo configurato. Lo stesso ID può rientrare e generare un nuovo evento; una breve assenza pending genera una ricomparsa, non un rilancio. Il ritorno dopo cambio agenzia registra il precedente episodio prima di riaprire lo stato corrente.

Policy iniziale: 2 scansioni sane, grace 24 ore, controllo post-uscita 48 ore, separazione minima rilancio 1 ora. Le policy di tempo sono limitate a 1–168 ore. Il numero minimo di scansioni non può scendere sotto 2. I pesi dello score restano quelli già pubblicati, configurabili nel database.

## Date, prezzi e UI

Il contratto V2 ammette `source.soldAt` e `location.zoneName` quando dichiarati dalla fonte. Una data vendita futura o non valida non viene accettata. Nessun adapter nuovo viene aggiunto. `estimated_acquisition_at` resta vuoto senza evidenza pertinente; timestamp tecnici e date media non diventano data incarico.

Il prezzo iniziale viene dalla prima versione valida della singola pubblicazione, anche senza ribassi. `earliest_known_asking` può usare un claim di prezzo storico esplicito con data valida antecedente alla prima osservazione. Prezzi diversi contemporanei non creano eventi di ribasso. Aggregazione prezzi: confidence 1 senza divergenze osservate, 0,65 con valori discordanti; l'URL della pubblicazione rappresentativa resta disponibile. Questo non certifica il prezzo di compravendita.

La UI distingue «Monitorato da …» e «Sul mercato da almeno …». La scheda mostra prima osservazione, date portale e ultima presenza; la data dichiarata di vendita e quella del segnale osservato hanno diciture distinte. Eventi derivati dal sistema non sono etichettati come affermazioni della fonte. «Pubblicazione non più rilevata» non significa uscita dell'immobile dal mercato.

Lo storico è paginato per eventi e prove; le pagine precedenti restano raggiungibili nella stessa scheda. Prezzi per pubblicazione non vengono ricostruiti dalla pagina corrente degli eventi. Il filtro zona usa esclusivamente una zona dichiarata già presente nei dati, non una posizione inventata. Le quattro viste Intelligence usano lo stesso archivio V2.

## Caller e codice obsoleto

| Elemento | Classe / riscontro |
|---|---|
| persistObservation, finalizeSyncRun, applyMissingObservations, runPostExitCheck | ACTIVE: orchestratore Lifecycle |
| refreshPropertyIntelligence | ACTIVE: RPC SQL, ponte privati e decisioni manuali |
| authoritativeManualValue / authoritativePrivatePublicationState / recordManualOverride | OVERRIDE_SUPPORT: conservati |
| vecchi upsertLocation, upsertBuilding, createProperty, updatePropertyObservation, recordSnapshotAndEvidence, recordAssetFingerprints, updateSaleFromObservation nel repository | Le definizioni segnalate dall'audit iniziale non sono più nel repository corrente; nessuna rimozione ulteriore |
| omonimi upsertLocation/createProperty nel ponte privati e upsertBuilding nell'importer edilizio | ACTIVE: caller presenti, conservati |
| src/lib/scrapers/providers e ponte legacy | LEGACY_UNUSED rispetto al nuovo motore, ma ancora usati dalla compatibilità: nessuna estensione o eliminazione |

## Data backfill

**Nessun backfill eseguito**, né locale sui dati utente né online. Nessuna data storica inventata. Le colonne derivate della classificazione sono alimentate dalle prossime osservazioni/rivalutazioni; le viste hanno fallback conservativi per le righe precedenti. Un ricalcolo esplicito può utilizzare `scripts/market-observer-backfill.ts`, con default dry-run e batch da 100. Ricalcola dati derivati, non modifica osservazioni originali. Può aggiungere eventi di rivalutazione: eseguire prima in DEV/STAGING autorizzato e verificare gli override.

## Verifiche e limiti

TEST RESULTS:

- Unit: **321 passati**, 42 file.
- Integration: **64 passati, 25 saltati**, 6 file passati e 2 non configurati. La suite Market Observer esegue **50 casi** sulle RPC reali con la catena di migrazioni fino a 0023.
- Typecheck, lint, build Next: passati. La build finale include anche il controllo TypeScript.
- Design: token allineati e contrasto verificato nei due temi.
- Browser locale: **17 scenari passati**, comprese le quattro viste e il dettaglio a 390/1024/1600 px, invio/azzeramento filtri e accesso alle prove storiche dopo la prima pagina. Nessun overflow orizzontale o errore JavaScript. I controlli hanno anche rilevato e corretto il nome accessibile del filtro agenzia.
- E2E generale: **1 passato, 7 saltati**, per assenza della configurazione dei percorsi Supabase integrati.
- `git diff --check`: passato. Nessuna modifica alle migrazioni condivise 0001–0021, al desktop o ai provider legacy.

Le regressioni eseguono schema e RPC reali su PostgreSQL embedded PGlite, con ruoli locali e senza credenziali production. Coprono i 22 casi richiesti e casi aggiuntivi di replay, letture tardive, inventario manomesso/incompleto, fonte prezzo deterministica, data vendita esplicita e nuovo segnale grafico. I nuovi campi opzionali vuoti non modificano l'hash di una pubblicazione solo per il passaggio al nuovo contratto.

Il browser usa un endpoint sintetico di sola lettura. Non prova il funzionamento live dei portali, i permessi RLS/PostgREST completi o le scritture commerciali autenticata online. Le suite Supabase integrate non configurate sono dichiarate saltate. Il costo delle proiezioni aggiuntive deve essere misurato sul dataset reale nell'ambiente autorizzato prima del rilascio.

Resta da valutare la qualità dei rilanci e delle classificazioni registrati prima della correzione: lo storico originale è conservato, non viene riscritto automaticamente come se le regole nuove fossero sempre esistite. Nessuna conferma completa delle dieci fonti viene dedotta dal collaudo sintetico.

## Files changed

- Database: le sole nuove `supabase/migrations/0022_market_observer_semantics.sql` e `0023_market_observer_projections.sql`.
- Runtime: `src/lib/property-lifecycle/contracts/normalized-listing.ts`, `sync/engine.ts`, `persistence/repository.ts`.
- Letture: `src/lib/property-lifecycle/read-models/{intelligence,presentation,repository,server,types}.ts`.
- UI: `app/(private)/intelligence/page.tsx`, `app/(private)/casa/[id]/{page,mercato}.tsx`, `src/components/casa/riga-di-vita.tsx`.
- Test: `tests/integration/market-observer-migration.test.ts`, `tests/property-lifecycle/geography-decision.test.ts`, `tests/property-lifecycle/market-observer-presentation.test.ts`, `scripts/{market-observer-ui-fixture,check-market-observer-ui}.mjs`.
- Documentazione: questo rapporto e `docs/PROJECT-ONBOARDING.md`.

## Deployment order

1. Backup verificato e termine dei job Lifecycle; controllare ambiente e history. Non riapplicare 0014–0021.
2. Applicare **0022**, poi **0023**, inizialmente su locale o DEV/STAGING autorizzato. Nessuna nuova variabile ambiente.
3. Eventuale ricalcolo derivato, prima in dry-run, con confronto delle prove e degli override.
4. Pubblicare web e runtime Lifecycle insieme, poiché il runtime salva le nuove chiavi inventario. Il vecchio runtime con schema nuovo congela prudenzialmente le assenze.
5. Verificare scheduler esistente, senza aggiungerne un secondo.
6. Smoke test autenticato: filtri, storico, segnale invariato senza nuova versione, ribasso reale, pubblicazione parallela, post-exit senza fetch, link Acquisition ripetuto.
7. Monitorare i primi run e misurare costi query. Studi Santi e baseline PuntoCasa/Momento restano limiti delle fonti. Nessuna release del desktop SISTER/Tecnocloud.

## Next phase: External Market Evidence

Proposta soltanto, non implementata: Wikicasa, Immobiliare.it, Casa.it, siti agenzia mancanti, Idealista, search/index evidence, in quest'ordine. Ogni ingresso deve portare identità, URL, data dichiarata, stato, prezzo e provenance nel contratto V2. Prima verificatori mirati e collaudi per fonte, poi eventuale copertura più ampia approvata. Obiettivi: prima evidenza pubblica, storico prezzi, prove di vendita e intelligence agenzia. Il verificatore delle uscite note su Immobiliare.it appartiene a questa fase; non è incluso nella consegna corrente.
