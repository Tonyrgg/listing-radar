# Worker V2 — Prestazioni e completezza

Stato del 25 ottobre 2026: modifiche locali, base package 0.34.25, nessuna release.
Il percorso interessato è WorkerV2Host → TerritoryApplication → LiveProvider →
TecnocloudUiV2Port / ImportV2Engine → TerritoryImportStore.

## Correzioni implementate

| Punto | Intervento | Protezione conservata |
|---|---|---|
| Controlli sessione ripetuti | Un preflight del motore per import invece di nove | L'adattatore verifica la sessione prima delle azioni CRM e delle navigazioni |
| Via conclusa con proprietari non letti | Le anomalie SISTER ritentabili lasciano la run in pausa | Riprendi conserva le righe complete e riapre le anomale |
| Cursore SISTER scritto due volte | Riutilizzato il cursore successivo già salvato con la riga completata | Il primo cursore e le transizioni con nuovi proprietari restano persistiti |
| Confronto iniziale di ID immobiliari noti | `readPropertyIdentity` legge indirizzo e catasto senza le liste proprietari | La verifica conclusiva usa ancora `readProperty`, incluse le quote |
| Letture locali nel ciclo di import | `readSelected` copia solo unità, via, checkpoint o indicatore richiesto | I risultati restano copie isolate; la selezione legge lo stato già committato |
| Misure emesse dal motore ma ignorate dal registro V2 | `TerritoryImportStore` conserva i tempi in un file diagnostico dedicato | Nessuna ulteriore serializzazione dell'intero archivio per registrare una misura |

La lettura di sola identità è opzionale nel contratto del port: gli adapter che
non la implementano conservano la rilettura completa. Un ID noto illeggibile non
diventa assente e non autorizza una nuova creazione.

Nella lettura SISTER, la fine di una riga conserva già il cursore della successiva.
L'inizio della successiva evita una riscrittura identica solo quando posizione e
chiave coincidono con il cursore appena salvato. La prova con due righe e quattro
intestatari conserva tutti gli esiti e registra una sola volta quel confine.

## Benchmark locale misurato

Fixture sintetica: 1.000 immobili e relativi checkpoint; 100 letture dello stesso
checkpoint per giro, tre giri con ordine alternato. Risultati restituiti uguali.

| Operazione | Mediana per 100 letture |
|---|---:|
| Copia dell'archivio completo, poi selezione del checkpoint | 637,723 ms |
| Selezione del checkpoint, poi copia del solo risultato | 0,219 ms |
| Differenza misurata | 637,504 ms |

È un confronto della sola lettura locale. Non misura il tempo dell'intero import
né la latenza di Tecnocloud. Il risultato grezzo è in
`C:/Users/ruggi/listing-radar-validation/2026-10-25-worker-v2-performance/local-reads-1000.json`.

Riproduzione con dati sintetici, senza aprire un profilo reale:

```powershell
npm.cmd --prefix worker run worker-v2:benchmark-local -- --units=1000 --reads=100
```

## Misure delle prossime run V2

Il file `import-v2-timings.jsonl` viene creato nella directory del profilo V2.
Contiene ID tecnici, fasi, tentativi, tipi di errore e durate; non copia nomi,
codici fiscali, recapiti, messaggi d'errore o credenziali.

- `candidate_lookup`: comprende la ricerca iniziale prima del motore, anche in
  caso di errore e successiva riprova.
- `executedStage`: identifica la fase effettivamente eseguita; `stage` è il
  checkpoint raggiunto, che può essere diverso.
- `operationDurationMs`: tempo dell'operazione e della logica della fase, esclusi
  i salvataggi `store.save` interni.
- `checkpointSaveDurationMs`: tempo di tutti i `store.save` della fase, compresi
  quelli dopo ogni nominativo e prima dell'invio dell'attività.
- `durationMs`: tempo della fase fino al checkpoint; precisione di tre decimali.
- `attempt`: numero del tentativo, conservato anche dopo un recupero riuscito.

Il comando di lettura non avvia il Worker né i portali:

```powershell
npm.cmd --prefix worker run worker-v2:timings -- "C:\percorso-profilo-V2\import-v2-timings.jsonl"
npm.cmd --prefix worker run worker-v2:timings -- "C:\percorso-profilo-V2\import-v2-timings.jsonl" --run=ID
```

Il report ordina le fasi per tempo cumulato e riporta campioni, mediana, p95,
salvataggi e categorie di errore. Distingue duplicati, righe non valide e
conflitti. `parseClean` riguarda la leggibilità del file; non certifica una run
completa né che tutti gli immobili siano stati importati. `observedItems` conta
gli immobili con almeno una misura, inclusi quelli falliti.

Limiti: i tempi non includono acquisizione SISTER, apertura del lavoro,
`loadOrCreate`, pause globali, attesa di riconnessione, salvataggi finali di
pausa/quarantena o append del log stesso. Un arresto prima dell'evento o un file
diagnostico non scrivibile può lasciare misure mancanti. In quest'ultimo caso è
emesso un avviso, mentre il checkpoint operativo resta indipendente.

## Verifiche eseguite

- 107 test in dieci suite: motore, store, memoria Cloud, misure del vero percorso
  locale, letture isolate, identità CRM, resilienza, coda, memoria e multi-PC.
- Altri 24 test in cinque suite per il cursore SISTER: acquisizione, recupero,
  portafogli V2, risultati catastali e impostazioni della ricerca. Totale di
  questo passaggio: 131 test distinti passati.
- Le due suite interessate dall'ultimo affinamento di conteggio e precisione sono
  state rieseguite: 45 test passati. Non si sommano ai 107.
- TypeScript Worker e compilazione desktop passati.
- Smoke con CRM simulato: un immobile concluso, dieci misure leggibili
  (ricerca iniziale più nove fasi). Il comando report è stato eseguito sul file.

Evidenze sintetiche correnti:
`C:/Users/ruggi/listing-radar-validation/2026-10-25-worker-v2-performance/timing-report-synthetic-final.json`
e `synthetic-profile-final/import-v2-timings.jsonl`. I file con nome precedente
senza `final` appartengono alla prima iterazione dello smoke.

## Consolidamento con suite completa

La suite completa seriale (`npm.cmd test -- --maxWorkers=1`, cartella worker)
è passata: **937 test su 937, 114 suite su 114, uscita 0**, durata 656,69 s.
Build Worker e compilazione desktop passate.

Il primo passaggio aveva rilevato tre regressioni (933 passati, tre falliti):
fixture di scansioni completate senza un elenco di risultati valido e recupero
storico che poteva chiudere una scansione con anomalie. Ora mancanza o assenza
di risultati non attestano completezza; una query validamente vuota è distinta
da risultati assenti; la riparazione storica usa lo stesso controllo e mantiene
in pausa le righe ritentabili. Le esclusioni intenzionali restano rispettate.
Prima della suite completa sono passati i 34 test mirati delle tre suite toccate;
non si sommano ai 937.

Log autorevole:
`C:/Users/ruggi/listing-radar-validation/2026-10-25-core-consolidation/worker-full-final.log`.
La prova del software non certifica la latenza o l'esito di run reali sui portali.

## Diagnosi ancora da chiudere

1. Misurare le durate reali per capire quanto pesano ricerca, nominativi,
   proprietari, attività e disco, usando solo esiti verificati.
2. Quantificare i recuperi annidati: `readAction` consente quattro esecuzioni
   della lettura e il motore fino a tre tentativi della fase. Una lettura che
   esaurisce entrambi i livelli può arrivare a dodici esecuzioni. Il costo
   operativo va misurato prima di ridurre protezioni o cambiare il budget.
3. Verificare la copertura delle righe SISTER: complete, anomale, esclusioni
   intenzionali e nominativi conservati devono avere denominatori distinti.
4. Valutare successivamente il parallelismo nel V2 operativo, che oggi usa una
   sola scheda CRM. La partizione per proprietario/immobile del percorso
   precedente è una base da adattare, non una funzione già attiva nel V2.

Questa iterazione non ha aperto sessioni reali SISTER/Tecnocloud né interrogato
Supabase di produzione. Le latenze e le cause dei blocchi reali restano da
riscontrare con dati operativi.
