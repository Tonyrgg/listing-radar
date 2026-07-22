# Property Data Worker

Applicazione Node.js locale separata dalla web app Listing Radar. Si collega a un Chrome già aperto via CDP, legge i recapiti da Excel e persiste coda, avanzamento e audit nello stesso progetto Supabase della web app.

Non gestisce login, credenziali, SPID/CIE, OTP o CAPTCHA. Le sessioni SISTER e gestionale devono essere aperte manualmente in Chrome.

## Applicazione desktop Windows

L'uso normale avviene tramite l'app desktop. Da `worker/`:

```powershell
npm install
npm run desktop:dev
```

L'interfaccia permette di:

- avviare il profilo Chrome dedicato;
- controllare Excel, Supabase, SISTER e gestionale;
- scegliere assisted/automatic e dry-run;
- avviare, mettere in pausa e riprendere una lavorazione;
- rispondere alle conferme assisted con pulsanti;
- capire in parole semplici cosa sta facendo, perché si è fermata e come ripartire;
- correggere direttamente nell'app dati catastali, anagrafica, codice fiscale e quote mancanti;
- consultare avanzamento, lavorazioni recenti e diagnostica;
- mantenere attiva la sessione SISTER con una richiesta silenziosa ogni 2-3 minuti, senza ricaricare la pagina visibile.
- conservare la configurazione nel deposito cifrato di Windows, senza riselezionare `.env` dopo gli aggiornamenti.

Per generare l'installer Windows:

```powershell
npm run desktop:build
```

L'installer viene creato in `worker/release/`. Per un singolo eseguibile portabile, senza installazione:

```powershell
npm run desktop:portable
```

La CLI rimane disponibile come strumento tecnico di emergenza.

Gli utenti autenticati possono scaricare l'installer anche da **Impostazioni → Property Data Worker** o dal pulsante **Scarica software** nella cabina di lavorazione di Listing Radar. Il binario è pubblicato come release della repository esistente e non viene incluso né eseguito nel deploy Vercel.

## Installazione

1. Applica `supabase/migrations/003_property_worker.sql` allo stesso progetto Supabase usato da Listing Radar.
2. Nell'app installata la configurazione è inclusa nel pacchetto e viene trasferita al primo avvio nel deposito cifrato di Windows. Se una nuova installazione non è stata preconfigurata, apri **Impostazioni → Configurazione avanzata** e inserisci i valori una sola volta: non occorre creare un file `.env`.
3. Installa il worker:

   ```powershell
   cd worker
   npm install
   ```

4. Avvia Chrome con un profilo dedicato:

   ```powershell
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\ChromeListingRadar"
   ```

5. Accedi manualmente a SISTER e al gestionale, lasciando entrambe le schede aperte. Le regole per riconoscere le schede sono già incluse; se cambiano, puoi aggiornarle nella configurazione avanzata dell'app.

Il file `.env` resta supportato soltanto per lo sviluppo e per l'uso tecnico della CLI. Non viene mai letto dal renderer e la service role key non viene mostrata nell'interfaccia o nei log.

Finché l'app desktop resta aperta, il worker richiama in background una pagina neutra di SISTER tra 120 e 180 secondi. Non automatizza il login e segnala subito una sessione scaduta. L'intervallo e l'eventuale URL sicuro possono essere personalizzati con `SISTER_KEEPALIVE_MIN_SECONDS`, `SISTER_KEEPALIVE_MAX_SECONDS` e `SISTER_KEEPALIVE_URL`.

## Adattatori dei portali

I selettori di produzione verificati sono centralizzati nei file seguenti:

- SISTER: `src/adapters/sister/selectors.ts`
- gestionale: `src/adapters/crm/selectors.ts`

Correggere qui eventuali cambiamenti futuri dei portali. Non aggiungere selettori nei servizi. I preset `*FixtureSelectors` servono soltanto ai test HTML locali.

## Comandi

Da `worker/`:

```powershell
npm run worker:check
npm run start
npm run worker:start
npm run worker:start:assisted
npm run worker:start:auto
npm run worker:resume -- --job-id=<uuid>
npm run desktop:dev
npm run desktop:build
npm test
npm run build
```

Gli stessi comandi `worker:*` sono disponibili anche dalla root del progetto.

Il check verifica configurazione, file e colonne Excel, Supabase/migration, collegamento CDP, schede aperte e presenza apparente delle sessioni. Elenca titolo e URL delle schede senza stampare cookie o token.

## Flusso sicuro iniziale

Lascia `WORKER_DRY_RUN=true` e `WORKER_MODE=assisted`. Porta manualmente SISTER sulla pagina risultati dopo aver scelto Comune, via e civico. Avvia il worker e premi Invio al prompt **Acquisisci risultati**. In dry-run il worker compila e riepiloga le modifiche, ma non preme i pulsanti finali di salvataggio del gestionale.

Per ogni titolare il flusso operativo è:

1. raccolta completa di immobili e proprietari da SISTER;
2. riepilogo visuale con immobile a sinistra, proprietari e quote a destra;
3. ricerca del nominativo tramite codice fiscale;
4. in presenza di più schede, creazione di un nuovo nominativo e controllo del merge Cloud;
5. conferma del merge soltanto quando il Cloud non segnala problemi;
6. verifica degli immobili collegati al nominativo, prima per dati catastali e poi per via e civico identici;
7. aggiornamento dei dati catastali discordanti usando SISTER come fonte prioritaria;
8. preparazione di una sola attività per immobile, aperta dalla scheda immobile, con stato **Da eseguire** e descrizione **Inserire attività**;
9. matching dei recapiti Excel tramite codice fiscale e aggiunta dei recapiti mancanti;
10. controllo finale dei soggetti collegati e delle quote di comproprietà.

Se il gestionale restituisce più schede per lo stesso codice fiscale, il worker non chiede più di sceglierne una. Prepara una nuova scheda e tratta il merge come uno step persistente. Un esito Cloud sicuro può essere confermato; un conflitto porta il job in `needs_review` per la correzione manuale. **Riprendi lavorazione** torna direttamente alla verifica del merge senza ripetere SISTER o creare un altro nominativo.

Ogni step viene registrato prima e dopo l'esecuzione. Anche gli elementi già elaborati all'interno di uno step vengono conservati: in caso di arresto, **Riprendi lavorazione** continua dal primo elemento non concluso senza ripetere quelli completati. Pausa e ripresa richieste dalla dashboard modificano solo Supabase: la web app non controlla Chrome.

Lo step attività salva inoltre un checkpoint per ogni immobile. Le modali attività vuote oppure compilate dal worker e rimaste aperte vengono annullate automaticamente; una modale con testo inserito manualmente viene invece lasciata intatta. Navigazione, rendering e preparazione del modulo vengono ritentati automaticamente prima di fermare il job. Dopo un click reale su **Salva** non viene mai eseguito un secondo salvataggio cieco, così da evitare duplicati.

Nel software desktop, **Annulla processo** arresta il runner in modo cooperativo e poi elimina definitivamente il job con immobili, proprietari, quote, step, log e screenshot diagnostici collegati. **Interrompi e conserva** mantiene invece l'avanzamento per una ripresa successiva. Le operazioni già concluse nel gestionale esterno non possono essere annullate dal worker e la finestra di conferma lo segnala esplicitamente.

Gli screenshot vengono creati solo per pagine non riconosciute, sessioni scadute o messaggi inattesi, e vengono rimossi dopo `ERROR_SCREENSHOT_RETENTION_DAYS`.
