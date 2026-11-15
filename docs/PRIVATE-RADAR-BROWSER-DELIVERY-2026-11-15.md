# Radar privati e lettori delle agenzie, 15 novembre 2026

## Comportamento implementato

- HTTP come prima lettura; browser Chromium isolato soltanto per le fonti che ne hanno bisogno. Domini ammessi, timeout, richieste seriali e sospensione dopo un accesso negato. Nessun aggiramento di challenge o modifica al Chrome del CRM.
- Studio Casa: catalogo pubblico TrovaCasa verificato, con identità del publisher e paginazione.
- Studi Santi: vetrina pubblica Subito, shop 60083 verificato sulla scheda e sulla vetrina; lettura di JSON Next e dati React RSC, anche con testi multilinea, riferimenti e blocchi frammentati. RIFERIMENTO V/A/M esplicito nella descrizione conservato per il collegamento all’archivio. Affitti esclusi prima della persistenza.
- Le fonti alternative confermano presenze, non assenze e non l’intero patrimonio di incarichi. Il sito primario rimane segnalato come bloccato se risponde 403.
- Radar privati in Intelligence, nella tabella già esistente; gli stessi immobili entrano nelle Opportunità con priorità minima configurabile, 40 per privato riconosciuto e 20 per venditore da verificare. Nessuna nuova mappa, agenda o gestione mandati.
- Ingresso diretto in V2, senza nuove righe in listings. La compatibilità con il precedente ponte resta nel job manuale.
- Coda di URL persistente, identificativi univoci, nuovi URL prima delle riletture, checkpoint per annuncio e lease centrale rinnovabile. Prima osservazione conservata; un errore non significa annuncio rimosso.
- Agenzie riconosciute escluse, località risolte con la policy Bitonto/Palombaio/Mariotto, contatti rimossi prima della persistenza. Una successiva riclassificazione come agenzia rimuove la pubblicazione dal radar privati rispettando gli stati manuali.
- Foto e classificazione del venditore disponibili anche nel dossier. Gli incerti non sono dichiarati privati confermati. Indice coerente tra elenco e dossier.

## Verifica live di sola lettura

| Fonte | Inventario percorso | Vendite nel perimetro | Altre esclusioni | Errori |
|---|---:|---:|---|---:|
| Studio Casa / TrovaCasa | 57 schede | 55 | 2 fuori perimetro | 0 |
| Studi Santi / Subito | 101 schede, 4 pagine | 82 | 17 affitti/fuori perimetro, 2 località da verificare | 0 |

Tutte le 82 schede Studi Santi accettate espongono un RIFERIMENTO esplicito. Le date di ordinamento/rinnovo Subito non diventano date di incarico; i pin non precisi restano approssimativi.

Radar privati: Subito, 10 pagine con 95 collegamenti non riconosciuti come agenzia; CasaDaPrivato, 2 pagine e 24 collegamenti. Verificata una scheda privata in perimetro per ciascuna fonte. Questi conteggi sono candidati, non 119 privati confermati: il dettaglio e la località possono escluderne altri.

Idealista, Immobiliare.it e Casa.it hanno risposto 403 anche nella prova browser. L’integrazione conserva lo stato di fonte non leggibile e non promette copertura completa di questi portali.

## Controlli

- 498 test su 56 suite, incluse migrazione PostgreSQL isolata, lease, prezzi, esclusione venduti/nostra agenzia e regressioni di identità.
- TypeScript e lint sui file modificati.
- Build Next.js con Webpack riuscita. Il comando Turbopack locale incontra la junction node_modules esterna alla root; non è stato cambiato il bundler del progetto per nasconderlo.
- Token/contrasto verificati. Controllo della tabella con dati dimostrativi a 1600, 1024 e 390 px, senza overflow della pagina.

## Distribuzione

Migrazione 0101 applicata sul progetto configurato eqqmglsxwbsihrlecnun, dopo backup della vista e della configurazione. Dimensione prima dell’intervento: 392.146.067 byte; pubblicazioni private iniziali: zero. Nessuna cancellazione di dati.

La raccolta automatica usa il workflow Private Listing Radar, ogni ora al minuto 17, subordinato alla variabile repository LIFECYCLE_PRIVATE_RADAR=true. Le riletture di URL già verificati avvengono dopo 6 ore; nuovi URL sono prioritari. Un PC acceso non è necessario per i job GitHub. Non si promette intercettazione istantanea: tempi dipendono dalla scansione e dalla disponibilità del portale.

La cartella .runtime contiene le prove di sola lettura; .backups contiene il backup precedente. Non sono pubblicate nel repository.
