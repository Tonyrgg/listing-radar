# Vie del Worker raggruppate per zone di lavoro

## Consultazione

Listing Radar: Territorio → **Vie per zona**, disponibile anche se il caricamento del livello immobili fallisce. Worker V2: pulsante **Vie per zona** sulla mappa. Entrambe le viste aprono un pannello sovrapposto, senza ridimensionare la mappa, con zone selezionabili, ricerca e filtro sulle sole vie acquisite. Le liste rimangono raggruppate sotto il nome delle zone.

La fonte delle zone è `map_areas`, con l'assegnazione originale ad `agents`. Il Worker non ne crea una seconda copia modificabile: le rilegge online quando si consulta l'elenco (cache di 30 secondi) e conserva soltanto una copia locale per la consultazione offline, esplicitamente indicata. Le zone manuali della vecchia Query immobili rimangono separate e non vengono sovrascritte.

Il modulo puro `worker/src/territory/zone-streets.ts` è usato da entrambe le applicazioni. Una via appartiene a una zona quando più di mezzo metro del tracciato attraversa il poligono. Funzionano attraversamenti senza vertici interni, buchi e MultiPolygon. Il solo contatto con un angolo non assegna una zona. Una via può appartenere a più zone; alias collegati ed elementi esterni ai centri abitati non duplicano il registro.

Non si ricava una posizione dal nome di una via. Le geometrie mancanti compaiono in **Da localizzare**, quelle esterne ai disegni in **Fuori dalle zone disegnate**. Le zone classificano la via, non i singoli civici.

## Preparazione della coda SISTER

Nel Worker, **Seleziona tutta la zona** seleziona le vie utilizzabili della lista. Con ricerca o filtro acquisizioni attivo l'etichetta specifica che si selezionano le sole vie visibili. La selezione può contenere più zone, senza duplicare una strada in comune.

**Aggiungi alla coda SISTER** salva tutte le iscrizioni in una sola modifica persistente. Non apre portali, non legge SISTER e non avvia la coda. Il normale flusso di sincronizzazione del workspace distribuisce la modifica alle postazioni. Vie già in attesa o sospese conservano ricerca e checkpoint. Le acquisizioni già concluse si possono preparare nuovamente; le run precedenti restano nello storico.

Si riusano parola chiave e voce SISTER già configurate. Se assenti, si prepara la voce ufficiale conservata e una parola significativa, evitando tipi stradali e numeri romani. Sono proposte visibili e modificabili nella coda tramite **Modifica**; la corrispondenza esatta resta verificata dal flusso SISTER. Vie non identificate vengono escluse con conteggio. SISTER acquisisce tutta la via, anche quando attraversa più zone.

## Dati condivisi e verifiche

Le migrazioni 0099 e 0100 introducono una lettura circoscritta per proprietario del workspace live. Espongono soltanto vie, geometrie, ricerche SISTER e conteggi/date. Non restituiscono soggetti, contatti, note o checkpoint. L'autenticazione web precede la lettura; l'RPC controlla l'identità anche per chiamate dirette.

Controllo live di sola lettura: 8 zone, 1593 vie attive, 83 con dati acquisiti; 881 prive di tracciato, 212 localizzate fuori dalle zone disegnate. Esempi di intersezione: Centro storico 107, Borgo San Francesco 53, Ospedale 63, Carmen 27. I conteggi possono cambiare con disegni, collegamenti e nuove acquisizioni.

Verifiche: test di geometria e appartenenza, cache/offline, coda massiva, riacquisizione, query, sincronizzazione e coda immobili. UI web e desktop provate a 1600, 1024 e 390 px. La prova desktop usa un profilo isolato: una zona con 27 tracciati ha prodotto 25 iscrizioni utilizzabili, nessun duplicato e nessun avvio; due tracciati senza nome richiedevano verifica. Verificata anche la modifica della ricerca nella coda. Nessuna acquisizione SISTER o scrittura CRM reale durante i test.

Build web verificata con webpack: Turbopack locale non può usare il node_modules condiviso tramite junction esterna alla root del worktree. Non è stata modificata la configurazione di produzione per aggirare questo limite locale.

La versione desktop per questa funzione è **0.34.46**. Il pacchetto comprende installer GitHub e canale aggiornamenti, oltre al codice su main.
