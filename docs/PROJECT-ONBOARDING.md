# Manuale operativo e tecnico di Listing Radar

## 1. Scopo del documento

Questo documento è il punto di ingresso per un nuovo agente AI o un nuovo sviluppatore. Va letto prima di modificare codice, dati, migrazioni, automazioni browser o flussi operativi.

Listing Radar non è un singolo scraper. È un sistema privato composto da:

- una web app CRM e operativa;
- Property Lifecycle Radar V2 per osservare il mercato pubblico;
- Property Data Worker per acquisire dati catastali da SISTER e importarli in Tecnocloud;
- una Chrome extension per arricchimenti manuali;
- Supabase come database, coda, audit e archivio;
- job e script locali per scraping, bootstrap, matching e manutenzione.

Le fonti definitive sono, nell'ordine:

1. codice e migrazioni presenti nel branch corrente;
2. `AGENTS.md` per le regole non negoziabili;
3. questo manuale per la mappa complessiva;
4. documenti specialistici in `docs/property-lifecycle/`;
5. `PRODUCT.md` e `DESIGN.md` per intenzione prodotto e linguaggio visivo;
6. README di root e `worker/README.md` per i comandi operativi.

Quando un README storico contraddice il codice o una migration più recente, non indovinare: verificare il comportamento e aggiornare la documentazione.

## 2. Regole non negoziabili

- Non esporre, stampare o committare segreti. Tutti i file `.env*`, salvo `.env.example`, sono sensibili.
- Non collegarsi o scrivere su Supabase production senza autorizzazione esplicita.
- Le modifiche database passano esclusivamente da `supabase/migrations/`.
- Property Lifecycle V2 è stato promosso esplicitamente il 25 agosto 2026 ed è l'archivio di riferimento del prodotto. Il Listing Radar legacy è in dismissione: sei fonti agenzia sono spente perché duplicate, i portali accettano solo ciò che non è di agenzia, e le tabelle `listings` e satellite verranno rimosse a fine migrazione. Non costruire funzioni nuove sopra di esse.
- Un crawler fallito, degradato o con struttura cambiata non prova la scomparsa di un annuncio.
- Una scomparsa non prova una vendita.
- I valori confermati manualmente non devono essere sovrascritti silenziosamente.
- Per i dati operativi immobiliari il perimetro è Bitonto, Palombaio e Mariotto.
- Usare HTTP diretto quando è sufficiente; usare Playwright dove serve davvero un browser.
- La logica specifica di una fonte resta nel suo adapter.
- Fixture, mock e sample non sono prova di funzionamento live.
- Ogni modifica deve avere una verifica proporzionata al rischio.
- Non eseguire deploy, release o bootstrap live come effetto collaterale di test locali.

## 3. Utente, obiettivo e tono del prodotto

Il prodotto è un CRM privato per un flusso immobiliare operativo, usato principalmente da una singola persona. L'utente deve capire immediatamente:

- che cosa richiede attenzione;
- qual è il prossimo passo;
- quali dati sono certi, stimati o sconosciuti;
- perché il sistema propone un match, un'opportunità o una transizione;
- dove si è fermata un'automazione e come riprenderla senza duplicare dati.

Il tono dell'interfaccia è sobrio, operativo e affidabile. Evitare dashboard decorative, score opachi, gergo non spiegato e stati comunicati soltanto tramite colore.

## 4. Stack e runtime

### Web app

- Next.js 16.2.9 con App Router;
- React 19.2;
- TypeScript;
- Tailwind CSS 4 e CSS Modules dove opportuno;
- Supabase SSR e client JavaScript;
- Vitest e Playwright.

Questa versione di Next.js contiene cambiamenti incompatibili con versioni precedenti. Prima di modificare API, convenzioni o file speciali leggere la guida pertinente in `node_modules/next/dist/docs/`.

### Property Data Worker

- Node.js e TypeScript;
- Electron per l'app Windows;
- Playwright collegato a Chrome tramite CDP;
- Supabase per job, checkpoint, audit e archivi;
- Excel tramite `xlsx` per i recapiti;
- Vitest con fixture HTML e browser Chrome headless.

### Database e infrastruttura

- Supabase/PostgreSQL con RLS;
- migrazioni SQL versionate;
- Vercel per la web app;
- bucket privato Supabase `property-worker-updates` per il canale aggiornamenti del worker;
- GitHub Actions in `.github/` per i workflow presenti nel repository.

## 5. Architettura ad alto livello

```text
Fonti pubbliche / email / import browser
                 |
                 v
        normalizzazione e adapter
                 |
                 v
      Supabase: osservazioni, job, audit
          |                    |
          v                    v
 Property Lifecycle V2     Web app operativa

SISTER + Excel + Tecnocloud aperti nel Chrome di lavoro
                 |
                 v
       Property Data Worker Electron
                 |
                 v
  job/checkpoint Supabase + scritture Tecnocloud verificate
```

I due domini non vanno confusi:

- Property Lifecycle osserva pubblicazioni e ciclo di mercato;
- Property Data Worker acquisisce proprietà catastali e aggiorna il CRM esterno.

Condividono repository e principi di audit, ma non hanno lo stesso modello dati né le stesse regole di errore.

## 6. Mappa del repository

### `app/`

Route Next.js. Le aree private sono sotto `app/(private)/`.

Route principali:

- `/dashboard`: coda e sintesi legacy;
- `/incoming`: arrivi da fonti parziali;
- `/listings` e `/listings/[id]`: archivio annunci legacy;
- `/map`: Mappa Zone;
- `/lifecycle`: workspace Property Lifecycle V2;
- `/matching` e `/matching/overview`: commerciale, richieste e abbinamenti;
- `/requests`: richieste immobiliari;
- `/portfolio`: portafoglio immobiliare;
- `/reports`: report;
- `/settings`: configurazione e download worker.

API principali:

- `/api/cron/scrape`;
- `/api/cron/email-alerts`;
- `/api/import/browser`;
- `/api/map/route-snap`;
- `/api/property-worker/download`;
- `/api/property-worker/version`;
- `/api/extension/download`;
- `/api/health`.

### `src/components/`

Componenti condivisi, shell, navigazioni, mappe, matching e primitive UI. Un Server Component non deve passare funzioni o componenti React come props a un Client Component: usare chiavi serializzabili e risolverle nel client.

`src/components/sidebar-nav.tsx` può contenere modifiche operative dell'utente: controllare sempre `git status` e non sovrascriverle accidentalmente.

### `src/lib/`

- `property-lifecycle/`: adapter, bootstrap, identity, lifecycle, opportunity, building, persistenza e read model V2;
- `matching/`: motore, scoring, spiegazioni, importer e repository commerciale;
- `scrapers/`: provider del Listing Radar legacy;
- `listings/`: identità, scoring, completezza e upsert legacy;
- `map/`: query e geometrie;
- `email-alerts/`: ingest IMAP e parser;
- `supabase/`: client browser, server e service-role;
- `data/`: repository e fallback controllati.

### `worker/`

Applicazione separata con package e build propri.

- `src/adapters/sister/`: lettura SISTER e selettori;
- `src/adapters/crm/`: automazione Tecnocloud, richieste e incarichi;
- `src/adapters/excel/`: recapiti da Excel;
- `src/services/runner.ts`: orchestratore dello state machine;
- `src/services/repository.ts`: persistenza dei job;
- `src/services/sister-street-run.ts`: acquisizione bulk di una via;
- `src/services/property-activities.ts`: regole delle attività;
- `src/core/`: normalizzazione, parsing, selezione e regole pure;
- `src/desktop/main.ts`: processo Electron e IPC;
- `src/desktop/renderer/`: interfaccia locale senza accesso ai segreti;
- `src/desktop/updater.ts`: aggiornamenti privati;
- `tests/`: regressioni pure, adapter e browser.

### `supabase/migrations/`

Fonte unica dello schema. Non riordinare o riscrivere migrazioni già condivise. Aggiungere una nuova migration incrementale per ogni modifica di schema.

Le famiglie principali sono:

- Listing Radar e incoming;
- Property Data Worker e archivi CRM;
- matching e zone;
- Property Lifecycle V2, media, exit, sale intelligence e Building Intelligence.

### `docs/property-lifecycle/`

Documentazione specialistica numerata: audit, architettura, modello dati, adapter, identity, lifecycle, test, rollout, hardening e validazione live. Leggere solo i documenti pertinenti al task, ma non modificare un adapter senza consultarne il playbook e i report live.

## 7. Supabase, autenticazione e ambienti

Variabili supportate sono elencate in `.env.example`; non copiarvi valori reali.

- `NEXT_PUBLIC_SUPABASE_URL` e anon key sono usate dai client previsti;
- `SUPABASE_SERVICE_ROLE_KEY` è solo server/processo principale;
- `AUTH_REQUIRED` controlla l'autenticazione locale;
- cron, email, feed, extension e notifiche hanno segreti dedicati;
- il worker protegge la propria configurazione con `safeStorage` di Windows.

Regole:

- il renderer Electron non riceve mai la service-role key;
- cookie, token, password e header Authorization non entrano nei log diagnostici;
- i test database usano Supabase locale o un ambiente esplicitamente autorizzato;
- un reset locale si esegue con `npm run supabase:reset` soltanto dopo aver verificato che la CLI punti al progetto locale.

## 8. Property Lifecycle Radar V2

### Contratto adapter

Ogni adapter deve restituire pubblicazioni normalizzate con evidenza della fonte, identificatore esterno, URL, stato, dati immobiliari, geografia e media disponibili. La matrice delle fonti e le regole per agenzia sono in:

- `docs/property-lifecycle/04-adapter-contract.md`;
- `docs/property-lifecycle/07-source-playbooks.md`;
- `docs/property-lifecycle/13-live-validation-report.md`;
- `docs/property-lifecycle/16-live-activation-report.md`.

### Sicurezza del lifecycle

- `HEALTHY`, `DEGRADED`, `FAILED` e `STRUCTURE_CHANGED` hanno effetti distinti;
- nessun fallimento fonte chiude in massa le pubblicazioni;
- `EXIT_PENDING` precede le conclusioni post-uscita;
- `OFF_MARKET_NO_SALE_EVIDENCE` resta utile all'Opportunity Engine;
- `SOLD_CONFIRMED` richiede evidenza coerente o conferma umana;
- `RELAUNCH` non deve azzerare il true market age della PROPERTY;
- i match cross-agency dubbi vanno in review, non in auto-merge.

### Identity e confidence

Ogni score deve essere spiegabile per componenti: posizione, indirizzo, mq, vani/piano, prezzo, immagini, planimetrie, testo e tempo. `UNKNOWN` è preferibile a una precisione inventata.

## 9. Property Data Worker: modello operativo

### Browser di lavoro

Il worker usa Chrome con CDP, normalmente su `http://127.0.0.1:9222`, e un profilo persistente dedicato. Login, SPID/CIE, OTP e CAPTCHA restano manuali.

Il worker riconosce le schede tramite `SISTER_TAB_MATCH` e `CRM_TAB_MATCH`. Non avviare due worker concorrenti sullo stesso Chrome.

### State machine

Ordine corrente:

1. `ready`;
2. `sister_results_acquired`;
3. `properties_extracted`;
4. `owners_extracted`;
5. `data_normalized`;
6. `acquisition_reviewed`;
7. `properties_processed`;
8. `verified`;
9. `completed`.

I vecchi step per persona sono compatibili in ripresa e vengono riallineati al flusso property-centric.

Ogni operazione mutante deve essere idempotente o verificata prima di essere ripetuta. Dopo un click di salvataggio con esito incerto non fare un secondo click cieco.

### Ordine per immobile

Per ogni immobile:

1. caricare i recapiti di tutti i proprietari;
2. verificare o creare tutte le anagrafiche;
3. scegliere il proprietario principale con quota maggiore;
4. in caso di quota pari conservare l'ordine SISTER;
5. cercare o creare l'immobile sotto il principale;
6. creare una sola attività dalla scheda immobile;
7. collegare gli altri come `Comproprietario`;
8. salvare checkpoint e audit;
9. passare all'immobile successivo.

### Quote

Le frazioni SISTER vengono conservate nel dato originale e convertite in percentuale. Nel campo Tecnocloud la quota usa al massimo due decimali e il separatore italiano, per esempio:

- `1/2` → `50`;
- `1/3` → `33,33`;
- `2/3` → `66,67`.

### Scelta del comproprietario

La digitazione di nome e cognome è intenzionalmente lenta. Il worker attende che la lista risultati sia stabile prima di selezionare.

- il nome deve corrispondere sempre;
- se esiste un telefono raccolto, deve corrispondere anche un telefono mostrato nel risultato;
- l'ID CRM già verificato resta evidenza forte, ma non supera un nome o un telefono discordante;
- se non esistono telefoni e ci sono più omonimi, si può scegliere il primo solo come ultima risorsa, creando una nota auditabile;
- se esiste un telefono raccolto ma nessun risultato lo mostra correttamente, fermarsi in `needs_review`.

### Attività con e senza telefono

Se almeno uno tra proprietario e comproprietari ha un telefono:

- modalità: `Telefonata`;
- stato: `Da eseguire`;
- descrizione: `Inserire attività`.

Se nessun proprietario ha cellulari o fissi:

- modalità: `Contatto diretto`;
- stato: `Eseguito`;
- descrizione scelta da una rotazione fissa;
- alle soglie cumulative 7, 9, 11, 8 e 10, poi di nuovo dal principio, la descrizione è `nr`.

Le telefonate non incrementano il contatore dei contatti diretti e non usano questa rotazione. La posizione nella sequenza è deterministica nel job, così una ripresa non cambia descrizione.

### Pausa, skip e annullamento

- Pausa e skip sono richieste cooperative, visibili immediatamente nella UI.
- Il worker termina soltanto l'operazione atomica già iniziata.
- Prima dei salvataggi di attività e comproprietari controlla nuovamente pausa/skip.
- `Salta riga corrente` durante SISTER isola la riga e continua.
- `Salta immobile` durante l'import annota immobile, quote e persone esclusive; persone condivise restano attive.
- L'annullamento definitivo elimina il job e i suoi dati locali/Supabase, ma non può annullare modifiche già concluse in Tecnocloud.

### Paracadute e diagnostica

Errori isolabili su una riga vengono ritentati due volte e poi messi in quarantena. Errori globali di sessione, identità del contesto o struttura fermano il job.

Il desktop conserva fino a 200 arresti in `worker-errors.json` nella cartella dati dell'app. Ogni voce contiene:

- data e ora;
- fonte e stato;
- job e immobile quando disponibili;
- operazione;
- messaggio leggibile;
- dettagli tecnici sanificati.

Gli screenshot diagnostici sono separati, hanno retention configurabile e non devono contenere segreti aggiunti dal worker.

## 10. Long mode SISTER

### Preparazione

Per ora Comune, toponimo e testo indirizzo vengono preparati manualmente. Il desktop parte dalla pagina `Elenco indirizzi`. I comandi di preparazione automatica restano disponibili soltanto per diagnostica CLI e non sono attivati nel flusso desktop.

### Strategia corrente

La strategia primaria è `bulk_exact_variants`:

1. normalizzare la stringa inserita;
2. selezionare tutte e sole le opzioni con testo esattamente uguale;
3. escludere traverse, vie private, contrade e nomi simili;
4. per ogni identificativo esatto lasciare vuoti `numCivicoDal` e `numCivicoAl`;
5. acquisire l'intero elenco immobili restituito;
6. leggere i proprietari con paracadute per singola riga;
7. salvare un checkpoint dopo ogni variante.

Prova live del 24 agosto 2026 su `VIA TOMMASO TRAETTA`:

- due varianti testuali esatte;
- prima variante: 894 immobili dichiarati e 894 righe selezionabili;
- seconda variante: 77 immobili dichiarati e 77 righe selezionabili;
- sovrapposizione tra le righe confrontate: zero.

La scansione civico per civico e la regola dei 50 civici vuoti restano come strategia `civic_fallback` diagnostica, non come percorso desktop predefinito.

### Dry-run e run reale

- Dry-run: legge SISTER, immobili e proprietari, salva solo il checkpoint locale e non modifica Tecnocloud.
- Run reale: salva progressivamente l'acquisizione in un job Supabase; soltanto dopo il completamento e la validazione dei dati avvia l'import automatico in Tecnocloud.
- Una variante fallita non viene interpretata come vuota e mette in pausa la run sulla stessa variante.
- Una run reale incompleta resta salvata e correggibile; non avvia l'import.

## 11. Sessione SISTER

Il processo Electron esegue un keepalive silenzioso a intervallo casuale configurato, senza ricaricare la pagina visibile. Il controllo deve verificare marker autenticati e cookie applicativi.

Vincoli:

- non automatizzare credenziali;
- non trasformare una sessione scaduta in risultato vuoto;
- conservare checkpoint e cursore;
- chiedere un nuovo accesso manuale e riprendere.

Il keepalive riduce le scadenze per inattività, ma non può garantire contro revoche server, manutenzione o limiti assoluti della sessione.

## 12. Interfaccia e design system

Le fonti di design sono:

- `PRODUCT.md`;
- `DESIGN.md`;
- `src/styles/tokens.css`.

Le copie dei token in worker ed extension sono generate. Dopo una modifica ai token eseguire:

```powershell
npm.cmd run design:sync
npm.cmd run design:check
```

Regole pratiche:

- prossimo passo prima delle statistiche;
- cause e rimedi prima del dettaglio tecnico;
- focus visibile e contrasto WCAG 2.1 AA;
- desktop e mobile verificati per la web app;
- nessun placeholder presentato come dato reale;
- le icone attraversano un confine Server/Client soltanto come chiavi serializzabili.

## 13. Test e quality gate

### Root

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run design:check
npm.cmd run build
```

### Worker

```powershell
cd worker
npm.cmd run build
npm.cmd run desktop:compile
npm.cmd test
npm.cmd run desktop:visual-check
```

### Database locale

```powershell
npm.cmd run supabase:start
npm.cmd run supabase:reset
supabase db lint --local
```

Prima di un reset controllare esplicitamente che il target sia locale. Non indebolire test validi per ottenere un verde.

Una modifica adapter richiede almeno:

- unit test della normalizzazione;
- regression test con fixture;
- prova mirata sul portale live quando autorizzata e disponibile;
- controllo che errori e inventari vuoti non producano effetti distruttivi.

## 14. Build e distribuzione

### Web

`npm.cmd run build` produce la build Next.js. Il deploy non è implicito e richiede autorizzazione.

### Worker Windows

Da `worker/`:

```powershell
npm.cmd run desktop:build
npm.cmd run desktop:release
npm.cmd run desktop:verify-update
```

- `desktop:build` crea l'installer locale;
- `desktop:release` crea e pubblica sul canale privato;
- `desktop:verify-update` verifica manifest e parti senza riscaricare tutto;
- `desktop:verify-update:full` riscarica e ricompone l'installer ed è riservato a release importanti.

Prima di pubblicare:

- incrementare coerentemente la versione del worker;
- eseguire tutti i test worker;
- verificare installer e aggiornamento su una macchina pulita quando il cambiamento tocca Electron, configurazione o updater;
- non includere `.env`, configurazioni generate o dati utente nel commit.

## 15. Git e collaborazione

- Controllare branch e `git status` prima e dopo ogni intervento.
- Non usare reset distruttivi.
- Non sovrascrivere modifiche non proprie.
- Committare solo file pertinenti al task.
- Non riscrivere la storia salvo richiesta esplicita.
- Non fare merge o push come effetto collaterale di una correzione locale, salvo autorizzazione esplicita.
- Prima di una release verificare che il commit pubblicato corrisponda al binario.

## 16. Procedura per un bug in produzione operativa

1. Conservare screenshot, URL, job ID, immobile e ora.
2. Non ripetere manualmente un salvataggio dall'esito incerto.
3. Leggere `worker-errors.json`, job, step e screenshot diagnostico.
4. Riprodurre con fixture o scenario controllato.
5. Dimostrare la causa prima del fix.
6. Correggere nel livello giusto: parser, adapter, orchestratore o UI.
7. Aggiungere una regressione.
8. Eseguire gate mirati e poi completi.
9. Aggiornare questo manuale o il README se cambia una regola operativa.

## 17. Errori frequenti da evitare

- Passare componenti React/funzioni da Server Component a Client Component.
- Selezionare il primo omonimo mentre esiste un telefono discordante.
- Arrotondare la quota nel database invece che soltanto nella UI CRM.
- Contare una telefonata nella rotazione dei contatti diretti.
- Interpretare timeout o HTML cambiato come “nessun risultato”.
- Ripetere un salvataggio dopo un esito non verificabile.
- Usare il Last-Modified di una CDN come prova della data commerciale.
- Promuovere coordinate di centro zona a `EXACT_COORDINATES`.
- Auto-mergiare match cross-agency dubbi.
- Modificare i token generati invece della sorgente.
- Inserire logica specifica del portale nel runner.
- Testare una long run completa quando basta una query mirata.

## 18. Checklist prima di iniziare a modificare

- [ ] Ho letto `AGENTS.md` e le istruzioni pertinenti.
- [ ] Ho verificato branch e working tree.
- [ ] So quale runtime sto modificando.
- [ ] Ho identificato fonte di verità e confini di sicurezza.
- [ ] Ho letto i test esistenti del modulo.
- [ ] Per Next.js ho consultato la documentazione locale della versione installata.
- [ ] Per un adapter ho consultato playbook e report live.
- [ ] Ho definito come dimostrare il bug e il fix.
- [ ] Non sto usando produzione per una prova locale.

## 19. Definition of done

Un intervento è concluso quando:

- il comportamento richiesto è implementato nel livello corretto;
- gli errori sono parlanti e recuperabili;
- non sono state introdotte inferenze non dimostrate;
- esiste una regressione automatica quando ragionevole;
- i gate pertinenti sono verdi;
- la UI è stata verificata se modificata;
- la documentazione operativa non mente sul comportamento corrente;
- `git diff` non contiene segreti o modifiche estranee;
- deploy, release e modifiche production sono rimasti fuori scope se non autorizzati.
