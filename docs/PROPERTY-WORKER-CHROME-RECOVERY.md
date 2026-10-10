# Recupero della scheda gestionale non pilotabile

## Diagnosi del 10 ottobre 2026

Nel Chrome di lavoro 154.0.8037.98, una lettura CDP ha confermato che la scheda SISTER aveva target e frame principale allineati, mentre il gestionale aveva identificativi diversi. Playwright non popolava correttamente quella pagina: la scheda era visibile in Chrome ma non utilizzabile dal worker. È lo stesso stato descritto nell'[issue Playwright 41397](https://github.com/microsoft/playwright/issues/41397), che può derivare dall'attivazione di un documento prerenderizzato. La verifica locale prova il disallineamento; non ricostruisce l'evento Chrome che l'ha provocato.

La versione 0.34.11 rilevava il problema e chiedeva di chiudere e riaprire manualmente il gestionale. La 0.34.12 recupera il collegamento nel servizio condiviso `worker/src/services/chrome.ts`, usato da acquisizioni, Lavorazioni, Rifinitura e Worker V2.

## Recupero

Una pagina CRM sana viene riusata. Se la pagina riconosciuta non è pilotabile, il worker apre l'ingresso stabile Tecnocloud nella stessa sessione Chrome, verifica il contesto di esecuzione e usa quella nuova pagina. Non chiude né ricarica la scheda originale e non tenta di riprodurre il suo indirizzo record o di inviare un modulo. L'avvio successivo preferisce la pagina sana; se l'accesso è scaduto, una pagina di login Tecnocloud già aperta nella stessa sessione viene riusata. L'accesso resta manuale.

Il recupero avviene durante il collegamento, prima delle azioni CRM. Non rilancia scritture a seguito di un errore incerto a metà import e non altera i checkpoint: confronti, verifica dei salvataggi e ripresa dell'immobile restano quelli del motore esistente. Se il recupero fallisce, si chiude soltanto la nuova pagina creata dal tentativo, si libera il collegamento e si segnala il problema. Le richieste di identificazione CDP hanno un tempo limite, così una pagina non può lasciare indefinitamente sospeso l'avvio. Gli archivi non tentano di leggere una pagina nota come non pilotabile.

Il controllo periodico del desktop usa soltanto SISTER: una scheda CRM non pilotabile non interrompe più quel controllo e il keepalive non apre nuove pagine CRM.

## Verifica

Le regressioni coprono recupero e riuso, ripresa solo CRM, schede sane, accesso scaduto, creazione/navigazione fallite, contesto di esecuzione assente, protocollo non rispondente e destinazioni estranee al CRM. Nel Chrome reale è stato inoltre verificato in sola lettura il recupero della scheda difettosa: una nuova pagina pilotabile, originali conservati e nessuna ulteriore pagina al secondo collegamento. Non sono stati eseguiti import o salvataggi nel gestionale.

La correzione gestisce questo specifico guasto di collegamento. Non sostituisce l'accesso manuale dopo una scadenza e non rende recuperabile un Chrome chiuso o non raggiungibile.
