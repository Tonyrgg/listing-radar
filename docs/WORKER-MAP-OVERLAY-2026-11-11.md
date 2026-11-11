# Worker 0.34.33: scheda sovrapposta alla mappa

La mappa resta della stessa larghezza quando si apre una via. Il dialog usa show()
e non showModal(): non rende inerte il canvas Leaflet e non cambia il layout.
La sidebar si sovrappone a destra (massimo1120px,76vw al desktop). Escape e pulsante
di chiusura rispettano la protezione delle modifiche non salvate. Hover e click
sulle altre vie restano disponibili. Una preview non cambia la via cui appartiene
la selezione corrente; la ricerca con scheda aperta passa dal controllo choose().

Gli identificativi principali hanno etichette e valori distinti: civico, piano,
tipologia catastale, foglio, particella, subalterno. Il codice catastale originale
resta visibile. Tipologie non mappate e dati non rilevati restano espliciti.
Nessun cambiamento alle scritture CRM o alla sincronizzazione.

Collaudo Electron isolato: mappa di identica larghezza a scheda aperta/chiusa,
dialog non modale, identificativi visibili, selezione, intestatari, coda, query,
riepilogo, nessun overflow a1440/1024/390px, nessun errore pagina.
Collaudo coda persistente: selezioni multivia, correzioni, filtri e import simulati
riusciti. Screenshot estratti con rete disabilitata per rendering deterministico:
eventuali tile vuote nelle immagini di test non sono prova di un guasto alla mappa.
Anteprima HTML separata con mappa reale e80righe illustrative:30tile caricate,
zoom, selezione e filtri verificati. Nessun dato di prova scritto nel profilo reale.

Suite Worker completa:121file,994test riusciti con due processi paralleli.
