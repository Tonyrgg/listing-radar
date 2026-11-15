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

- 502 test su 56 suite, incluse migrazione PostgreSQL isolata, lease, prezzi, esclusione venduti/nostra agenzia e regressioni di identità.
- TypeScript e lint sui file modificati.
- Build Next.js con Webpack riuscita. Il comando Turbopack locale incontra la junction node_modules esterna alla root; non è stato cambiato il bundler del progetto per nasconderlo.
- Token/contrasto verificati. Controllo della tabella con dati dimostrativi a 1600, 1024 e 390 px, senza overflow della pagina.

## Distribuzione

Migrazione 0101 applicata sul progetto configurato eqqmglsxwbsihrlecnun, dopo backup della vista e della configurazione. Dimensione prima dell’intervento: 392.146.067 byte; pubblicazioni private iniziali: zero. Nessuna cancellazione di dati.

La raccolta automatica usa il workflow Private Listing Radar, ogni ora al minuto 17, subordinato alla variabile repository LIFECYCLE_PRIVATE_RADAR=true. Le riletture di URL già verificati avvengono dopo 6 ore; nuovi URL sono prioritari. Un PC acceso non è necessario per i job GitHub. Non si promette intercettazione istantanea: tempi dipendono dalla scansione e dalla disponibilità del portale.

La cartella .runtime contiene le prove di sola lettura; .backups contiene il backup precedente. Non sono pubblicate nel repository.

## Rilettura operativa e completamento

- Primo caricamento completo: 119 URL candidati verificati, 82 accettati (59 Subito, 23 CasaDaPrivato), 37 esclusi, nessun URL pendente o fallito. Tutte le 82 pubblicazioni risultano sia nel Radar privati sia nelle Opportunità. Database circa 393 MB.
- Vercel ha concluso il deploy production d8cb977; la raccolta privata è attiva. Il workflow Private Listing Radar è stato eseguito anche da GitHub con esito positivo.
- Migrazione 0102: URL nuovi subito eleggibili indipendentemente dallo scarto fra orologio del collettore e Postgres.
- Il primo sync GitHub di Studi Santi ha letto 101 schede senza errori, ma ha esposto un blocco di identità: tutte le 82 osservazioni rimanevano in revisione. Confronto delle tassonomie corretto per plurali e vecchie etichette che contenevano solo il numero di locali. Le categorie miste del portale non diventano tipologie precise inventate.
- I riferimenti nuovi di un publisher verificato possono creare soltanto una scheda provvisoria, quando non esiste lo stesso riferimento in agenzia e il resolver non segnala ambiguità. Un riferimento esistente con dati incompatibili rimane in revisione. Nessun accorpamento forzato e nessuna sovrascrittura di decisioni manuali.

- Migrazione 0103: corrette anche le foto Subito già acquisite. L’API pubblica richiede la regola di trasformazione presente negli elementi immagine della fonte; l’URL senza regola risponde 400. Verificato HTTP 200 e image/jpeg sulla variante esposta dalla pagina.

## Verifica finale del rilascio

- Migrazione 0104 applicata: i comuni senza via non sono indirizzi; il titolo dell�annuncio resta leggibile. Correzione circoscritta alle nuove schede automatiche, senza modificare indirizzi verificati o override manuali.
- Rilettura esplicita di cinque offerte di affitto erroneamente classificate come vendita dai portali: 77 annunci visibili e presenti anche nelle Opportunit� (55 Subito, 22 CasaDaPrivato), 42 esclusi; zero pendenti o falliti. Le 82 pubblicazioni originali restano conservate per audit: quelle escluse non vengono presentate come immobili usciti dal mercato.
- Immagini segnaposto escluse; le foto reali disponibili alimentano elenco e dossier. Un importo basso da solo non viene utilizzato per inventare un affitto o correggere un prezzo.
- Deep sync Studi Santi su GitHub, run 43731472240: concluso con successo; 101 dettagli letti, 82 vendite nel perimetro, zero errori di dettaglio. 51 osservazioni persistite, 31 identit� rimaste in revisione. La fonte primaria resta 403 e le assenze non vengono valutate sul catalogo alternativo.
- Workflow Private Listing Radar, run 43730279506: concluso con successo. La coda � persistente e la raccolta non dipende da un PC acceso.
- Collaudo UI autenticata con dati reali a 1600, 1024 e 390 px: nessun overflow di pagina, nessun errore JavaScript, navigazione elenco/dossier e foto verificate.
- Dimensione database dopo il giro approfondito: 398.240.915 byte, sotto la soglia di 500 MB. Le nuove acquisizioni possono far crescere l�archivio: non si garantisce spazio illimitato.
