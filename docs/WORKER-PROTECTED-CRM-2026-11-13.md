# Worker 0.34.42 — schede protette e attività

La coda Rossini osservata nell'archivio online contiene 19 immobili, modalità
attività killer, 3 accantonamenti e zero completamenti. Due checkpoint sono a
verified senza activityEvidence: lettura incompleta dello storico, non copertura
mensile dimostrata. Un altro è a property_synced per comproprietario non
confermato. Il checkpoint interrotto dall'operatore è a property_resolved.
Questo non certifica l'assenza di scritture precedenti sulle anagrafiche; non
sono stati effettuati annullamenti CRM o nuove scritture live per questa consegna.

Mancava una classificazione esplicita IM/NT/IN e la barriera prima delle
scritture. Ora l'identità letta conserva recordKind. Notizia, incarico e tipo
sconosciuto sono vietati dall'adattatore. Il controllo viene eseguito dal motore
prima di ogni stadio, prima delle anagrafiche tramite i candidati della coda,
anche in ripresa. Aggiornamento immobile, sostituzione collegamenti e attività
ricontrollano il tipo nell'adattatore immediatamente prima dell'operazione.
Non è sufficiente che la ricerca abbia restituito un URL /immobile/.

Una corrispondenza NT/IN già identificata dalla ricerca viene accantonata prima
del piano. Se non è dimostrabile che sia una scheda IM ordinaria, nessuna
scrittura viene autorizzata. La cache non sostituisce la rilettura del tipo.

Lo storico delle attività gestisce il dialogo aperto da Visualizza tutto; prima
cercava solo un nuovo article e restituiva incompleto. Il motore ripete una
lettura incompleta prima di accantonare l'attività. L'assenza non è dedotta da
una risposta fallita: senza lettura completa resta da verificare, mai coperta.
Conservate le regole: attività sull'immobile nel mese corrente, oppure attività
del cliente inserita oggi; nessuna finestra mobile di 30 giorni. Le prove
richiedono Task, collegamenti e data di creazione. Nessun nuovo criterio
mensile per il cliente è stato introdotto.

Le diciture principali del Worker V2 e della scheda in corso usano lavorazione,
invece di importazione; ID tecnici e formati di archivio restano compatibili.

Verifiche: 120 test in nove suite; due ulteriori casi browser IN/NT verificano
che non si apra l'editor attività e che non avvenga alcun salvataggio. Test del
motore su incarico, notizia e tipo sconosciuto: zero chiamate di scrittura per
persone, merge, immobile, soggetti correlati e attività. Fixture del dialogo
storico completa; compilazione desktop e prova Electron in profilo temporaneo.
Il comportamento sullo storico reale Rossini dopo la correzione non è stato
osservato direttamente; una lettura ancora incompleta resta segnalata e non
viene aggirata con un inserimento non verificato.
