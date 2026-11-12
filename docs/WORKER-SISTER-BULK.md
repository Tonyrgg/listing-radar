# Coda acquisizioni Sister — Worker 0.34.38

## Correzioni 0.34.39

L'acquisizione usa `connectToSisterChrome`: non richiede più Tecnocloud aperto.
La ricerca per indirizzo viene raggiunta anche da un'altra pagina autenticata:
voce di menu IND conservando l'ufficio, ingresso Visure nella stessa scheda,
menu consultazioni catastali o recupero della cronologia. Scadenza login e
blocchi di sessione del portale restano casi da risolvere autenticandosi.

Gli invii delle modifiche sono schedulati dopo 100 ms e le letture remote ogni
3 secondi. Le modifiche arrivate durante un invio generano un invio successivo.
La prenotazione rimasta dopo una run viene finalizzata prima di riavviare;
una chiusura non confermata viene ritentata dal giro automatico, senza richiedere
il pulsante di sincronizzazione. Nessun rilascio prima della conferma dei dati.
L'avvio drena le modifiche pendenti anche se trova uno scambio già in corso.

Verifiche: compilazione desktop, 43 test in sette suite (navigazione, connessione
senza CRM, retry automatico, coda, checkpoint e prenotazioni), prova Electron
del giro multiplo simulato. Nessuna acquisizione aggiuntiva nel portale reale.

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
