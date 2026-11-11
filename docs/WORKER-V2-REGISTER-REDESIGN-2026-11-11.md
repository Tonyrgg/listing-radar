# Worker V2 — registro compatto, 0.34.32

Applicati i principi del redesign Listing Radar: gerarchia, registro leggibile,
approfondimenti separati, azione principale riconoscibile e tema verde scuro.

- Schede via, coda e query in un pannello ampio a tutta altezza, con ritorno alla mappa.
- Righe immobili: indirizzo, civico/piano, catasto, intestatario principale,
  confronto CRM e ultima evidenza di import.
- Intestatari completi, contatti, dati originali, storico e correzioni in sezioni
  espandibili. Avvisi delle scritture pendenti sempre visibili.
- Coda con totali distinti: presenti, selezionabili, non selezionabili. Selezione,
  opzioni e avvio rimangono passaggi separati.
- Query con filtri a sinistra e risultati a destra; disposizione verticale sulle
  finestre piccole. Stesso registro usato da vie e coda.
- Barra persistente per i comandi della selezione. Handler, protezione delle
  modifiche non salvate e recupero delle sezioni aperte conservati.

Nessuna modifica alle regole di acquisizione/import, conteggio attività o sync.
La build include le correzioni precedentemente distribuite nella 0.34.31.

## Verifica

Compilazione desktop e territorio superata. Collaudo Electron della coda:
filtri combinati, correzioni permanenti, selezioni, accodamento da query,
riavvio, rimozioni, riepilogo, avvio e recupero superati. Solo profili sintetici
temporanei, senza contattare i servizi operativi.

Suite CI: 769 test superati al primo passaggio; due timeout di avvio Chrome
durante carico concorrente. Rieseguiti i due file separatamente: 9 test passati,
inclusi i due scaduti, per 771 test distinti verificati complessivamente.

`scripts/register-visual-check.mjs`: interazioni nel vero renderer Electron
isolato, acquisizione simulata, apertura intestatari, selezione, coda,
riepilogo e query. Nessun overflow a 1440/1024/390px e zero errori renderer.
Le catture GPU delle finestre nascoste si bloccavano: le anteprime sono ricavate
dal DOM Electron effettivo con gli stessi CSS in Chrome headless. Sono immagini
di fixture, non di dati reali. Artefatti in `.runtime/worker-register-design/`;
altre verifiche in `.runtime/territory-queue-check/`.

L'installazione locale della 0.34.31 era ferma alla richiesta UAC. La sola
pubblicazione della 0.34.32 non prova che il PC l'abbia installata.
