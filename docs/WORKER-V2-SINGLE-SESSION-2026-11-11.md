# Worker V2: riallineamento e una lavorazione alla volta

## Verificato
Casa installata 0.34.30, aperta manualmente dall’agente e lasciata in Worker V2. Revisione locale/online266, 1438 immobili,11 run,65 voci coda. Ultimo invio remoto10 novembre13:38UTC. Nessuna prova ancora dell’arrivo dei dati divergenti dei PC ufficio. Backup locale verificato in listing-radar-backups/worker-sync-20261111-101119.

## Difetto corretto, versione0.34.31
La sincronizzazione catturava l’errore per conservarlo nel badge; start non controllava quel risultato e poteva avviare lavori offline o con conflitti. Ora start richiede sync riuscita, nessuna modifica pendente e nessun conflitto aperto. Errori durante una lavorazione richiedono pausa al checkpoint. Pulsante Sincronizza ora visibile nella barraV2, revisione condivisa nel pannello, codici errore RPC leggibili.

## Esclusione reciproca
Migrazione0082: lease per workspace, device e token. Acquisizione atomica prima della lavorazione, heartbeat20s, scadenza90s. Un secondo PC viene respinto. Prenotazione liberata dopo invio finale confermato e controllo revisione server. Un crash o una risposta persa conserva la prenotazione anche scaduta: un’altra macchina non può lavorare su un archivio possibilmente incompleto. Lo stesso device può recuperarla alla riapertura dopo la scadenza; sincronizzare per chiudere la sessione. Un device perso definitivamente richiede recupero esplicito: nessuna cancellazione automatica della prenotazione.

Il blocco riguarda le lavorazioniV2; altri PC possono leggere e sincronizzare l’archivio. Non coordina versioni precedenti che non conoscono il protocollo: aggiornare tutte le postazioni prima di considerare garantita l’esclusione. Non blocca il vecchio percorso Lavorazioni/V1. Nessun importCRM live eseguito nei collaudi.

## Recupero una tantum ancora necessario
Con code ferme: aprireV2 su ciascunPC ufficio, Sincronizza ora, leggere conferma/codiceerrore e revisione; poi verificare su casa le vie e le operazioni effettivamente mancanti. La sola uguaglianza del numero di revisione di casa e cloud non prova l’allineamento dell’ufficio. In caso di errore, conservare ledger/binding e recuperare dal PC sorgente, senza sovrascrivere con il cloud.

## Prove
771 test in103suite WorkerCI passati. Compilazione desktop e generazione installer eseguite. PostgreSQL PGlite verifica esclusione secondoPC, lease scaduta non cedibile adaltrodevice, recupero stessoPC, token precedente invalido, mancato rilascio con revisione vecchia, autorizzazione solo service_role. Migrazione applicata online tramite db push. Recupero ufficio e prova con due app reali non dichiarati completati.
