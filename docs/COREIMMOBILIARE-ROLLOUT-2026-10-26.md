# CoreImmobiliare — collaudo autentico e distribuzione

## Collaudo L01 concluso

Docker Desktop avviato il 26 ottobre 2026. Il progetto di prova
`coreimmobiliare-seller-e2e` usa API 55421, DB 55422 e Next 3149,
con dati esclusivamente sintetici e due account `example.test`.

Passati Auth, PostgREST, Server Action Next, isolamento RLS tra utenti,
ingresso idempotente, conflitto del replay, revisione concorrente, salvataggio
riletto dal database e opposizione. Dopo il replay della richiesta chiusa
esiste esattamente una consegna OPERATOR, ancora CANCELLED.
Screenshot ispezionato. Container del progetto isolato arrestati alla fine;
i due progetti locali preesistenti sono conservati.

Correzioni al collaudo:

- Storage resta attivo: le migrazioni iniziali richiedono `storage.buckets`.
- La 0030 è un'attivazione di soli dati che richiede evidenze storiche reali.
  Nella sola copia delle migrazioni del progetto sintetico viene sostituita
  con REMAX disabilitato. Il file originale e il controllo production restano
  intatti. La sostituzione rifiuta futuri DDL e compare esplicitamente nel report.
- Il test distingue il badge dallo stesso testo nell'opzione del modulo;
  attende lo stato persistito anziché una pausa fissa e usa una data futura.

Evidenze locali:
`.runtime/core-e2e-results/2026-10-25T23-36-28-446Z/`.
L'ora dei nomi cartella è UTC; l'esecuzione italiana è del 26 ottobre.

## Verifiche

- Web: **712 passati, 25 saltati**; TypeScript, ESLint mirato e build Next passati.
- Worker: **937 test passati in 114 suite** nel consolidamento precedente;
  nessuna modifica successiva alla logica import. Build e desktop 0.34.26 passati.
- Smoke V2 integrato passato con profilo temporaneo e CRM di prova;
  `.runtime/worker-v2-ui-check/`.
- Pacchetto 0.34.26 verificato: moduli V2 presenti, nessun file `.env` o chiave
  di credenziali nella configurazione distribuita. Installer non firmato,
  coerente con il canale locale esistente; nessuna firma certificata dichiarata.

## Backend production

Target confermato: `eqqmglsxwbsihrlecnun`.
Schema pubblico prima della modifica salvato in
`.backups/core-rollout-2026-10-26/public-schema-before.sql` (605.376 byte).
Dry-run delle sei migrazioni verificato; **0046–0051 applicate online**
senza seed, reset o riscrittura dei documenti.

Smoke REST in sola lettura passato: nuove tabelle raggiungibili dal server,
zero richieste/segnali/consegne creati, accesso anonimo alle richieste negato.
Risultato: `.runtime/core-backend-2026-10-26.json`.

## Distribuzione applicativa

Installer 0.34.26 preparato, 99.871.177 byte, SHA-256
`269bda7c31b13b4b070b5796d6e8f8a66d598c11a22658ce597bc972526c1502`.
Pubblicazione GitHub e deploy web vengono verificati separatamente dal backup
e dalla migrazione; il loro esito è aggiunto dopo l'esecuzione.

## Perimetro ancora aperto

Le prove precedenti non misurano la latenza reale Tecnocloud né certificano
la completezza di una nuova acquisizione SISTER. Non sono stati eseguiti
import CRM in questo ciclo. La nuova fonte comunale non è ancora integrata;
selezione di tutti i gruppi Facebook ed eredità restano sviluppi successivi.
VAB, invio di messaggi, provider reali e campagne non attivati; prerequisiti
privacy ancora da definire. Il campione Radar non ha giudizi umani inventati.
