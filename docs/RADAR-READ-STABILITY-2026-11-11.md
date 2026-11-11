# Stabilità delle letture — 11 novembre 2026

## Causa verificata

Le richieste PostgREST hanno un limite di 8 secondi. La vista
`market_observer_graph_property_archive` ricostruiva contesti e aggregati di tutti
708 immobili anche per estrarre una pagina di 41 righe. Letture reali da 8–12
secondi terminavano con `canceling statement due to statement timeout`.
Anche la vista di base, senza il bonus geografico, impiegava circa 6,5 secondi:
rimuovere quel bonus non sarebbe stata una soluzione sufficiente.

EXPLAIN ANALYZE del caso ridotto: esecuzione 4.063 ms, pianificazione 327 ms.
Riletture ripetute di evidence e snapshot e scansioni di properties per ciascuna
property rendevano il costo dipendente dall’intero archivio. La mappa aggiungeva
almeno dodici richieste sequenziali da 64 record, più due proiezioni separate.
L’endpoint health controllava una tabella differente e poteva dichiarare sano un
servizio il cui archivio andava in timeout. Il database era circa 364 MB: questo
malfunzionamento non derivava dal superamento dei 500 MB.

## Correzione

- Migrazioni 0083–0085: proiezione materializzata indicizzata, con tutti i 708 ID
  conservati. Gli archivi originali e le scelte manuali restano la fonte.
- Trigger leggeri a livello di istruzione sulle dipendenze marcano il riepilogo
  da aggiornare; nessuna ricostruzione pesante sul percorso delle scritture.
- pg_cron controlla ogni minuto. Ricostruisce solo dopo modifiche o al cambio del
  giorno, così le anzianità restano aggiornate. Refresh concorrente e atomico:
  letture disponibili durante il calcolo, versione precedente conservata se fallisce.
- Revisione sorgente catturata prima del calcolo: scritture concorrenti restano
  segnalate per il passaggio seguente. Un lock impedisce refresh sovrapposti.
- Liste, ordinamento €/m², notizie e mappa leggono la proiezione. Nessun download
  dell’intero archivio per ordinare una pagina. Mappa in lotti da 1.000.
- Cache condivisa di un minuto per le liste; gli errori vengono propagati e non
  memorizzati come risultati vuoti. La cache Next non sostituisce l’autenticazione.
- Documenti e mappa hanno confini Suspense distinti; anche il dossier mostra le
  informazioni principali senza attendere gli approfondimenti documentali.
- Fatti del dossier filtrati per edificio nel database, senza leggere tutta la città.
- Barra indeterminata e testo durante il caricamento; data del riepilogo e avviso
  se nuovi dati attendono elaborazione. Nessuna percentuale inventata.
- Health controlla il vero archivio e riporta data, aggiornamento pendente ed errore.
- Migrazione 0086 limita a sette giorni i soli log dei nuovi job di manutenzione.

## Prove sul database collegato

- Prime letture lista completa: 174–621 ms; mappa con campi ridotti: 118–171 ms.
- Venti richieste di lista, concorrenza due: **zero errori**, 108–549 ms,
  mediana 188 ms. Sono tempi delle letture dati, non del rendering completo.
- Lettura mappa con tutti i campi effettivamente usati: **708 righe, 549 ms**.
- Metriche agenzie: 11 righe, 467 ms.
- Zero ID mancanti rispetto a properties. Accesso anonimo respinto (42501).
- Scheduler verificato realmente: revisione sorgente 2 → riepilogo 2; refresh
  completato alle 10:32:08 Europe/Rome in circa 8,9 secondi, senza errore.
- Dimensione database dopo installazione: **367.611.027 byte**, sotto 500 MB;
  proiezione e indici circa **3,55 MB**.
- Test PGlite: modifica sorgente, refresh, errore forzato di unicità e conservazione
  integrale della versione precedente. Nessun errore forzato sui dati production.
- Suite Lifecycle e integrazione: 463 test passati; build, typecheck,
  eslint dei file cambiati e git diff --check superati. Due ulteriori regressioni
  coprono il filtro documentale circoscritto al dossier.

## Limiti operativi

L’aggiornamento del riepilogo è asincrono: normalmente entro il minuto successivo
più tempo di refresh e fino a un minuto di cache web. Il timestamp rende visibile
la versione disponibile. Un’interruzione completa del provider non può essere
esclusa da questo intervento; la causa dei timeout misurati è stata rimossa dal
percorso delle letture. Non sono stati aumentati i timeout dell’API o il piano.
Nuove dipendenze SQL richiedono aggiornare i trigger; nuove colonne richiedono
aggiornare la definizione della proiezione tramite migrazione.
