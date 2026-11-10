# Worker V2 — attività, duplicati e tempi

## Stato della consegna

Implementazione del 10 novembre 2026. Versione **0.34.30 pubblicata** su richiesta successiva dell'utente: [release GitHub](https://github.com/Tonyrgg/listing-radar/releases/tag/property-worker-v0.34.30), commit `0a39a08`, canale aggiornamenti e ricomposizione binaria verificati. L'installazione sui PC non è stata verificata. La coda reale di Via Gorizia resta **stopped**. Nessun import o salvataggio CRM avviato durante questo intervento.

La migrazione **0063** per il coordinamento delle attività tra postazioni è applicata su Supabase. La verifica di disponibilità ha confermato RPC presente e zero prenotazioni: non sono stati inseriti contatti, immobili o attività di prova in produzione.

Il Chrome di lavoro non è disponibile per il collaudo reale. L'utente lo aprirà più tardi. Il comportamento dell'adattatore sulle pagine attuali di Tecnocloud rimane da qualificare; non si dichiara risolto retroattivamente l'esito dei vecchi invii incerti.

## Regole operative

1. Ogni immobile resta in lavorazione: identificazione, aggiornamento dati e verifica dei collegamenti con gli intestatari previsti.
2. Se è richiesta un'attività, l'immobile è concluso solo dopo aver verificato la nuova attività oppure una precedente che soddisfa le regole seguenti.
3. Un'attività **Da eseguire** o **Eseguito** inserita sull'immobile nel mese corrente evita una nuova attività sullo stesso immobile.
4. Un'attività con quegli stati inserita oggi sul cliente evita ulteriori attività oggi sugli altri suoi immobili. Il cliente è l'intestatario principale SISTER: quota maggiore, a parità ordine SISTER.
5. Si usa **CreatedDate**, cioè la data di inserimento nel CRM, nel calendario Europe/Rome. La data di scadenza/appuntamento non viene usata per queste finestre. Anche le attività manuali contano.
6. Uno storico incompleto non prova l'assenza di attività. Il Worker conserva il lavoro svolto e lascia il caso da verificare, senza reinserire alla cieca.
7. L'opzione senza attività conserva un esito distinto: non viene presentata come attività inserita.

## Conteggio prima della partenza

Il riepilogo conta immobili e clienti principali distinti, usando il piano congelato delle lavorazioni da recuperare. È un **massimo di nuove attività**, non una previsione di successi: le letture CRM possono ridurlo e i casi incompleti possono restare sospesi.

Lettura locale del lotto fermato di Via Gorizia: **65 immobili, 54 clienti principali distinti, 11 accorpamenti possibili**. I 65 immobili rimangono tutti da verificare; non vengono saltati gli immobili dei clienti ricorrenti. Tre immobili dello stesso cliente producono al massimo una nuova attività, quindi eliminano due attività aggiuntive.

Il risultato distingue: attività inserite e verificate, salvataggi recuperati, copertura mensile sull'immobile, accorpamento giornaliero sul cliente, attività non richieste e prove mancanti.

## Affidabilità dei salvataggi

- Prima di Salva vengono persistiti intento e identificativi già presenti.
- Il cliente del modulo deve corrispondere all'ID CRM previsto; il nome da solo non è sufficiente.
- L'ID Task restituito dal salvataggio viene conservato. L'ID è un candidato da rileggere, non una prova di successo.
- La rilettura verifica Task esatto, immobile, cliente, descrizione, stato e data di inserimento. Si possono seguire i collegamenti reali al dettaglio attività se la lista non contiene tutti i campi.
- Dopo un invio incerto non viene ripetuto il click Salva. Un ID conosciuto consente prima un recupero in sola lettura.
- Un mutex coordina le schede locali; la prenotazione atomica Supabase coordina i PC. Un invio incerto non perde la prenotazione per consentire un secondo invio alla cieca.
- I collegamenti dei comproprietari restano verificati indipendentemente dall'accorpamento delle attività.

## Riduzione dei passaggi

- Nessuna riscrittura dell'anagrafica se tutti i campi attesi sono già equivalenti; la rilettura di verifica rimane.
- Riutilizzo dello storico appena letto per gli ID precedenti al salvataggio, entro 60 secondi e solo per immobile e cliente identici.
- Riutilizzo delle prove positive della giornata per altri immobili dello stesso cliente; non si memorizza l'assenza di attività.
- Se esiste già una prova mensile sull'immobile si evita la lettura aggiuntiva dello storico cliente.
- Risposte di rete con limite di attesa; caricamenti parziali, indicatori zero provvisori e paginazioni incomplete non autorizzano nuove attività.
- Recuperi di lettura limitati nel provider V2, evitando la moltiplicazione dei tentativi su più livelli.

Non è dichiarata una percentuale di accelerazione: le misure sui tempi reali vanno ripetute nella sessione Tecnocloud autenticata.

## Collaudo prima della distribuzione

Verifiche locali concluse:

- TypeScript: `npm --prefix worker run build`, passato.
- Suite Worker completa: **991 test passati in 120 suite**; nessun test fallito.
- Migrazione e RPC: regressione PGlite `tests/integration/territory-activity-guard.test.ts`, passata.
- Compilazione Territorio e build installer Windows, passate.
- Electron simulato: coda persistente, riepilogo dei clienti, avvio solo dopo il controllo, rimozione delle sole lavorazioni verificate, stop/riavvio e conservazione di dati e storico passati. Verificati desktop e larghezza 390 px, senza errori JavaScript o overflow. Profilo temporaneo separato dal profilo live.
- Contenuto del pacchetto verificato: versione 0.34.30, nuovi moduli presenti, nessun file `.env`, archivio personale o credenziale online incluso; configurazione limitata ai valori pubblicabili.

Installer locale candidato: `C:\Users\ruggi\listing-radar-worker-activities-candidate\worker\release\Property Data Worker Setup 0.34.30.exe`.
SHA-256: `4545943bc173586f09661fd32671847c13fed486f37d61f641c59a895e69bdbb`.

Aprire manualmente il Chrome di lavoro e lasciare la coda ferma. Verificare in sola lettura almeno: un'attività sull'immobile nel mese, un'attività di oggi sul cliente, uno storico senza attività eleggibili, il dettaglio di un Task noto e un immobile con comproprietari. Registrare campi effettivi e tempi. Eventuali prove di scrittura vanno concordate separatamente; la riapertura della sessione non avvia una run.

Il pacchetto candidato è costruito da checkout isolato del commit base `1d91f7f` con le sole modifiche Worker di questa consegna. Non include il CSS desktop modificato precedentemente o le modifiche web pendenti. Le credenziali rimangono fuori dal pacchetto.
