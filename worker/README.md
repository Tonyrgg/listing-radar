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
- fermare o riattivare il riprova automatico; dopo tre tentativi falliti sullo stesso immobile, il caso viene saltato e annotato nel riepilogo;
- consultare avanzamento, lavorazioni recenti e diagnostica;
- sincronizzare l’intero archivio delle richieste immobiliari, aprendo ogni scheda in una pagina dedicata e riprendendo solo gli elementi non completati;
- aprire automaticamente gli archivi CRM delle richieste residenziali attive e degli incarichi prima di iniziare la sincronizzazione, senza richiedere una scheda già aperta;
- mantenere attiva la sessione SISTER con una richiesta silenziosa ogni 60-90 secondi, senza ricaricare la pagina visibile;
- eseguire dry-run o run reale di una via completa, interrogando in blocco ogni variante testuale esatta e salvando il checkpoint dopo ciascuna variante;
- conservare la configurazione nel deposito cifrato di Windows, senza riselezionare `.env` dopo gli aggiornamenti.

Per generare l'installer Windows:

```powershell
npm run desktop:build
```

Per creare l'installer e pubblicarlo nel canale GitHub Releases degli aggiornamenti:

```powershell
npm run desktop:release
```

Durante lo sviluppo usa l'installer locale in `worker/release/` e pubblica soltanto una versione stabile. Installer, manifesto e parti risiedono su GitHub: download dal sito e aggiornamenti automatici non consumano Storage Egress Supabase. Dopo la pubblicazione, la verifica standard controlla manifest, presenza e dimensione delle parti senza riscaricare i binari:

```powershell
npm run desktop:verify-update
```

La verifica end-to-end che riscarica e ricompone l'intero installer va riservata alle release importanti:

```powershell
npm run desktop:verify-update:full
```

L'app installata controlla automaticamente il canale ogni sei ore. L'utente può anche usare **Controlla aggiornamenti**; il download e l'installazione restano bloccati durante una lavorazione attiva. Dopo il download, **Installa e riavvia** aggiorna l'app senza richiedere la disinstallazione e conserva le preferenze cifrate in Windows.

Quando un errore tecnico transitorio riguarda un immobile identificato, il desktop esegue al massimo tre riprove a distanza di 60 secondi. Se il terzo tentativo fallisce, immobile, collegamenti e nominativi esclusivi del caso vengono marcati come saltati; i nominativi condivisi con altri immobili restano utilizzabili. Errori di identità, dati incompleti, salvataggi incerti, pause e sessioni scadute non vengono mai ripetuti automaticamente: richiedono una verifica oppure un nuovo accesso.

Durante l'acquisizione SISTER ogni riga viene verificata tramite foglio, particella e subalterno prima di aprire gli intestatari. Una risposta vuota o un errore isolabile viene riprovato due volte sulla sola riga; se resta illeggibile, la riga viene annotata nel riepilogo e la raccolta continua. Il pulsante **Salta riga corrente** permette lo stesso comportamento su richiesta. Cambio di Comune/via/civico, sessione scaduta, struttura globale non riconoscibile o identità catastale ambigua fermano invece l'intero processo: non vengono mai convertiti in skip.

Il manifesto `property-worker-manifest.json`, l'installer e le parti firmate tramite hash SHA-256 vengono pubblicati come asset della release GitHub `property-worker-vX.Y.Z`. L'app conserva localmente ogni parte valida per riprendere un download interrotto, ricompone l'installer e ne verifica dimensione e firma prima di avviarlo. Il pacchetto pubblico non contiene la service role key, percorsi personali o altre credenziali: la configurazione operativa resta nel deposito cifrato di Windows e sopravvive agli aggiornamenti.

La `0.16.0`, prima release che introduce il canale GitHub, richiede una sola pubblicazione ponte nel vecchio bucket, perché le installazioni fino alla `0.15.1` conoscono soltanto Supabase. Pubblica prima la stessa versione su GitHub, poi esegui esplicitamente:

```powershell
npm run desktop:publish-update:legacy-bridge -- --confirm-one-time-bridge
```

Il comando verifica che binario e hash coincidano con la release GitHub ed è bloccato senza conferma. Non va più usato per le versioni successive.

Stato operativo: il ponte della `0.16.0` è stato pubblicato e verificato il 29 agosto 2026. Non rieseguire il comando per questa o per le versioni successive.

## Firma digitale dell'installer

Gli installer pubblicati **non sono ancora firmati**: Windows mostra "Editore
sconosciuto" e gli antivirus aziendali, Sophos compreso, li bloccano legittimamente.
La configurazione di build, il workflow e la verifica della firma sono già pronti
nel repository e attendono soltanto il certificato.

La procedura completa, i secret richiesti e cosa comunicare all'IT aziendale sono
in `worker/CODE_SIGNING.md`.

Build firmata, solo da Windows e con le variabili di firma in ambiente:

```powershell
npm run desktop:build:signed
npm run desktop:verify-signature -- --require-windows --publisher="CN=..." "release/Property Data Worker Setup 0.29.0.exe"
```

Senza variabili di firma `npm run desktop:build` continua a produrre l'installer
non firmato per lo sviluppo locale.

L'installer viene creato in `worker/release/`. Per un singolo eseguibile portabile, senza installazione:

```powershell
npm run desktop:portable
```

La CLI rimane disponibile come strumento tecnico di emergenza.

Gli utenti possono scaricare l'installer da **Impostazioni → Property Data Worker** o dal pulsante **Scarica software** nella cabina di lavorazione di Listing Radar. L'API restituisce un redirect diretto all'asset GitHub: il binario non attraversa Supabase o Vercel e resta raggiungibile anche quando Supabase limita il progetto.

## Installazione

1. Applica `supabase/migrations/003_property_worker.sql`, `supabase/migrations/006_property_worker_archives.sql` e `supabase/migrations/008_crm_request_archive_import.sql` allo stesso progetto Supabase usato da Listing Radar.
2. Un aggiornamento conserva automaticamente la configurazione già presente nel deposito cifrato di Windows. Su una macchina nuova, apri **Impostazioni → Configurazione avanzata** e inserisci URL Supabase, service role key e percorso Excel una sola volta: il pacchetto pubblico non contiene segreti e non occorre creare un file `.env`.
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

Se Supabase risponde con HTTP 402 o segnala il superamento della quota, il worker non avvia le run che richiedono persistenza cloud: proseguire potrebbe perdere checkpoint o lasciare il gestionale in uno stato parziale. I dry-run locali della via completa possono continuare; l'interfaccia distingue questo caso da una configurazione mancante e controllo e download degli aggiornamenti restano disponibili dal canale GitHub.

## Ordine della lavorazione

Il worker acquisisce prima tutti gli immobili, i proprietari e le quote da SISTER e mostra il riepilogo. Dopo la conferma lavora **un immobile alla volta**, nell'ordine in cui è stato acquisito:

Dal riepilogo puoi anche scegliere **Salva per importarla dopo**. La ricerca resta nell'archivio con immobili, proprietari, quote e ordine SISTER; il pulsante **Importa** riparte direttamente dai dati conservati senza una nuova acquisizione. Le ricerche possono essere eliminate dall'archivio dopo l'importazione.

1. legge dal file Excel i recapiti di tutti i proprietari;
2. cerca, verifica o crea tutti i proprietari e sincronizza i recapiti mancanti;
3. sceglie come principale la quota più alta; a quote pari conserva l'ordine SISTER senza applicare preferenze anagrafiche;
4. cerca, crea o aggiorna l'immobile dalla scheda del proprietario principale;
5. crea una sola attività partendo dalla scheda dell'immobile: `Telefonata / Da eseguire` se esiste almeno un telefono, altrimenti `Contatto diretto / Eseguito` con descrizione ruotata. La preferenza desktop **Autocompila “Contatto diretto”** mantiene questo comportamento; se disattivata, anche senza recapiti lascia `Telefonata / Da eseguire / Inserire attività` per tutte le run;
6. collega gli altri proprietari come `Comproprietario`, digitando lentamente nome e cognome e richiedendo anche la corrispondenza del telefono quando disponibile;
7. compila la quota percentuale con massimo due decimali e verifica che il collegamento sia visibile;
8. salva il checkpoint dell'immobile e passa al successivo.

Se più omonimi non sono distinguibili neppure tramite cellulare, viene selezionato il primo risultato soltanto come ultima risorsa e il worker conserva una nota auditabile sul caso.

Persone già elaborate vengono riutilizzate senza duplicarle. Se il processo si interrompe, i checkpoint di persona, immobile, attività, recapiti e collegamenti permettono di riprendere il singolo immobile senza ripetere le operazioni concluse.

Una scheda nominativo già aperta viene riutilizzata soltanto dopo la corrispondenza esatta del codice fiscale e del nome. Prima di creare un immobile, il worker legge sempre la sezione **Immobili/Notizie/Incarichi**: se trova la stessa chiave catastale o lo stesso indirizzo la riutilizza; se la card dichiara immobili ma non permette di leggerli, si ferma prima della creazione per evitare duplicati.

Finché l'app desktop resta aperta, il worker richiama in background una pagina neutra di SISTER tra 60 e 90 secondi, senza navigare o ricaricare la scheda visibile. Il controllo considera valida la risposta soltanto se conserva il cookie applicativo e restituisce un marker autenticato. Non automatizza credenziali o login: se il server revoca comunque la sessione, una run lunga si mette in pausa conservando il civico e la variante esatti da cui riprendere. L'intervallo e l'eventuale URL sicuro possono essere personalizzati con `SISTER_KEEPALIVE_MIN_SECONDS`, `SISTER_KEEPALIVE_MAX_SECONDS` e `SISTER_KEEPALIVE_URL`.

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

## Acquisizione di una via completa

Prima porta manualmente SISTER fino alla pagina **Elenco indirizzi**, come nella schermata che contiene il menu delle vie e i campi dei civici. Nella scheda **Scansiona una via completa** inserisci quindi la dizione esatta già presente nel menu, per esempio `via borgo san francesco`. Il desktop non compila Comune, toponimo o indirizzo e non torna al form precedente: legge esclusivamente le opzioni attualmente visibili e applica un confronto testuale normalizzato. Vie simili, traverse e varianti private vengono escluse.

La preparazione automatica del form precedente resta disponibile soltanto per diagnostica da riga di comando tramite `--auto-prepare-search`; non è attivata dal software desktop.

Se SISTER restituisce più opzioni con lo stesso testo, ciascun identificativo viene interrogato una volta. Quando è impostato un intervallo, per esempio 165–225, lo stesso `Dal`/`Al` viene inviato a **ogni** opzione esatta; senza intervallo entrambi i campi restano vuoti. Il worker legge tutte le righe restituite da ciascuna variante e ricontrolla localmente il civico dalla stringa interna **Indirizzo**, così non dipende dall'ordine casuale delle voci o degli immobili. In caso di sequenza come `59-65-67`, conserva sempre il primo valore (`59`). La scansione incrementale e la regola dei 50 civici vuoti restano disponibili soltanto come fallback diagnostico CLI; timeout, sessione scaduta, HTML inatteso e query fallite non valgono mai come risultato vuoto.

Le lettere dei civici non vengono eliminate: `195/C` viene trasferito come `195C`. Una scheda con la stessa terna catastale, la stessa via, lo stesso Comune e il solo suffisso mancante viene riconosciuta e corretta; `195A` e `195B` non sono invece considerate equivalenti.

Il desktop offre due modalità. Il dry-run legge realmente immobili e proprietari ma non salva nel CRM. La run reale persiste progressivamente l'acquisizione in un job Supabase e avvia l'import automatico soltanto quando tutte le varianti sono concluse e i dati obbligatori superano la validazione. Durante una variante il desktop mostra fase, numero di immobile, totale e indirizzo corrente. Un checkpoint locale viene aggiornato dopo ogni variante e quando una pausa interrompe la lettura interna, come protezione tecnica del lavoro atomico. La schermata di preparazione avvia però sempre una nuova acquisizione: lavori precedenti, risultati e azioni storiche si consultano soltanto in **Cronologia**. Una variante fallita non viene mai trattata come vuota.

## Flusso sicuro iniziale

Lascia `WORKER_DRY_RUN=true` e `WORKER_MODE=assisted`. Porta manualmente SISTER sulla pagina risultati dopo aver scelto Comune, via e civico. Avvia il worker e premi Invio al prompt **Acquisisci risultati**. In dry-run il worker compila e riepiloga le modifiche, ma non preme i pulsanti finali di salvataggio del gestionale.

Per ogni titolare il flusso operativo è:

1. raccolta completa di immobili e proprietari da SISTER;
2. riepilogo visuale con immobile a sinistra, proprietari e quote a destra;
3. ricerca del nominativo tramite codice fiscale;
4. in presenza di più schede verificate con lo stesso codice fiscale, selezione casuale di una scheda esistente con registrazione della scelta nell'audit;
5. aggiornamento del nominativo selezionato senza creare un duplicato;
6. verifica degli immobili collegati al nominativo, prima per dati catastali e poi per via e civico identici;
7. aggiornamento dei dati catastali discordanti usando SISTER come fonte prioritaria;
8. preparazione di una sola attività per immobile, aperta dalla scheda immobile, con stato **Da eseguire** e descrizione **Inserire attività** quando l’autocompilazione del contatto diretto è disattivata;
9. matching dei recapiti Excel tramite codice fiscale e aggiunta dei recapiti mancanti;
10. controllo finale dei soggetti collegati e delle quote di comproprietà.

Se il gestionale restituisce più schede verificate per lo stesso codice fiscale, il worker sceglie casualmente una delle schede esistenti, conserva candidati e identificativo scelto nel checkpoint e prosegue senza creare un nuovo nominativo. La scelta resta stabile quando il singolo immobile viene ripreso dopo un arresto.

Ogni step viene registrato prima e dopo l'esecuzione. Anche gli elementi già elaborati all'interno di uno step vengono conservati: in caso di arresto, **Riprendi lavorazione** continua dal primo elemento non concluso senza ripetere quelli completati. Pausa e ripresa richieste dalla dashboard modificano solo Supabase: la web app non controlla Chrome.

Lo step attività salva inoltre un checkpoint per ogni immobile. Le modali attività vuote oppure compilate dal worker e rimaste aperte vengono annullate automaticamente; una modale con testo inserito manualmente viene invece lasciata intatta. Navigazione, rendering e preparazione del modulo vengono ritentati automaticamente prima di fermare il job. Dopo un click reale su **Salva** non viene mai eseguito un secondo salvataggio cieco, così da evitare duplicati.

Nel software desktop, **Annulla processo** arresta il runner in modo cooperativo e poi elimina definitivamente il job con immobili, proprietari, quote, step, log e screenshot diagnostici collegati. **Interrompi e conserva** mantiene invece l'avanzamento per una ripresa successiva. Le operazioni già concluse nel gestionale esterno non possono essere annullate dal worker e la finestra di conferma lo segnala esplicitamente.

Gli screenshot vengono creati solo per pagine non riconosciute, sessioni scadute o messaggi inattesi, e vengono rimossi dopo `ERROR_SCREENSHOT_RETENTION_DAYS`.
