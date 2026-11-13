# Date storiche delle agenzie e salute del giro

Implementazione 13 novembre 2026.

- Catalogo alternativo identificato ma incompleto: DEGRADED con riscontri
  positivi conservati; nessuna valutazione di assenza. Catalogo vuoto o non
  identificato: FAILED. Il retry rispetta il 403 primario anche se il publisher
  alternativo risponde 200. Non viene risolto né aggirato il blocco del sito.
- Tutti gli adapter partecipano al recupero storico nei DEEP_SYNC con
  LIFECYCLE_HISTORICAL_DATES=true (workflow aggiornato). Massimo cinque
  candidati per agenzia/giro, selezione deterministica giornaliera variabile.
  Non è un backfill immediato di tutti gli immobili e non garantisce copertura.
- CDX Wayback: URL esatta, prima cattura HTTP 200, poi corpo HTML originale.
  Il parser dell'agenzia rilegge la cattura. Servono due foto identiche o
  riferimento esatto più superficie e strada concordanti. Divergenze su
  riferimento, superficie, strada o civico impediscono la promozione.
- Claim publication.archivedPresence, fonte WAYBACK_VERIFIED_PRESENCE,
  timestamp cattura, URL e hash corpo conservati tra le prove. Data distinta
  dalla prima pubblicazione e dalla firma dell'incarico; UI spiega la provenienza.
  Nessuna modifica a stato commerciale o date manuali. Assenza di archivio,
  timeout, errore e identità incerta non producono date; 429/503 sospendono le
  richieste archivistiche per il processo, senza degradare la fonte live.
- Migrazione 0097 aggiorna la piccola proiezione indicizzata delle date;
  sostituzione transazionale, nessuna riscrittura dei dati originali. Applicata
  e registrata sul progetto configurato; refresh riuscito. Prima dei nuovi giri:
  712 rapporti agenzia, 262 datati; non sono nuove date scoperte in questa consegna.

Verifiche: 480 test Property Lifecycle passati; regressioni aggiuntive su
catalogo parziale/vuoto e migration 0095–0097 passate; TypeScript e build
Next webpack riusciti. La build Turbopack locale incontra il collegamento
node_modules esterno al worktree; nessuna modifica al bundler di produzione.

Limiti: CDX può essere indisponibile e la prima cattura può non avere corrispondenza
sufficiente. In quel caso la data resta sconosciuta. Il processo non cerca ancora
snapshot successivi o Common Crawl e non ricostruisce intervalli di assenza.
Il recupero storico documenta una presenza entro una data, mai una firma contrattuale.
