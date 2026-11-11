# Affidabilità delle letture, 11 novembre 2026

## Problema riscontrato

Run GitHub 43014090021: 8 lavori completati, 4 falliti, 6 differiti. Garofalo
restituisce 403 dal runner; Momento Casa timeout/503. La mail globale di GitHub
non descrive il numero delle singole fonti riuscite. Run precedenti su Node22
si interrompevano per la sintassi import.source di wasm-feature-detect;
il workflow corrente usa già Node24 e l'ultima run non presenta quel crash.

## Cambiamenti

- Qualsiasi errore di dettaglio o persistenza degrada la lettura; non si usa più
  la tolleranza del 10% per chiamarla sana. Nessuna valutazione delle assenze
  con errori o inventario incompleto, anche se il risultato del baseline lo consente.
- La percentuale salvata conta le osservazioni effettivamente persistite:
  normalizzare un dettaglio prima di una transazione fallita non equivale a salvarlo.
- Gli errori di fonte contengono la diagnostica HTTP; 401/403 rimandano il retry
  di almeno un'ora, gli altri inventari falliti di almeno cinque minuti.
  Restano fallimenti visibili; non si cambiano in successi per eliminare le mail.
- Resoconto GitHub per agenzia con conteggi, stato, completezza e permesso di
  valutare assenze. Errori non gestiti nel fetch restano nei log di errore.
- Intelligence e mappa distinguono il momento di elaborazione della vista dalla
  lettura dei portali. Mostrano un avviso espandibile per fonti fallite, parziali,
  mai lette o con ultima lettura più vecchia di 24 ore. Un precedente stato
  HEALTHY non basta a dichiararle attuali; una run PARTIAL prevale su quello stato.
- Il lettore OCR vive in un processo separato, riutilizzato e serializzato. Un
  crash del motore non termina il drainer. Una lettura bloccata viene interrotta
  dopo45secondi; il processo fallito viene terminato e ricreato alla foto successiva.
  L'indisponibilità di questa verifica richiesta degrada la run e blocca le assenze.
- I job attivi della stessa agenzia e dello stesso tipo condividono la chiave
  anti-duplicati, indipendentemente dall'origine UI, cron o fan-out. I completati
  non impediscono la scansione successiva. I vecchi job non vengono cancellati.

## Verifiche reali

Probe di tutte le nove fonti abilitate, inventari completi e un dettaglio in zona
per fonte: 7 inventari HEALTHY, 2 incompleti (Studi Santi, Studio Casa).
Questi ultimi restituiscono 403 sul primario e 500 su alcune pagine del catalogo
pubblico secondario. Nessun inventario parziale è stato certificato completo.
Triocasa non viene interrogato.

Seconda prova dei cataloghi pubblici: Studi Santi85/85, Studio Casa54/54,
entrambi completi e sani. I500 sono intermittenti. I primari restano403 e il
catalogo secondario non autorizza mai le assenze sul sito primario.

Giro GitHub43088446022 completato SUCCESS: Garofalo39/39 in due job preesistenti,
Momento2/2, zero errori. Nessun jobRUNNING residuo. La duplicazione osservata
fra il job manuale e quello automatico ha motivato la chiave unica comune.
Prova reale OCR locale su immagine sintetica VENDUTO: riconosciuta correttamente
nel processo isolato; terminate correttamente anche le prove di crash e timeout.

Recupero ordinario da questo PC, nessun job RUNNING al controllo iniziale:
- Garofalo: run 83a11dcd-4e12-489a-870b-bb59b1300dab, 39/39 normalizzati,
  36 in zona, 3 esclusi, zero errori.
- Momento: run e47b28ef-93c9-4f95-9555-eef7541260cb, 2/2 in zona, zero errori.
- Entrambe HEALTHY, complete, nessuna valutazione assenze autorizzata dal baseline.

## Limiti aperti

Il recupero locale non ripara il 403 remoto né garantisce che server terzi
restituiranno sempre risposte valide. Nessun proxy o aggiramento di challenge.
Le fonti sono tornate leggibili nelle prove finali; ciò non garantisce la loro
disponibilità futura. Nessun secondo scheduler installato e nessuna protezione
di accesso aggirata. Le nuove run mostrano e conservano le indisponibilità.
I nove dettagli campionati non certificano l'intero archivio: la provenienza,
la data e l'incertezza della fonte restano necessarie.

## Prove locali

467 test Property Lifecycle riusciti, 24 integrazioni saltate perché il relativo
database isolato non è attivo; test aggiuntivi di recupero OCR e anzianità fonti riusciti. TypeScript,
ESLint sui file modificati e build Next.js riusciti.
