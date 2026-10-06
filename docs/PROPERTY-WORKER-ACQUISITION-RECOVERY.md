# Acquisizioni conservate e memoria V2 — 0.34.2

## Diagnosi del 6 ottobre 2026

La run `6f109587-75bd-41f0-8a2e-90107473a111` di via Palmiro Togliatti contiene 219 immobili e 314 persone; 62 checkpoint di import sono conclusi e verificati. Il blocco «L'acquisizione è cambiata dopo l'inizio dell'import» era provocato dalla rilettura degli stessi cinque proprietari di un immobile in un ordine diverso. Identità, quote, anagrafica e recapiti risultano invariati. Il fingerprint precedente includeva l'ordine delle comproprietà restituito dal database, che non era garantito.

La run `9599337a-0e26-4138-98f7-8c88be105d23` contiene 302 immobili e 404 persone distinte. Il checkpoint conserva 581 righe gestite (302 completate e 279 escluse) e un cursore con 739 righe SISTER note, ma un successivo errore di struttura della risposta aveva sostituito i contatori con zero. La raccolta è sospesa, non certificata completa: «Continua acquisizione» è coerente con questo stato. Le due raccolte hanno filtri diversi; i loro totali non devono essere forzati a coincidere.

Entrambi i difetti appartengono ai percorsi ordinari precedenti all'integrazione della sezione Worker V2. Le prove sono state eseguite su esportazioni in sola lettura e copie temporanee; nessun checkpoint reale o scheda Tecnocloud è stato modificato durante il collaudo.

## Recupero e protezioni

- Il fingerprint confronta l'insieme degli intestatari, conservando nel piano operativo l'ordine originale, il principale a quota pari e la scelta dell'attività. Le migrazioni compatibili mantengono tutti gli ID CRM e gli stadi già verificati. Cambiamenti effettivi di catasto, intestatari, quote o recapiti restano bloccanti.
- La rilettura del grafo pagina immobili, persone e comproprietà, con ordinamento stabile. Non tronca le raccolte a mille righe.
- Un errore SISTER conserva l'ultima evidenza parziale anche fra i tentativi automatici. Alla ripresa dei vecchi checkpoint azzerati, contatori e chiavi vengono ricostruiti dal registro delle righe senza dichiarare la raccolta completa.
- La lettura conclusa viene conservata prima del ritorno al modulo di ricerca: un errore di navigazione finale non annulla i dati acquisiti.
- I dettagli degli eventuali conflitti d'identità arrivano alla diagnostica con job e immobile, senza esporre credenziali o dati degli intestatari.

Dopo l'aggiornamento, usare **Riprendi import** sulla prima run: i 62 immobili conclusi vengono saltati. Sulla seconda usare **Continua acquisizione**; vengono conservate le righe già gestite e vengono verificate quelle ancora aperte. Non avviare una raccolta nuova per recuperare queste due run.

## Memoria delle acquisizioni quotidiane

Le raccolte ordinarie alimentano automaticamente la memoria V2 alla conclusione o sospensione di una run e al termine di ogni tentativo di import. L'archivio delle acquisizioni conservate viene ricontrollato all'avvio, anche quando l'utente resta nelle sezioni precedenti. Il bridge lavora in background, senza ritardare il normale avvio dell'import; legge il grafo e i checkpoint, non avvia acquisizioni, non abilita schede di prova e non ripete scritture nel gestionale.

Il passaggio usa `acquisition-inbox/` nel profilo Territorio, con file atomici. Se la memoria è occupata o il profilo è aperto altrove, i dati rimangono in attesa; vengono riadottati al successivo avvio. Si usa il medesimo store e blocco del profilo della sezione V2. Dopo l'adozione entra in funzione la sincronizzazione online già configurata, con revisioni e protezione dai conflitti.

L'adozione è idempotente, conserva annotazioni e correzioni umane e associa le vie per corrispondenza esatta con l'inventario ufficiale. Un nome ufficiale senza civico può alimentare la memoria della via; questo non allenta i controlli d'identità per le scritture CRM. Nomi ambigui rimangono nello storico da associare.

La via esiste già nella rete. L'acquisizione ne descrive la situazione catastale osservata: inventario prima dei filtri operativi, immobili e proprietari effettivamente letti. L'import certificato nel gestionale aggiunge le prove di avanzamento. Il riferimento riguarda il perimetro riconosciuto dal lettore SISTER del worker (categorie A/C); il numero di righe grezze non equivale al numero di immobili unici. L'inventario viene deduplicato per identità catastale. Gli immobili sviluppati dai portafogli dei proprietari vengono associati alle rispettive vie, ma non provano che l'inventario di queste altre vie sia completo.

La percentuale usa l'ultima raccolta della via e le sue prove verificate; una raccolta incompleta mostra un totale provvisorio e nessuna percentuale inventata. La data di un vecchio import ripreso oggi non diventa una nuova osservazione SISTER e non sostituisce la sorgente di una raccolta più recente. L'età dell'import mantiene le soglie verde fino a 30 giorni, giallo da 31 a 90, rosso oltre 90.

## Verifiche

Suite completa: 720 test superati su 88 file, con un solo worker Vitest per evitare contesa fra i Chrome di collaudo. Suite CI finale: 529 test su 73 file, incluse le regressioni aggiunte dopo la suite completa. Prova delle run reali: tutti i 62 checkpoint conclusi restituiscono `completed` senza alcuna chiamata CRM; recupero delle 739 righe note e delle 302 chiavi già acquisite nella seconda run. Una prova d'import non certifica una sorgente successivamente modificata; gli esiti originali rimangono nello storico.

`npm.cmd --prefix worker run worker-v2:memory-check` verifica in Electron la memoria con V2 non aperto, il denominatore dell'inventario, prove d'import, idempotenza, note e riavvio. Usa esclusivamente un profilo temporaneo e servizi esterni disabilitati. Sono inoltre eseguiti i collaudi `worker-v2:visual-check`, `territory:online-visual-check` e `desktop:visual-check` prima della pubblicazione.
