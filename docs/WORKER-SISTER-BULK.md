# Coda acquisizioni Sister — Worker 0.34.38

In Worker V2, il pulsante «Acquisizioni Sister» apre la coda delle vie sopra
la mappa. Ogni riga contiene via identificata, parola chiave e voce esatta
Sister. L'operatore conferma questi testi aggiungendo la riga; il portale
verifica la corrispondenza durante l'esecuzione. Non viene eseguita una
consultazione preventiva aggiuntiva. Le righe si eseguono in ordine di aggiunta.

Il giro riutilizza l'acquisizione esistente, legge tutti gli intestatari,
riusa la memoria verificata e conserva le impostazioni iniziali in ripresa.
Non avvia automaticamente la coda di scritture CRM.

La coda è conservata come `memories[streetId].sisterQueue`: viene sincronizzata
con il protocollo per record già distribuito, senza una nuova collezione o
migrazione SQL. La run e il riferimento della riga vengono salvati nella
stessa transazione locale. La pausa ferma il giro; errore o acquisizione
incompleta interrompono la sequenza senza segnare la via come acquisita.
Una run conclusa viene saltata alle riprese. Per riacquisire una via conclusa,
rimuovere e aggiungere nuovamente la riga; lo storico rimane conservato.

Il giro mantiene la prenotazione esclusiva della postazione fino alla
sincronizzazione finale; controlla conferma online e prenotazione prima e dopo
ogni via, oltre alle barriere esistenti sui singoli immobili. Chiusura della
finestra e pausa globale attendono anche la conclusione del coordinatore.

Verifiche: compilazione desktop; 41 test in sei suite su coda, checkpoint,
impostazioni, protocollo e barriere; prova Electron su profilo temporaneo con
due vie, esecuzione via interfaccia e nessun errore JavaScript. Screenshot in
`.runtime/sister-bulk-ui/desktop.png`. Servizi esterni bloccati nella fixture.
L'esecuzione multipla sul portale reale non è stata avviata per questa consegna.

Limiti: login Sister scaduto richiede il ripristino della sessione; le ricerche
ambigue o fallite fermano il giro. Il riordino avviene rimuovendo e aggiungendo
la riga. Una voce già avviata conserva la ricerca nel checkpoint.
