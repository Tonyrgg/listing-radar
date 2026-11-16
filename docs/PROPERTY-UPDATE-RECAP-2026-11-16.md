# Riepilogo aggiornamenti immobile — 16 novembre 2026

Il riepilogo compare in cima alla scheda immobile quando è presente un avviso «Aggiornato». La tabella mostra i campi cambiati, il valore precedente e quello attuale, con prezzi, date e stati leggibili.

Le conferme di lettura conservano ora anche i valori della versione letta. Le ricevute precedenti contenevano solo un hash: per questi avvisi la scheda dichiara che il confronto storico non è disponibile, senza inventare valori.

«Aggiornato» e «Segna come letto» confermano la versione e chiudono riepilogo e avvisi dello stesso immobile nelle viste applicabili. Una versione cambiata nel frattempo viene rifiutata con 409; un errore di salvataggio mantiene il riepilogo aperto. Le risposte di polling fuori ordine vengono ignorate. Preferiti e Notizie mantengono il comportamento esistente.

Verifiche: 720 test in 94 suite passati, TypeScript e lint mirati passati, build Next.js completata. Prova Playwright desktop e mobile: confronto prima/dopo, chiusura da entrambi i pulsanti, conservazione del pannello dopo errore 503 e nuovo tentativo riuscito; nessun errore JavaScript. API preferenze intercettata con fixture: nessuna scrittura di prova sui dati production.

Riparato anche il test dello stato letture: verifica ora il contratto della API che ha sostituito il componente inline rimosso nella consegna precedente.
