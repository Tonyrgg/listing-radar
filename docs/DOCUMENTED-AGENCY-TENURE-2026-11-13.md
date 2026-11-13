# Giorni con agenzia da prove documentate

La data di inizio monitoraggio non è più usata come sostituto dell'ingresso
nell'agenzia. Il conteggio utilizza una conferma manuale o un'acquisizione con
prova specifica; in assenza, la data pubblica più antica associata a quel preciso
rapporto agenzia/immobile. Date dichiarate, articolo pubblicato, publishUp e
creazione della scheda nel sito sono accompagnati dal metodo e dal link della
fonte. Le date delle fotografie e le date di altre agenzie non vengono trasferite
al rapporto attuale. Una pubblicazione non prova il giorno di firma dell'incarico:
il valore non esatto resta «almeno». Nessuna prova produce valore sconosciuto,
anche se il monitoraggio ha una data valida.

Scheda: durata e breve provenienza in sintesi e per ciascuna agenzia. Opportunità:
colonna Giorni con agenzia, data usata sotto al numero, provenienza nel titolo e
ordinamento in database con valori sconosciuti in fondo. Un ingresso manuale
senza data non eredita la data della vecchia agenzia.

0095 crea la ricostruzione delle date e l'estensione live; 0096 la indicizza in
una piccola proiezione aggiornata con il giro di refresh Radar già esistente.
Questo evita di rileggere il grande archivio delle prove per ogni pagina.
I giorni continuano a essere calcolati in tempo reale dalla data memorizzata.
Le date manuali restano immediatamente visibili indipendentemente dal refresh.

Applicate e registrate entrambe le migrazioni. 262 rapporti con una data
ricostruita precedente alla prima osservazione. Query REST reale, 40 risultati
ordinati per giorni con agenzia: 237 ms nel singolo controllo, non benchmark.

Test: pubblicazione di marzo con monitoraggio iniziato a settembre, data assente
senza fallback, prove di agenzia differente escluse, foto escluse, date pubbliche
più antiche usate e parità dopo indicizzazione. Test formattazione e ordinamento,
typecheck e build Next webpack. Nessun cambio al Worker desktop.
