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
- consultare avanzamento, lavorazioni recenti e diagnostica.
- mantenere attiva la sessione SISTER con una richiesta silenziosa ogni 2-3 minuti, senza ricaricare la pagina visibile.

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
2. Copia `.env.example` in `.env` e completa i valori. La service role key resta solo su questa macchina e non va mai esposta al frontend.
3. Installa il worker:

   ```powershell
   cd worker
   npm install
   ```

4. Avvia Chrome con un profilo dedicato:

   ```powershell
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\ChromeListingRadar"
   ```

5. Accedi manualmente a SISTER e al gestionale, lasciando entrambe le schede aperte. Imposta `SISTER_TAB_MATCH` e `CRM_TAB_MATCH` con una parte stabile di titolo o URL.

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

1. ricerca del nominativo tramite codice fiscale;
2. verifica di foglio, particella e subalterno tra gli immobili collegati a quel nominativo;
3. creazione o aggiornamento dell'immobile soltanto se necessario;
4. preparazione di un'attività con stato **Da eseguire** e descrizione **Inserire attività**;
5. matching dei recapiti Excel tramite codice fiscale e aggiunta dei recapiti mancanti;
6. controllo finale dei soggetti collegati e delle quote di comproprietà.

Se il gestionale restituisce più schede per lo stesso codice fiscale, il job passa a `needs_review`. Apri manualmente la scheda cliente corretta nei risultati del gestionale e premi **Riprendi lavorazione**: la scheda aperta viene usata come scelta esplicita.

Ogni step viene registrato prima e dopo l'esecuzione. Anche gli elementi già elaborati all'interno di uno step vengono conservati: in caso di arresto, **Riprendi lavorazione** continua dal primo elemento non concluso senza ripetere quelli completati. Pausa e ripresa richieste dalla dashboard modificano solo Supabase: la web app non controlla Chrome.

Gli screenshot vengono creati solo per pagine non riconosciute, sessioni scadute o messaggi inattesi, e vengono rimossi dopo `ERROR_SCREENSHOT_RETENTION_DAYS`.
