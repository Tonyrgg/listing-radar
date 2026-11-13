# Worker 0.34.44 — storico e recupero attività

Verificato in lettura sul Chrome di lavoro del 13 novembre 2026:
il pannello anteprima è «Attività e appuntamenti (0+)», il comando
«Visualizza tutto» è un anchor senza href e la lista completa si monta
in un dialogo asincrono. Il vecchio selettore includeva anche «Numero
attività di ricerca». Corrette selezione, apertura, attesa e conteggio.
Il lettore aggiornato ha restituito storico immobile completo, storico
cliente completo, zero attività, senza scritture CRM.

Un errore non globale di verifica di un soggetto secondario consente ora
di gestire l'attività separatamente, solo dopo rilettura di indirizzo,
catasto e proprietario principale. Restano i controlli mensili/giornalieri,
il blocco condiviso tra postazioni e la conferma dell'attività salvata.
Il checkpoint conserva la prova dell'attività e resta property_synced con
errore «Attività gestita; soggetti correlati da completare». Il collegamento
incerto non diventa completato e non viene cancellato o ricreato.

Caso Rossini 6: checkpoint 8,333333%, lista CRM 8%, collegamento già presente
e menu senza Modifica. La quota resta da correggere; questa release permette
di gestire l'attività anche quando tale correzione non è effettuabile dal menu.

Controlli mirati: 21 test calendario/protezione e 8 test storico passati;
compilazioni TypeScript e installer desktop riuscite. Il test di recupero
del soggetto incerto verifica una sola attività e checkpoint non completato.
Nessun invio attività reale effettuato durante le letture diagnostiche.
