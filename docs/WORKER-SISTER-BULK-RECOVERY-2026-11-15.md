# Worker 0.34.47 — ripresa della coda massiva SISTER

## Problema verificato

Nell’archivio locale la riga di Via Crocifisso risultava in pausa, ma la run associata era ancora running con 401 immobili conservati. La coda rifiutava di riprenderla. Lo stato running nel file non dimostrava la presenza di un processo attivo.

Il merge delle run ignorava inoltre il confronto a tre vie per scegliere il cursore: a parità di contatore e data iniziale una vecchia copia remota poteva prevalere su una pausa o un nuovo checkpoint. I fatti immutabili degli import erano conservati, ma l’avanzamento della scansione poteva regredire.

## Correzioni

- Il confronto a tre vie conserva l’aggiornamento quando l’altra copia non cambia. Le run hanno revisione di avanzamento e data di aggiornamento; le completate non vengono riaperte da una vecchia copia running. I fatti di scrittura CRM restano atomici e cumulativi.
- La coda recupera una run rimasta running soltanto dopo la barriera online e la verifica della sessione esclusiva. Controlla via, profilo, operazione e riferimento della coda. Mantiene ID, dati, impostazioni e checkpoint; se il checkpoint attesta già il completamento, evita una nuova scansione.
- Timeout e problemi temporanei di connessione o sincronizzazione ammettono due tentativi aggiuntivi, a cinque secondi di distanza. Ogni tentativo attende la conclusione del precedente e supera nuovamente la barriera online. Dopo l’esaurimento rimangono checkpoint e motivo concreto della pausa.
- Una pausa esplicita dell’operatore interrompe anche l’attesa tra tentativi. Login scaduto, identità ambigue, checkpoint mancanti e altra postazione attiva non vengono aggirati.
- Un errore di conferma online successivo al completamento non rende incompleta una via già acquisita. Le restanti vie rimangono nella coda.
- Il motivo originale di una query SISTER fallita viene conservato, anziché essere sostituito dal solo messaggio generico di pausa. Le eccezioni del coordinatore arrivano alla diagnostica della sessione.

## Verifiche e limiti

Build TypeScript e desktop riuscite. La verifica Territorio/sincronizzazione mirata passa con 252 test in 34 suite, senza includere i tre file con problemi preesistenti descritti sotto. 21 test mirati su coda e merge passati: ripresa interrotta, checkpoint invariato, barriera fallita, retry limitati, pausa operatore, sessione scaduta e completamento confermato dopo un errore online. Collaudo Electron isolato: due vie completate in sequenza, zero errori JavaScript.

La suite completa avviata durante l’intervento ha prodotto 1054 successi e 12 fallimenti su 1066 test. I quattro fallimenti su vecchie aspettative della coda/testo sono riprodotti anche sul commit precedente 8d8810b. Anche i due test attività con fixture prive del campo Catasto Foglio falliscono sul commit precedente. Tre dei sei timeout restanti passano ripetuti con un solo worker; gli altri tre falliscono anche sul commit precedente. Le due ulteriori regressioni aggiunte durante l’analisi sono incluse nei 21 test mirati verdi. Non dichiariamo verde l’intera suite e non modifichiamo selettori CRM o test validi per nascondere questi problemi.

Nessuna nuova acquisizione reale o scrittura nel CRM è stata avviata. Non sono stati modificati manualmente i file di avanzamento della postazione. L’effettiva coda lunga andrà osservata al prossimo avvio con la versione aggiornata; interruzioni della rete o scadenze dell’accesso possono ancora avvenire, ma non devono cancellare l’avanzamento.

## Distribuzione

Versione 0.34.47, installer Windows e release GitHub con verifica del canale di aggiornamento e dell’integrità binaria. L’applicazione già aperta deve essere aggiornata e riavviata prima di usare le correzioni; nessuna coda viene avviata automaticamente durante l’aggiornamento.
