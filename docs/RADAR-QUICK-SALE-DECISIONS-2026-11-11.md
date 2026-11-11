# Correzioni rapide dell’esito della vendita

## Comportamento

In scheda immobile, Correzione dati contiene tre azioni: Venduto, Non venduto,
Da verificare. La nota è facoltativa e va compilata prima del clic. Il pulsante
registra direttamente la decisione, mostra il salvataggio in corso e comunica
il risultato. In caso di errore non mostra una conferma presunta.

Venduto produce subito classificazione SOLD_CONFIRMED, stato immobile SOLD,
indice operativo zero e uscita dalle opportunità. La scheda assume il contesto
Venduti anche se aperta inizialmente dalle opportunità; un link apre la lista.
Liste, dossier, fatti territoriali e mappa leggono lo stesso esito. Le opportunità
storiche vengono conservate e non presentate come azionabili per immobili venduti.

La data registrata è quella della conferma manuale. Non è una data effettiva
di compravendita; il prezzo finale non viene inventato. Pubblicazioni e riscontri
originali restano conservati, compresi annunci ancora presenti sui siti.

## Implementazione

Migrazione 0087: RPC service-only, invocata solo dopo autenticazione server.
Un’unica transazione blocca la property, registra l’override con autore/motivo e
precedente decisione, aggiorna lo stato canonico e aggiunge l’evento storico.
Un errore in qualunque passaggio annulla tutto. Nessuna chiamata al vecchio
ricalcolo pesante durante il salvataggio. Le decisioni precedenti restano
immutabili e vengono superate esplicitamente.

La vista radar_property_live_archive applica le decisioni correnti alla proiezione
indicizzata con join leggeri. Non serve aspettare il refresh globale di un minuto.
Il salvataggio invalida subito cache Lifecycle, Intelligence, mappa e dossier.
Le cache sono versionate per evitare il riuso delle proiezioni precedenti.
Le osservazioni delle fonti non vengono riscritte come se confermassero la vendita.

## Verifica

- PGlite: passaggio immediato da opportunità a venduti senza refresh della
  materialized view, indice zero, data effettiva sconosciuta, fonte ancora ACTIVE.
- Correzione successiva Non venduto, catena delle decisioni e validazione stato.
- Errore forzato nel salvataggio evento: rollback completo di override e property.
- Action: una sola RPC, autenticazione, invalidazioni delle pagine e nota conservata;
  errore RPC senza falsa conferma o invalidazioni premature.
- Letture database collegato dopo migrazione: mercato 430 ms, opportunità 458 ms,
  venduti 314 ms; mappa completa 708 immobili in 832 ms.
- 466 test superati in 44 suite, build production ed eslint superati.
- Nessun immobile reale marcato venduto a scopo di prova. Le transizioni sono
  collaudate su fixture isolate. Verifica visuale interattiva non eseguita.
