# Stato delle letture in modale — 16 novembre 2026

Rimossi i riepiloghi inline da Intelligence e Territorio, eliminando i due vecchi componenti ArchiveFreshness e PrivateRadarStatus. Tutte le viste Intelligence (incluse Notizie) e Territorio hanno il pulsante Stato delle letture nelle azioni a destra dell'intestazione.

La modale separa aggiornamento archivio, agenzie e portali privati. Le agenzie mostrano il riepilogo e le fonti da verificare; i portali hanno colonne per stato, ultimo controllo e URL raccolti. Un link apre la pagina completa Fonti.

La route autenticata /api/source-status viene chiamata soltanto aprendo la modale o con Aggiorna; nessuna query di stato nel caricamento iniziale delle pagine. Le sezioni non disponibili restano distinguibili e gli errori interni del database non vengono esposti. Un aggiornamento fallito conserva l'ultimo risultato visibile. I dati sono di sola lettura, senza modifiche a record o impostazioni.

Accessibilità: dialog nativo, titolo associato, chiusura Esc, pulsante e clic esterno, ripristino focus, caricamento/stato di errore e layout mobile con scorrimento interno delle tabelle.

Verifiche: TypeScript, lint modifiche e build Next riusciti; 3 test route (autenticazione, payload ordinato e fallimento parziale); browser a 1600 e 390 px con controllo richiesta lazy, centratura, refresh fallito, Esc/focus, pulsante su Notizie e Territorio, nessun errore JavaScript. Nel test UI la risposta della route è simulata per coprire anche guasti e stati incompleti.
