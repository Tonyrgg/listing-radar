# Indirizzi e coordinate: conservazione e ricognizione — 17 novembre 2026

Applicata e riletta online la migrazione 0105: un aggiornamento privo di coordinate non cancella la coppia precedente. Via e civico vuoti non cancellano quelli noti; anche gli attributi canonici conservano i valori mancanti. I pin Ad Maiora già esclusi non sono recuperati da questa regola. Nessun nuovo civico è derivato automaticamente da coordinate.

Tutti gli adattatori creati dal registro aggiungono alle nuove letture un insieme compatto di prove pubbliche: indirizzo e geo JSON-LD di oggetti immobiliari, iframe mappe, indirizzo e coordinate estratti dall'adattatore. Ogni indizio conserva fonte e data e resta distinto dalla verifica indipendente. Le informazioni vengono incluse negli snapshot tramite la normale pipeline. Non vengono letti campi riservati né interpretati nomi fotografici come proprietari.

Ricognizione HTTP reale: inventari e un dettaglio per ciascuna di nove agenzie. Non è una verifica esaustiva di ogni annuncio. VistoCasa: 113 riferimenti, pin nel campione; Futura: 57, via e pin; PuntoCasa: 90, via senza pin nel campione; Studi Santi: 101, lettura DEGRADED e pin nel campione; StudioCasa: 57, nessun indirizzo/pin nel campione; Ad Maiora: 44, via e JSON-LD senza promozione del pin; Garofalo: 41, via e pin; Iconacasa: 112, nessun pin nel campione; Momento: 3, via e civico 44 nel campione.

Strategie successive: approfondire iframe e richieste pubbliche specifiche dove il dettaglio non espone indirizzi; riscontro del pin con civici cartografici e portone, conservando candidati e incertezza; confronto di pubblicazioni della stessa unità e agenzia per ricostruire il primo ciclo pubblico. La data di pubblicazione non è una prova dell'inizio del contratto d'incarico. I dati mancanti su singoli siti non autorizzano ad attribuire la posizione dell'ufficio dell'agenzia all'immobile.

Verifiche: test PostgreSQL embedded sulla conservazione e sull'aggiornamento valido della coppia, raccolta metadati senza promozione automatica, regressioni Ad Maiora e riepiloghi. Typecheck e build. Nessuna modifica al desktop Worker.

Script ripetibile: `npx tsx scripts/audit-public-location-evidence.ts`. Output dettagliato locale ignorato `.runtime/location-audit/results.json`.
