# Worker 0.34.51 — ripristino avvio Worker V2

Causa della regressione 0.34.50: `renderer/app.js` importava `../zone-streets.js`. Nel pacchetto installato gli asset V2 sono in resources/territory/renderer, mentre il modulo compilato era soltanto in app.asar/dist-desktop/territory. L'import browser non trovava il file; l'intera esecuzione si fermava prima della prima lettura archivio e della mappa. Il messaggio statico di simulazione non prova una modifica del profilo.

Correzione: durante la preparazione si copia il modulo geometrico compilato in renderer/zone-geometry.js; l'app usa un import locale alla cartella distribuita. Un'unica sorgente geometrica, nessuna modifica al ledger, alle code o al CRM.

Nuovo controllo `desktop:packaged-v2-check`: apre una sessione Electron isolata con i veri asset in release/win-unpacked/resources/territory, profilo temporaneo e servizi esterni bloccati. Verifica mappa, ricerca, inventario e apertura directory zone; rileva errori JavaScript e richieste file fallite. Il controllo è incluso nelle build NSIS normali e firmate.

Prove: fallimento riprodotto con risorse 0.34.50 (timeout di avvio); su 0.34.51 1596 vie, mapLoaded true, searchEnabled true, zoneDirectoryOpened true, zero errori. 25 regressioni progress/gradiente e 5 geometria/zone passate. Nessuna scrittura sui dati utente o sul CRM.
