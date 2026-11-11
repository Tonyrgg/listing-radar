# Worker 0.34.34 — elenco della via

La scheda acquisita apre un elenco tabellare, non una sequenza di schede espanse.
Intestazione breve, schede Immobili / Da verificare / Storico, ricerca, stato e
filtri sulla stessa barra. Colonne stabili: civico, piano, tipologia catastale,
foglio, particella, subalterno, primo intestatario e altri, stato, Apri.

Le istruzioni ripetute e il riepilogo percentuale non occupano più la testata.
Stato acquisizioni, ricerca SISTER, aggiornamento, confronto e note rimangono in
Strumenti. Strumenti e filtri sono popover e non spostano la prima riga.
I filtri avanzati attivi mostrano il numero dei criteri; le selezioni fuori filtro
restano esplicite. Il footer mostra la selezione e l'azione verso la coda.

Apri espande un solo immobile. Contatti, prove CRM, storico e correzioni rimangono
nel dettaglio; non si renderizzano i moduli di tutti gli immobili in ogni refresh.
La lista non ripete il nome della via per ogni unità; l'indirizzo originale completo
rimane nel dettaglio, nel titolo della cella e nelle etichette accessibili.
I dati assenti restano assenti; la tipologia è derivata dalla categoria catastale,
non certifica l'uso dell'immobile.

Mappa sempre full width, sidebar sovrapposta e non modale. La vista della via viene
centrata nella porzione non coperta tramite padding della camera Leaflet, senza
ridimensionare il canvas. Nessun nuovo pin preciso per le singole unità.

## Collaudo

- Copia isolata del ledger reale, senza credenziali o configurazioni di sync:
  VIA GORIZIA, 66 immobili consultabili e 26 righe da verificare. Originale non scritto.
- 1440x860: prima riga a268px, nove righe complete visibili. Niente impostazioni,
  contatti o moduli espansi all'apertura.
- Mappa di identica larghezza aperta/chiusa, dialog non modale.
- Apertura strumenti e filtri non sposta le righe; un solo dettaglio aperto;
  scroll mantenuto al refresh; nessun overflow della pagina a1440/1024/390px.
- register-visual-check: selezioni, proprietari, coda, riepilogo e query verificati.
- territory-queue-check: selezioni multivia, correzioni permanenti, filtri combinati,
  coda dopo riavvio e import simulati verificati.
- territory-quarantine-check: confronto/import, correzione e recupero dei dati
  incompleti, preservazione degli originali e tastiera delle schede verificati.
- Nessun errore pagina nei tre collaudi interattivi. Nessuna operazione CRM reale.

Screenshot e risultati completi privati in .runtime/worker-street-table,
.runtime/worker-register-design, .runtime/territory-queue-check e
.runtime/territory-quarantine-check. Le immagini con tile in caricamento sono
render ricostruiti per evitare lo stallo delle screenshot GPU di Electron nascosto.
