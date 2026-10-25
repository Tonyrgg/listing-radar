# Richieste e verifiche — consegna locale, 25 ottobre 2026

> **Aggiornamento CoreImmobiliare:** la consegna successiva aggiunge migration
> 0047–0050, paginazione, provenienza, appuntamenti svolti, segnali TonyBook,
> outbox con trasporto MOCK e adattatore Meta solo fixture. Tutto resta locale.
> Il collaudo Auth/PostgREST autentico è predisposto ma bloccato dal motore
> Docker non avviato. [Risultati e limiti](COREIMMOBILIARE-LOCAL-DELIVERY.md).

## Decisione operativa

Intelligence conserva i fatti e le decisioni sulle notizie. La nuova area privata
`/richieste` conserva il lavoro successivo: richieste di telefonata ricevute e
verifiche documentali esplicitamente pianificate. La vecchia area `/acquisition`
continua a rimandare a Intelligence: nessuna riattivazione del CRM storico.

Una notizia interessante **non** crea un contatto. Dopo averla segnata Interessante
si può scegliere **Pianifica una verifica**: la pratica conserva riferimento,
firma delle prove e lacune, senza nome, telefono o proprietario dedotti. Il replay
riapre la stessa pratica senza cancellare una chiusura o riscrivere il contesto
congelato. Per rileggere eventuali prove cambiate si torna a Intelligence.

Le richieste inbound hanno recapiti e risposte dichiarati, ancora da verificare,
attribuzione ricevuta e versione dell'informativa. Non ricevono qualifica automatica.
Gli esiti registrabili sono contatto avvenuto, appuntamento, valutazione e incarico,
con nota e storico. Una pratica aperta deve avere un prossimo passo datato.
Gli esiti restano dichiarazioni dell'operatore: il sistema non prova che siano avvenuti.

## Stato effettivo

- Migration `0046_seller_workbench.sql`, non applicata in produzione.
- Tabelle dedicate `seller_cases`, `seller_case_history`, `seller_delivery_outbox`.
- Letture e funzioni operative isolate per proprietario tramite RLS e `auth.uid()`.
- API `POST /api/seller-intake`, solo per un connettore server fidato in locale.
  Non è il webhook Meta: verifica della firma Meta, recupero Graph e mapping del
  modulo reale devono essere implementati e collaudati dopo scelta/configurazione.
- Il quiz esterno già esistente resta una simulazione: nessun collegamento pubblico.
- Notifica operatore e conferma WhatsApp registrate atomicamente come **BLOCKED**.
  Nessun dispatcher/provider è collegato, nessuna consegna viene dichiarata riuscita.
  Senza opt-in WhatsApp non esiste neppure la relativa iscrizione in coda.
- Chiusura/Non contattare annullano le consegne pendenti. Un replay non le ricrea.
  Non contattare non è riapribile da questo flusso.
- Contatori privati: ricevute, contatti, appuntamenti, valutazioni, incarichi;
  verifiche documentali separate. Ogni passaggio conta casi distinti nello storico,
  anche se poi chiusi; non misura causalità o redditività della campagna.

## Collaudo locale

L'utente ha confermato che titolare, informativa e conservazione non sono definiti.
La raccolta reale e la pubblicazione restano quindi fuori da questa consegna.

Usare un **database locale separato e nuovo**, seguendo le istruzioni iniziali del
manuale. Non resettare il volume storico di questa macchina. Applicare le migration
al solo progetto locale di collaudo; non usare `supabase db push` verso il linked
project per questa prova. Creare un account sintetico e copiare il suo ID in
`SELLER_INTAKE_OWNER_ID`. Impostazioni locali:

```text
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
AUTH_REQUIRED=true
SELLER_INTAKE_LOCAL_ENABLED=true
SELLER_INTAKE_OWNER_ID=<UUID account locale>
SELLER_INTAKE_TOKEN=<segreto locale casuale di almeno 32 caratteri>
```

Configurare le normali chiavi **del progetto locale** in un file escluso da Git.
Avviare `npm.cmd run dev`; accedere e aprire `/richieste`. Inviare il JSON sintetico
`tests/fixtures/seller-inbound.json` con un client HTTP locale, header
`Content-Type: application/json` e `Authorization: Bearer <segreto locale>`.
Il token è server-to-server: non inserirlo nel quiz o nel codice browser.

Risultati: primo invio 201; replay identico 200 e stesso ID; stesso ID con risposte
diverse 409, originale conservato; input non valido 400; token errato 401;
corpo oltre 12 KB 413; ingresso spento, database remoto o runtime production 503.
Niente lettura lead da questa API. Limite misurato sui byte realmente ricevuti.

Test ripetibili, senza `.env` reali o contatti esterni:

```text
npx.cmd vitest run tests/seller-intake.test.ts tests/integration/seller-workbench.test.ts
npm.cmd run build
npx.cmd tsx scripts/check-seller-workbench-ui.ts --output=<cartella prove locale>
```

Il collaudo browser usa i componenti effettivi e PostgreSQL PGlite, ma sostituisce
trasporto delle Server Actions, routing e autenticazione Next con un harness locale.
Non è un test con Supabase Auth/PostgREST reali né una prova di ricezione Meta o
consegna WhatsApp. QA a 390/1024/1600 px, errore recuperabile, salvataggio e reload.

## Validazione commerciale

Pacchetto locale: `C:/Users/ruggi/listing-radar-validation/2026-10-25-review-operativa/`.
Include 50 casi identità, 20 opportunità, 10 venduti e 3 notizie, congelati al
19–20 ottobre. `LEGGIMI.md` contiene indice/fonti; `review.json` conserva giudizi
vuoti; `detected-separate.json` tiene separate le previsioni del motore.
Nessun giudizio umano è stato inventato e nessun peso ricalibrato.

Il comando `scripts/seller-review-pack.mjs` legge soltanto snapshot locali e rifiuta
di sovrascrivere una cartella esistente. Per generare una nuova revisione:

```text
node scripts/seller-review-pack.mjs --input=<snapshot mercato> --news=<final.json triage> --output=<nuova cartella>
```

## Nuova fonte: esito del gate SUAP

La [pagina ufficiale Bitonto](https://www.impresainungiorno.gov.it/en/comune?codCatastale=A893)
è stata ricontrollata il 25 ottobre: sportello 3683, elenco pratiche ed export CSV
dell'ultimo mese dichiarati; accesso all'elenco con CAPTCHA. La scheda
[Notion della fonte](https://app.notion.com/p/40008221b79d8124810cec8cf26ee142)
conserva già lo stesso limite: campi ricavati dal modello generale, non da un
campione riga-per-riga di Bitonto.

Esito: **non integrabile come fonte ricorrente verificata in questa sessione**.
Prima serve un export ufficiale acquisito manualmente o un accesso stabile
consentito, con righe Bitonto datate, indirizzi e vocabolario degli oggetti.
Nessun bypass CAPTCHA, schema di CSV inventato, nuovo crawler o fonte attivata.

## Residui prima dell'uso reale

Titolare/informativa/retention; modulo Meta definitivo e mapping; webhook firmato e
permessi; provider e template WhatsApp, gestione STOP e numero; notifiche operatore;
test completo su staging con account e dati interni autorizzati; revisione umana
dei campioni; deploy/migration espliciti. Nessuna campagna o spesa avviata.

## Verifiche eseguite in questa consegna

- Vitest completo: **675 passati, 25 saltati**; 66 file passati e 2 saltati.
- Typecheck web, ESLint, build Next.js e `design:check`: riusciti.
- PostgreSQL/PGlite: replay identico e discordante, isolamento di letture/RPC,
  revisioni concorrenti, vincoli del prossimo passo, storico degli esiti e metriche
  per utente, soppressione persistente e cancellazione delle consegne pendenti.
- Pianificazione notizie: firma della valutazione controllata in SQL. Il collaudo
  isolato sostituisce soltanto il validatore delle notizie già esistente; non
  dichiara un nuovo test live delle fonti né della catena di tutte le migration.
- Browser sui componenti reali: 390, 1024, 1600 px; nessun overflow, errore
  recuperabile, data corrente conservata, modifica salvata e riletta dopo reload;
  chiusura Non contattare e assenza della possibilità di riaprire in UI.
- Due pagine Notion aggiornate e rilette: spec Intelligence V2 e setup Vendere
  a Bitonto. I documenti precedenti sono mantenuti come storico con nota iniziale
  che distingue questa implementazione locale dall'attivazione pubblica.

Tutti i test sono sintetici o su snapshot pubblici congelati. Nessun database
production interrogato o migrato durante questa consegna, nessun rilascio worker,
push, campagna o invio esterno.
