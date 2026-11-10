# Redesign completo delle superfici di consultazione, 10 novembre 2026

## Riferimento realmente osservato

Video dell’utente: C:/Users/ruggi/Videos/Registrazione 2026-11-10 220051.mp4.
Durata 52,87 secondi, 1920 × 1032. Estratti 27 fotogrammi ogni due secondi;
ispezionati anche a risoluzione originale. File di lavoro in .runtime/avistador-reference.

- 00 s: home con navigazione stretta, contatori compatti e lista di priorità.
- 04–10 s: Radar, filtri laterali e tabella compatta con miniature.
- 12 s: sequenza follow-up a sinistra e fasi nello spazio principale.
- 16 s: mappa dominante, contesto e legenda separati.
- 18 s: mandati, stato vuoto e riepilogo.
- 24 s: dossier, foto a sinistra, sintesi al centro, azioni e fonti a destra.
- 26–34 s: storico richiesti, confronti e posizione.
- 38–46 s: secondo dossier, confronti selezionabili, esito e conferma annullabile.
- 48–52 s: ritorno alla home senza cambiare struttura.

## Traduzione implementata

La struttura di consultazione è stata ricostruita sui dati e sulle azioni di
Listing Radar. Nuovo registro tabellare, filtri laterali, dossier a due colonne,
sintesi fotografica, storico richiesti accessibile, azioni e verifiche laterali,
Notizie apribili. Le destinazioni esistenti usano la stessa scala compatta.
I documenti dell’immobile vivono dentro la colonna principale del dossier.

Non sono stati copiati asset, dati o codice di Avistador. I comparabili
selezionabili, le sequenze commerciali e le stime di motivazione viste nel video
non vengono presentati come funzioni esistenti del nostro archivio.

## Provenienza e limiti

L’elenco e il dossier continuano a leggere gli stessi modelli V2. Non ci sono
migrazioni o nuove raccolte. Le prove e le correzioni manuali restano accessibili.
Uno storico vuoto non produce un grafico fittizio; i prezzi in conflitto rimandano
alle pubblicazioni separate. I giorni sono presentati come osservazione e non
come scadenza dell’incarico.

Il video permette di osservare la UI, non gli algoritmi o le prestazioni del
backend di Avistador. Queste restano ipotesi da verificare separatamente.

## Anteprima e controlli

Anteprima su http://127.0.0.1:3012/intelligence, solo sul computer locale.
Le immagini locali radar-desktop.png, dossier-desktop.png e le varianti mobili
sono nella cartella di lavoro sopra indicata.
In questa anteprima locale AUTH_REQUIRED=false è limitato al processo di sviluppo
su loopback; il codice di autenticazione e la configurazione pubblicata non cambiano.
La navigazione automatica di verifica blocca le richieste POST.

Verifiche: typecheck, ESLint delle superfici modificate, design:check,
113 test passati in 11 suite, inclusi storico richiesti e lettura territoriale.
Build di produzione Webpack completata. Il bundler è esplicito perché il worktree
locale riusa node_modules tramite junction, incompatibile con il root Turbopack.
Le etichette e il filtro temporale dei layer sono stati separati dalle letture
server, correggendo gli import node:crypto nel bundle browser della mappa.
Il mock del test territoriale è stato allineato alla lettura già esistente:
proprietà in pagine da 64, contesti e documenti su rami separati.
Nessun deploy eseguito.
Verifica interazioni locali: apertura di una notizia; annullamento della conferma
di abbandono di una zona modificata, con nome digitato conservato; filtri mobili
chiusi all’avvio e ricerca GET funzionante. Overflow della pagina assente a
390 e 1024 px. Mercato, Opportunità, Notizie, Fonti e Territorio controllati
senza errori JavaScript. Nessuna azione di salvataggio di dati reali eseguita.

## Affinamenti successivi, 10 novembre

- Miniature con anteprima fotografica su hover e focus da tastiera, rimossa
  uscendo, scorrendo o premendo Escape; immagini originali non alterate.
- Filtri a destra, 304 px su desktop, apribili e richiudibili. Su schermi
  piccoli diventano un pannello laterale da massimo 340 px.
- Colonne ordinabili sul risultato completo. Ordinamenti SQL con whitelist;
  €/m² usa una proiezione leggera paginata, ordina il risultato completo e
  recupera solo i dettagli dei quaranta identificativi della pagina.
- Gli URL delle schede conservano origine e ritorno alla lista con i filtri.
  Il contesto non riclassifica l’immobile: stessa identità, diversa priorità.
- Mercato: caratteristiche e presenza. Opportunità: ragioni e indice.
  Usciti: classificazione e storico prima del grafico. Venduti: conferma o
  segnale probabile, data e prova; il richiesto resta distinto dalla vendita.
- La conferma manuale di non vendita prevale sulle classificazioni discordanti.
- Notizie: separazione tra fatto, interesse e verifiche; riferimenti in una
  colonna dedicata. Rimosso il doppione «Cosa sappiamo e cosa verificare».
  I casi già aggiudicati non sono descritti come offerte ancora attive.
- Cinque nuovi test su ordinamenti globali, valori mancanti, whitelist,
  contesti e URL di ritorno. Totale: 118 test passati in 12 suite.
