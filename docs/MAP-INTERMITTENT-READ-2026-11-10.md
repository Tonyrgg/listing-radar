# Mappa dell'archivio intermittente — 10 novembre 2026

## Causa riprodotta

La lettura REST della vista `market_observer_graph_property_archive` per la mappa restituiva HTTP 500 / PostgreSQL `57014`, statement timeout. Le letture semplici rispondevano 200. Non era un problema esclusivo del browser dell'ufficio.

Prima dell'intervento: due richieste complete fallite, circa 13,1 e 10,6 secondi. EXPLAIN ANALYZE ha misurato circa 8,7 secondi di esecuzione SQL: ricerca delle evidenze ripetuta 706 volte, filtrando in media 213 righe storiche per ciascuna pubblicazione; espansione del contesto documentale nella stessa query.

## Correzione distribuita

Migrazione **0064** applicata: due indici parziali per prove di prezzo e identità dell'agente, più indice sull'ID testuale delle strade usato dal grafo. Nessuna modifica ai contenuti, alle classificazioni, alle relazioni o alla quota del piano.

I soli indici hanno migliorato due letture complete a 5,5 e 6,1 secondi, ma una prova simultanea ha ancora riprodotto il timeout. Non sono stati considerati sufficienti.

Il caricatore della mappa ora legge:

- archivio immobili in pagine di 64 elementi;
- conteggi del grafo una sola volta, separatamente;
- riepilogo documentale una sola volta, separatamente.

Ricongiunge per ID, conserva gli stessi campi e riduce gli attributi al necessario. Ogni errore o pagina incompleta interrompe l'intera lettura: nessun archivio parziale o conteggio inventato viene presentato come completo. Una proprietà senza contesto dopo letture concorrenti viene segnalata come lettura incompleta. Cache server di 60 secondi, invalidabile con il tag lifecycle, conservata con chiave aggiornata.

Due caricamenti simultanei a cache vuota hanno restituito **706 immobili ciascuno**, senza timeout, in circa **19,2 secondi complessivi**. Questo è il limite prestazionale ancora visibile a cache vuota, non una promessa di caricamento istantaneo. Non sono stati aumentati i timeout del database.

Confronto live tra la vecchia proiezione completa e il nuovo caricatore: **706 righe contro 706, zero differenze in tutti i campi della mappa**. Sette test dedicati passati; TypeScript e build production passati. Il caricatore web è stato aggiunto ai sorgenti dell'ultima produzione, che includeva già la gestione delle zone, senza distribuire le altre modifiche web locali.

## Quota e Worker

Deploy web production **READY**: `dpl_GWi16YTs7hrBJLYUH6xFX4jkXxQy`, alias `listing-radar-mu.vercel.app`. Gestione zone precedente conservata. Il controllo dei risultati live riguarda le letture Supabase usate dal caricatore; non è una verifica della sessione del browser dell'ufficio.

Dopo gli indici: database **482.749.587 byte**. Indici nuovi: 180.224 byte complessivi. Nessuna copia persistente dell'archivio, cache tabellare aggiuntiva o servizio a pagamento.

Worker **0.34.30** pubblicato sul canale GitHub dal commit `0a39a08`, ramo `release/worker-0.34.30`. Verifica binaria completa superata: 3 parti, 99.888.886 byte, SHA-256 `4545943bc173586f09661fd32671847c13fed486f37d61f641c59a895e69bdbb`. La pubblicazione rende disponibile l'aggiornamento; non prova l'installazione sui tre PC. Nessuna coda CRM avviata. La qualificazione live dell'adattatore Tecnocloud rimane distinta dai test locali.
