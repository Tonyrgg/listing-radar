# Worker 0.34.49 — zone, export e acquisizione conservata

- Vie per zona esclude i tratti senza nome e conserva i dati originali in memoria.
- Esporta le vie visibili in un vero file Excel: prima colonna Via; località, codice, zone, numero immobili, ultima acquisizione e ricerca SISTER nelle successive. Salvataggio nativo, cancellabile.
- Le zone selezionate filtrano i tracciati colorati sulla mappa. La selezione resta attiva chiudendo il pannello; Tutte le zone ripristina la rete. Il riempimento delle zone è sotto le strade, senza intercettare clic.
- Corretto il colore neutro su inventario con totale incerto, dati SISTER conservati e almeno una lavorazione CRM: resta blu SISTER, senza inventare percentuali del denominatore.
- Via Crocifisso: run reale riletta in sola lettura, completed con handled 401, total null, checkpoint completed; non è stato modificato il ledger. I dati possono includere ulteriori osservazioni e anomalie: il conteggio non è una certificazione di completezza.

Verifiche: 4 test di appartenenza e filtro nomi; 25 test progress/gradient; compilazione desktop e installer NSIS. La selezione per zona non ritaglia la geometria delle vie che attraversano più zone: il tracciato resta riferito alla via intera.

Controllo UI mirato passato: selezione zona persistente dopo chiusura ed export corrispondente alle righe visibili. Il vecchio controllo globale worker-v2-visual-check si interrompe su un selettore storico `[data-operation="scan"]` non presente: non è stato dichiarato passato.
