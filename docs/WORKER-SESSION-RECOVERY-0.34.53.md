# Worker 0.34.53 — recupero automatico della sessione tra PC

Causa: acquire_territory_operation (0082) rifiutava una prenotazione scaduta di un dispositivo differente anche dopo la scadenza dei 90 secondi. Serviva obbligatoriamente riaprire il dispositivo precedente. Rilevata online una sola prenotazione, scaduta; nessuna cancellazione di archivi/checkpoint.

Migrazione 0109 applicata online: claim atomico della prenotazione scaduta per qualsiasi postazione dello stesso proprietario/workspace live. Prenotazioni ancora attive restano esclusive. Il nuovo token invalida il precedente. Rinnovo con vecchio token rifiutato; chiusura tardiva di una vecchia sessione non può liberare la prenotazione della nuova postazione. Nessun rilascio forzato di sessioni attive e nessuna cancellazione di dati.

Nel desktop, quando il server conferma che il token non è più valido, viene fermato il rinnovo e rimossa la prenotazione locale, mantenendo i dati. Un errore di rete conserva invece il token per il normale recupero. La sincronizzazione avviene prima e dopo il claim già nel flusso di avvio. Stato di chiusura pendente azzerato quando la sessione precedente è persa o quando viene acquisita quella nuova.

Le sette operazioni mutanti del port CRM verificano inoltre il token centrale prima dell'esecuzione, anche all'interno della stessa scheda; i metodi di lettura non aggiungono richieste di rinnovo. Nessuna nuova run SISTER o scrittura CRM reale è stata avviata per il collaudo.

Prove PostgreSQL embedded: esclusione di un secondo PC mentre la prenotazione è attiva; takeover dopo scadenza; vecchio token non rinnovabile; vecchia chiusura innocua; revisione aggiornata necessaria per liberare la propria prenotazione; accesso limitato al service_role. Prove desktop: perdita token, nuova acquisizione, perdita rete distinta da perdita possesso e rifiuto delle sette mutazioni senza sessione valida.

La scadenza è di 90 secondi dall'ultimo rinnovo: non è un lock permanente. Un PC offline conserva ciò che non ha potuto inviare e lo riconcilia quando torna online; non può trasmettere dati mentre è spento.
