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
**Pubblicato** su [GitHub Releases](https://github.com/Tonyrgg/listing-radar/releases/tag/property-worker-v0.34.26),
commit sorgente `923c0d4`. Manifest, tre parti e installer ricomposto verificati
con download completo e SHA-256. Nessuna installazione sui tre PC è presunta.

**Web distribuito** su https://listing-radar-mu.vercel.app, deployment
`dpl_DPbxvpz5o4jrrn7SS9hS3SgbDRMW`, stato READY. Smoke production passato:
health/database UP, endpoint Worker 0.34.26, pagina Richieste protetta con
redirect al login e intake pubblico disattivato (503). L'isolamento tra utenti
e le azioni autenticate sono provati da L01; lo smoke online non li sostituisce.
Report: `.runtime/core-web-2026-10-26.json`.

## Radar sui dati reali

Snapshot del 26 ottobre: **4.102 documenti e 1.328 fatti**, senza espansione
delle fonti. Il comando di rilettura primaria ora usa lo stesso binder V2 del
runtime: evita di aggiungere nuovi eventi V2 a una proiezione V1 e conserva le
prove PDF. In caso di errore della fonte conserva la proiezione verificata;
il problema resta nella diagnostica. ESLint e 77 test pertinenti passati.

Dry-run e rilettura di 12 schede Albo 2026 già note: 10 risposte elaborate,
due con struttura non riconosciuta. Rilette inoltre le due esportazioni CSV già
note: due pratiche correnti corrispondono all'archivio, nessuna nell'altra fonte.
In totale 12 proiezioni V2 (prima zero), mantenendo i conteggi
di documenti e fatti; le due proiezioni fallite sono identiche a prima e tutte
le tre prove PDF sono conservate. Nessun nuovo PDF o fonte acquisiti.
Backup semantico, piano e risultato in `.runtime/property-facts/`; verifica
in `.runtime/primary-refresh-2026-10-26.json`.

La stessa lettura della UI restituisce 12 candidati: 11 ARCHIVE_ONLY e uno
REVIEW, con quattro feedback precedenti conservati. **Zero voci nella coda
nuove**; il REVIEW è relativo a un'alienazione già aggiudicata, non a un bene
disponibile. Nessuna precisione commerciale viene dedotta da questi conteggi.
Report: `.runtime/news-live-2026-10-26.json`.

## Perimetro ancora aperto

Le prove precedenti non misurano la latenza reale Tecnocloud né certificano
la completezza di una nuova acquisizione SISTER. Non sono stati eseguiti
import CRM in questo ciclo; nessuna sessione SISTER/Tecnocloud disponibile nel
browser collegato. La nuova fonte comunale non è ancora integrata;
selezione di tutti i gruppi Facebook ed eredità restano sviluppi successivi.
VAB, invio di messaggi, provider reali e campagne non attivati; prerequisiti
privacy ancora da definire. Il campione Radar non ha giudizi umani inventati.
