# Acquisition OS

## Flusso

Notizia → verifica → contatto identificato → da contattare → contattato → conversazione → follow-up → acquisizione fissata → svolta → incarico (`WON`). Gli stati alternativi sono `FUTURE`, `NOT_INTERESTED`, `LOST`. Ogni stato aperto senza prossima azione è evidenziato nelle liste. La coda Oggi mostra scaduti, odierni, lead A e anomalie senza azione.

Una proprietà V2 può avere più pubblicazioni e segnali. Una sola opportunità commerciale aperta è consentita per proprietà tramite indice univoco. Un lead già `WON` riceve nuovi segnali nello storico senza riaprirsi automaticamente. Gli indirizzi inseriti a mano e i recapiti già presenti vengono proposti come possibili duplicati, senza merge automatico. Gli eventi V2 privati usano chiavi univoche; ribasso, prima pubblicazione, ricomparsa, rimozione e passaggio agenzia→privato creano segnali. La priorità automatica è una regola semplice A/B; l'operatore può modificarla. Un segnale non è prova di intenzione di vendita.

## Motori

Quick Add classifica: FSBO, CRM Mining, Buyer-to-Seller, Immobili abbandonati, Eventi edilizi, Smart Zone, Rete professionale, Intelligence di quartiere, Property Intelligence, Successioni, Cartelli privati, Lavori condominiali, Trasloco/svuota-casa, Amministratori, Tecnici. Solo FSBO dispone di ingestione automatica in questa versione; gli altri accettano inserimento manuale. Foto e documenti non sono gestiti da questo modulo.

I segnali di successione, dati pubblici e segnalazioni di terzi sono marcati come fonti da rivedere: il contatto richiede una revisione esplicita prima di registrare un tentativo. La scheda conserva anche una data futura di revisione. `do_not_contact` e lo stato `blocked` impediscono il passaggio agli stati di contatto. Non vengono inviate chiamate o messaggi automatici.

La richiesta buyer contiene `needs_to_sell_first`, immobile da vendere e note. Da una richiesta con risposta «sì» si crea una notizia seller collegata, scegliendo la località. Più richieste possono rafforzare lo stesso lead tramite `acquisition_lead_requests`. Il matching commerciale esistente continua a usare `property_requests` e `request_property_matches`.

Le attività registrano tipo, esito, nota, autore e data. Un'attività può programmare il follow-up. L'appuntamento conserva motivazione, tempi, prezzo, stima, ostacoli e concorrenti; l'esito `mandate` porta a `WON`.

La vista Oggi è paginata a 50 elementi e ordina nel database: acquisizioni odierne, azioni scadute, lead A, azioni odierne e B prossimi alla scadenza. I tentativi di contatto richiedono un contatto collegato non bloccato e con le fonti sensibili già revisionate.

I KPI sono aggregazioni SQL senza limite di righe nel periodo, suddivise per fonte e tipo segnale. Le acquisizioni svolte e gli incarichi usano la data di completamento; quelle fissate usano la data di creazione. I tassi mostrati sono rapporti fra eventi nello stesso periodo, non conversioni di coorte.
