# CoreImmobiliare — consegna locale del 25 ottobre 2026

Il ciclo riguarda implementazioni e prove locali dei quattro moduli. Le postazioni note sono tre; non sono stati eseguiti censimenti o audit delle postazioni.

## Stato e risultato

W01, W02, R01, C01–C04, T01–T02 e V01–V02 sono implementati localmente.
L01 è predisposto ma il collaudo autentico è bloccato dal motore Docker non avviato.
D01 documenta la consegna e aggiorna Notion. Le attività dichiarate concluse hanno prove locali: nessuna validazione commerciale o installazione distribuita è implicata.

Il launcher ha iniziato W01/W02, poi la sandbox Windows della CLI ha restituito CreateProcessWithLogonW 1909 e ha impedito comandi/scritture. Il suo processo è stato terminato e il lavoro è proseguito nella sessione già autorizzata, mantenendo i permessi invariati. Il launcher conserva ora un blocco globale di infrastruttura e richiede una ripresa esplicita dopo il ripristino. Lo stato riporta quali task sono stati conclusi dalla sessione corrente.

## Worker — W01 e W02

- Diagnostica identificata da job, codice, immobile e proprietario; replay e record storici senza proprietario gestiti senza sopprimere anomalie distinte.
- Identità CRM comune in `worker/src/core/crm-record-id.ts`: equivalenza Salesforce 15/18, case-sensitive, altri identificativi integri.
- Ogni nuovo import V2 conserva la propria prova sulla run nella transazione di completamento: itemId, ID immobile/CRM, data, piano ed evidenza dell’attività.
- Il riepilogo usa la prova congelata della run; un import successivo non riscrive lo storico. Le prove insufficienti e i vecchi import senza prova restano non confermati.
- La sincronizzazione unisce le prove per singolo import e conserva i conflitti.

Verifiche: 52 test mirati finali, compilazione Worker e desktop. La prima suite completa ha avuto 4 timeout browser e un timeout di chiusura; le cinque suite interessate sono passate in riesecuzione seriale (133 test). Non è una prova su SISTER/Tecnocloud reali. Versione distribuita non cambiata; nessuna release.

## Listing Radar — R01

`scripts/seller-review-report.mjs` verifica manifest/hash, identità del campione, ID univoci, metadati del giudizio e dimensioni esplicite.
Il generatore e il validatore usano la proiezione comune `seller-review-template.mjs`.

Il pacchetto congelato del 19–20 ottobre contiene 83 voci: 50 identità, 20 opportunità, 10 venduti e 3 notizie. Il rapporto eseguito legge zero giudizi compilati e non inventa precisioni.
L’indipendenza è conteggiata solo se il revisore dichiara `prediction_seen=false`; non viene certificata dal programma.
Giudizio globale, prezzo richiesto, prezzo di transazione, scomparsa e vendita restano distinti. Nessun peso o database è modificato.

```powershell
npm.cmd run core:review -- --input=<pacchetto-congelato> --output=<nuova-cartella>
```

## Richieste — C01–C04

- Stati delle consegne espliciti: un esito ignoto, fallito o in attesa non diventa “inviato”. I successi MOCK sono etichettati come simulati.
- Pagine da 50 pratiche, conteggio e ordine stabile per prossimo passo/ID; aperte e chiuse preservate. Il browser ha attraversato 151 pratiche sintetiche senza duplicati.
- Riferimenti di provenienza congelati: modulo, tipo/ID, fonte, osservazione, data originale eventualmente ignota e firma delle prove.
- Collegamenti a property V2 soltanto espliciti, con motivazione; nessun merge di identità e nessuna riattivazione del CRM legacy.
- Appuntamenti fissati e svolti distinti; misure cumulative per fonte/campagna ricevuta. Nessun passaggio intermedio dedotto e nessuna attribuzione paid inventata.

Migration 0047 e 0048 con permessi per proprietario, RPC autenticate, replay e gestione dei cambi di prova. Le date note solo al giorno conservano quella precisione, senza inventare un’ora.

## TonyBook — T01 e T02

`scripts/tonybook-session.ts` legge i quattro CSV secondo intestazioni versionate, conserva ID, scarti/rifiuti e storia dei cambi di firma.
Supporta virgolette, virgole, nuove righe e Unicode. La data di importazione non diventa data originale del contenuto.
Scrive un nuovo snapshot privato e riepilogo; non modifica i CSV sorgenti.

```powershell
npm.cmd run core:tonybook -- --input=<cartella-CSV> --output=<nuova-cartella-privata>
# Per conservare decisioni precedenti:
npm.cmd run core:tonybook -- --input=<cartella-CSV> --output=<altra-cartella> --previous=<registry.json>
```

È stato provato soltanto con fixture sintetiche; i CSV personali non sono stati migrati o copiati nel repository.

La migration 0049 e la pagina privata `/richieste/segnali` preparano una verifica da un segnale attivo selezionato.
Firma e stato sono ricontrollati; scarti e utenti diversi sono respinti. Un replay non riapre una pratica chiusa.
Una prova cambiata richiede una selezione aggiornata e crea un nuovo contesto congelato.
Il percorso non genera recapiti, contatti, WhatsApp o messaggi Facebook.

## VAB — V01 e V02

La migration 0050 aggiunge esclusivamente un trasporto MOCK:
claim/lease, tre tentativi, ritardo, ricevuta idempotente e recupero da risposta persa.
La richiesta resta salvata se la notifica fallisce.
Chiusura, Non contattare e revoca del canale impediscono nuove consegne; i successi passati non sono cancellati.
L’attivazione della coda simulata richiede una funzione riservata al servizio; il default resta BLOCKED e nessun cron è aggiunto.
Non esiste un provider esterno configurato.

`meta-fixture.ts` verifica HMAC sul corpo grezzo, estrae ID stabili e mappa solo campi/scelte configurati.
Mancanze e ambiguità sono respinte; un opt-in WhatsApp assente resta falso e nessuna qualifica venditore è assegnata.
La modalità supportata è solo `fixture_only`: non c’è chiamata Graph, app collegata, mapping del modulo reale o endpoint webhook pubblico.

Riferimenti primari consultati:
- [Esempio Meta: firma dei webhook](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/CONTRIBUTING.md#webhook-verification).
- [SDK ufficiale Meta: campi Lead](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/lead.js).

Le pagine ufficiali su Webhooks e recupero lead hanno risposto HTTP 429 nella sessione. Permessi, configurazione, notifiche reali e mapping del modulo richiedono ancora una verifica sul caso effettivo (H03).

## L01 — Auth/PostgREST autentici, predisposti ma non collaudati

`scripts/check-seller-auth-local.mjs` prepara un progetto Supabase distinto:
ID `coreimmobiliare-seller-e2e`, API 55421, DB 55422, Next 3149.
Copia configurazione e migration, disattiva seed/servizi non necessari, non copia .env o un collegamento remoto e non esegue reset.
La variante --run verifica il motore locale, avvia soltanto il progetto dedicato e usa utenti/recapiti sintetici.

Il percorso predisposto comprende Auth reale, PostgREST, ingresso Next, due utenti, revisione concorrente, Server Action in browser e soppressione.
Config e sintassi sono state verificate. L’esecuzione è terminata prima dell’avvio perché il motore Docker locale non risponde.
**Nessun risultato end-to-end autentico viene dichiarato.**

```powershell
npm.cmd run core:auth:prepare
# Dopo disponibilità del motore Docker locale:
npm.cmd run core:auth:check
```

Le credenziali del progetto locale restano in memoria e non vengono stampate; nessun database o volume storico viene resettato.
L’ambiente autentico rimane il passaggio tecnico aperto prima di valutare un rilascio.

## Prove finali e artefatti

- Suite web: **699 passati, 25 saltati**, senza collegamenti a produzione.
- TypeScript, ESLint dei file modificati, build Next e design check passati.
- Worker: 52 test mirati finali e compilazioni passati; suite browser ritentate con un solo worker: 133 passati.
- Launcher: 10 test su sequenza, stato, ripresa, report e blocchi infrastrutturali.
- Browser con componenti reali e SQL PGlite: 390/1024/1600 px, nessun overflow; persistenza, opposizione, selezione TonyBook e navigazione di 151 pratiche.
- Screenshot e risultati: `C:/Users/ruggi/listing-radar-validation/2026-10-25-core-sequence-ui-final/`.
- Rapporto campione Radar: `C:/Users/ruggi/listing-radar-validation/2026-10-25-review-report/`.

Il browser harness sostituisce routing, autenticazione e trasporto delle Server Action: non sostituisce L01.
I dati delle schermate sono sintetici e non descrivono la situazione reale di S007/S008.

## Gate esterni invariati

H01: giudizi umani Radar. H02: titolare/informativa/conservazione VAB non definiti.
H03: modulo/app/provider reali. H04: rilascio, deploy, migration online, attività CRM/Facebook e campagne.
Nessuna migrazione 0046–0050 è stata applicata online. Nessun messaggio, spesa, contatto o aggiornamento dei PC è stato eseguito.
