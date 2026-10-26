# TonyBook — selezione dei gruppi

## Implementato

Il comando `npm run core:tonybook:groups -- --input=<snapshot.json> --output=<nuova-cartella> [--registry=<registro.json>]` prepara candidati JSON e un CSV ambienti compatibile con il registro esistente. Non legge Facebook e non compie azioni esterne.

Lo snapshot versione 1 contiene `sourceUrl` (https://www.facebook.com/groups/joins/), `observedAt`, `reportedTotal` (numero o null), `hasNextPage` (boolean o null), `endObserved` e `groups`: nome `name`, URL diretto `url`, eventuale `description`, `membership` JOINED oppure UNKNOWN.

Bitonto, Palombaio, Mariotto e gli aggettivi bitontini costituiscono evidenza geografica esplicita. Bari/Puglia restano da esaminare. I gruppi locali già dichiarati JOINED diventano proposte DA VALUTARE, senza data di esame o regole inventate. Non vengono attivati automaticamente. URL mobili e parametri vengono normalizzati; rifiuti e dati precedenti sono conservati. Il risultato offline ha sempre `collectionVerified: false`, anche quando il totale dichiarato coincide con le righe.

## Da completare quando Facebook sarà aperto

Leggere tutte le pagine dell'elenco gruppi autenticato, conservare origine e istante, provare la fine dell'elenco e confrontare il totale quando disponibile. Collegare lo snapshot a questo comando, esaminare regole e pertinenza dei candidati, quindi aggiornare il registro con scelta esplicita. Nessuna iscrizione, commento, messaggio o like è implicito nella proposta.

L'utente ha rinviato l'apertura della sessione Facebook. Nessun gruppo reale è stato raccolto in questa prosecuzione. Test automatici coprono classificazione, URL, duplicati, conservazione dei rifiuti e distinzione fra completezza dichiarata e raccolta verificata.
