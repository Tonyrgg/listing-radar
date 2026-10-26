# Radar — disponibilità degli atti comunali

Verifica del 26 ottobre 2026, tramite HTTP pubblico, senza controllo di mouse
o tastiera. Le due schede prima segnalate come «struttura cambiata» restituiscono
in realtà una pagina HTTP 200 con l'avviso di atto non disponibile o non più
in pubblicazione. Non si deduce quale delle due cause si applichi.

| Identificativo pubblico | Albo | Archivio Atti |
|---|---|---|
| 10532771 | Dettaglio non consultabile | Dettaglio non consultabile |
| 10559996 | Dettaglio non consultabile | Dettaglio non consultabile |

Fonti: [atto 10532771](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio/-/papca/display/10532771),
[atto 10559996](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio/-/papca/display/10559996),
[Archivio Atti](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti).
Il collegamento all'archivio è stato ricavato dal menu pubblico e il percorso
dei dettagli dai link effettivamente pubblicati nella prima pagina.

## Correzione

`parseAlboDetail` riconosce l'avviso esplicito nella superficie degli errori
del portale e produce `AlboDetailUnavailableError`, codice
`PUBLICATION_UNAVAILABLE`. Un formato sconosciuto continua a produrre l'errore
di struttura; un dettaglio valido rimane leggibile anche con un avviso accessorio.
Il comando di rilettura primaria registra il codice nella diagnostica e mantiene
la proiezione verificata precedente. Non vengono rimossi documenti, riscritti
giudizi o inventati fatti dall'avviso.

Nessun recupero attraverso l'archivio viene dichiarato riuscito. Non è stato
aggiunto un fallback che continui a richiedere inutilmente gli stessi due atti.
La successiva consultazione potrà ritentare il normale indirizzo pubblico;
l'indisponibilità osservata non è considerata definitiva.

## Verifiche

Quattro regressioni sulla disponibilità, sulla distinzione dal formato ignoto
e sulle risposte valide con avviso. Suite web completa: **716 passati, 25 saltati**,
76 suite passate e due saltate. ESLint mirato, TypeScript nella build e build
Next passati. Nessuna migrazione e nessuna modifica ai documenti di produzione.

Evidenze locali: `.runtime/albo-recovery-2026-10-26/summary.json` e
`archive-probe.json`. I file HTML grezzi restano locali e non sono committati.
