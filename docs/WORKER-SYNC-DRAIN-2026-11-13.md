# Worker 0.34.41 — attendere la conferma del checkpoint corrente

Il controllo prima del prossimo immobile usava `syncLoop.flush()` una sola
volta. Se trovava uno scambio già in corso, attendeva quello; un checkpoint
persistito successivamente restava pending. La barriera lo interpretava come
errore e fermava la run, pur con lo scambio precedente riuscito.

Anche il recupero automatico della chiusura della prenotazione verificava
pending immediatamente dopo uno scambio e poteva convertire un invio normale
ancora pendente in `memoryError`, che poi fermava l'avvio.

La stessa funzione `synchronizeUntilAcknowledged` viene ora usata prima di
ogni immobile, all'avvio e alla chiusura della sessione. Attende tutti gli invii
necessari fino a pending=false; tra i tentativi lascia proseguire le altre
operazioni locali, senza il precedente ciclo stretto limitato a otto passaggi.
La chiusura automatica rinvia il rilascio se rimane pending, senza dichiarare
errore. Timeout di 60 secondi e problemi reali di rete conservano dati e retry;
la garanzia della conferma online prima di operare resta obbligatoria.

Verifiche: compilazione desktop e 30 test in sei suite. Riprodotto l'inserimento
di un secondo commit mentre il primo viene salvato sul server simulato: prima
di proseguire vengono confermate entrambe le azioni, con hash locale/server
identico. Verificato anche il caso con più di otto scambi temporaneamente
occupati. Il controllo di un errore reale di connessione resta attivo.

Server osservato a revisione 716: zero conflitti aperti. Copia di casa
riconciliata con backup a revisione 717: 2.712 immobili, pending=false,
conflicts=0. Il testo esatto e la versione dell'errore corrente in ufficio
sono stati richiesti: la riproduzione della specifica postazione rimane
distinta dalla correzione del difetto identificato nel codice.
