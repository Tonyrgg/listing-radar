# Listing Radar — Supabase e ricerca dei documenti

## Consegna

Migrazioni **0052–0055 applicate online** sul progetto documentato
`eqqmglsxwbsihrlecnun`, dopo backup dello schema pubblico (648.442 byte).
Correzioni non distruttive: permessi espliciti del registro strade, tabella di
ricerca degli atti e vista privata della coda. Accesso anonimo negato verificato.

Il nuovo comando prepara e aggiorna un Supabase dedicato, ricava le credenziali
locali in memoria, esegue i test e arresta solo il proprio progetto:

```powershell
npm.cmd run core:radar:check -- --ui
```

Progetto `coreimmobiliare-radar-e2e`, API 55521 / DB 55522, Next di prova 3150.
I due database locali preesistenti non vengono resettati. È mantenuta l'eccezione
sintetica 0030 già documentata dal collaudo Seller: nessuna prova storica REMAX
viene inventata. Il runner non stampa né salva le chiavi locali.

## Fonti e classificazione

- Il registro 2025 legge APE e APG tramite il datastore pubblico regionale:
  11.577 righe, 1.161 pratiche APE e 1.631 APG nella ricognizione live. Il valore
  `null` passato all'importatore ora mantiene davvero tutte le applicazioni.
- Nuovo adapter per il registro generale: soltanto cinque uffici esatti Territorio,
  Edilizia privata, Centro storico e SUAP. Lettura completa e paginata del solo
  perimetro: **2.630 righe / 1.096 gruppi**, 166 APE e 930 APG. Protocolli dal
  30 ottobre 2021 al **16 settembre 2026**, cinque gruppi senza data valida.
- **57 gruppi** hanno temi utili per cercare documenti; i conteggi per tema si
  sovrappongono. Non sono 57 trasformazioni confermate o 57 immobili disponibili.
- Indici senza atti primari: nessun fatto ricavato dal testo libero. Le vecchie
  inferenze dell'indice vengono ricalcolate in revisione, mantenendo prove PDF
  verificate separatamente. Oggetti e nominativi non entrano nei nuovi indicatori.
- Le date amministrative conservano il giorno dichiarato: il timestamp CKAN
  senza fuso non slitta al giorno precedente. Date impossibili e protocolli
  contrastanti non producono un'identità adatta all'abbinamento.
- Accessi agli atti, idoneità abitativa e numerazione civica non popolano i temi
  delle trasformazioni. I riferimenti espliciti a edificabilità, varianti,
  lottizzazioni e piani attuativi alimentano il filtro Terreni / urbanistica.

## Pratica → atto

La pagina **Fonti → Pratiche e documenti** mostra ricerca da eseguire, atto da
reperire, allegato trovato, pubblicazione senza allegati, ambiguità e prova cambiata.
L'Albo conserva soltanto riferimenti amministrativi strutturati estratti dal titolo.
Un collegamento richiede pratica completa, numero protocollo e data coincidenti,
una sola pubblicazione compatibile e un allegato sul dominio pubblico autorizzato.

I link derivati dipendono dagli hash dei due record: se cambia la prova, la vista
nasconde il vecchio collegamento. Nessuna posizione, unità o notizia viene
trasferita dalla sola corrispondenza. Copie identiche nei due indici compaiono una
volta; dati diversi restano consultabili senza fusione automatica.

Le procedure giudiziarie possono rimanere nei record d'archivio, ma sono escluse
da questa coda, dalle nuove associazioni a edifici e dalla generazione di fatti
e notizie. Le alienazioni comunali ordinarie restano nel perimetro immobiliare.

## Prove e distribuzione

Il giro reale concluso ha portato l'archivio da 4.102 a **6.834 record**:
1.734 pubblicazioni Albo, 1.190 pratiche del registro 2024, 2.792 del 2025,
1.096 del registro territoriale e 22 documenti di catalogo PRG. I due indici
rimangono distinti dai documenti primari. Il primo tentativo di download Maggioli
ha restituito 503; il 2024 è riuscito alla rilettura, il 2025 usa ora l'API regionale.

La coda mostra **360 pratiche con temi utili** su 3.866 voci visibili. Nessun nuovo
allegato soddisfa tutti gli identificativi richiesti: 1.270 voci non hanno una
corrispondenza, 2.596 richiedono riferimenti migliori. Zero notizie confermate
generate dai due indici. Le proiezioni attuali contengono 691 eventi dopo aver
tolto le inferenze fondate sul solo registro; le prove storiche restano archiviate.

Sono verificati conservazione degli ID e dei `first_seen_at` esistenti e hash
invariato delle decisioni manuali. Nessuna nuova associazione a edifici deriva
dai due indici privi di indirizzi. Il runtime riconosce la versione della policy
per ricaricare una fonte cambiata senza aspettare la scadenza settimanale.

- Suite root: **744 passati / 27 saltati**; i test Supabase dedicati sono eseguiti
  separatamente, non conteggiati come passati quando mancano le variabili locali.
- Supabase reale isolato: **due test d'integrazione passati** per APE/APG,
  idempotenza, proiezioni senza prova, link, modifiche delle fonti, deduplica,
  terreni, esclusione giudiziaria e permessi anonimi/autenticati.
- UI autenticata reale: accesso, filtri e navigazione da Fonti verificati con
  account sintetico e Chrome headless; screenshot ispezionato.
- TypeScript, ESLint e build Next passati. Report ripetibile in
  `.runtime/radar-e2e/last-result.json`; screenshot `practice-documents.png`.
- Backup dati prima del giro reale in `.backups/radar-sources-2026-10-26/`;
  rapporti sanitizzati in `.runtime/radar-live-sync-2026-10-26.json` e
  `.runtime/radar-backend-2026-10-26.json`.

La distribuzione web esclude esplicitamente ambiente, backup, runtime locale,
cache Supabase e file del desktop tramite `.vercelignore`.

## Limiti ancora aperti

Il registro non garantisce l'accesso al fascicolo SUE né l'esecuzione dei lavori.
La disponibilità dei singoli atti va verificata nella coda. PRG e cartografia
restano contesto senza geometrie normative attribuite automaticamente a unità.
OMI resta consultazione manuale: non è stato automatizzato il download autenticato.

Fonti: [registro 2025](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche-edilizie-2025),
[registro generale](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche),
[SIT / PRG](https://comune.bitonto.ba.it/it/page/sit-sue-e-prg).
