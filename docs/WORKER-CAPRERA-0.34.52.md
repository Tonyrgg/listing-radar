# Worker 0.34.52 e riepiloghi Intelligence — 17 novembre 2026

## Caso reale ricostruito, senza scritture CRM

Memoria condivisa, run 1287655d-3797-4c12-bfa2-e326467039d4: avviata il 16 novembre alle 16:20:18 UTC e interrotta alle 19:28:21 UTC. Totale 55, gestiti 38, import/prove finali zero e skipped 38. Nei checkpoint risultano 21 invii con risposta di salvataggio e ID Task: 21 Task distinti, 21 clienti distinti, nessun cliente con più ID. Questi sono salvataggi da verificare, non successi finali e non elementi sui quali non sia avvenuta alcuna scrittura. Diciassette immobili non sono stati ancora esaminati. La precedente UI chiamava terminata anche la run interrotta.

Non è stato disponibile il Chrome autenticato dell'ufficio. Nessuna scrittura, attività di prova o modifica ai checkpoint utente è stata eseguita. La rilettura reale dei 21 Task deve avvenire dal CRM autenticato; i contatori non sono stati promossi artificialmente a successo.

## Correzioni

- La verifica del Task salvato apre Visualizza tutto: l'anteprima 0+ può escludere le attività completate. Cerca lo specifico ID salvato, anche se il primo frammento non comprende la descrizione.
- I campi dello stesso Task provenienti da risposte diverse vengono confrontati dopo un merge per ID; mai unione di attività diverse. Sono riconosciuti i campi custom Cliente/Soggetto, senza confonderli con OwnerId/CreatedById; associazioni discordanti bloccano la conferma.
- Fallback DOM per etichette Lightning e data di creazione. La scadenza ActivityDate non sostituisce CreatedDate. Le vecchie attività con data di creazione certa precedente alla finestra utile non richiedono l'apertura di ogni dettaglio.
- Un salvataggio già inviato e con ID passa direttamente alla verifica; non rifà due storici completi per poi tornare sul medesimo salvataggio. La prova già confermata dello stesso piano non viene ricreata se restano problemi sui soggetti correlati.
- Un preflight immobile per esecuzione al posto del ritorno alla scheda prima di ogni stadio di lettura. I controlli su notizie/incarichi rimangono nelle singole operazioni di scrittura. Ricerca nominativo riusata soltanto se appena fatta nella stessa esecuzione, con validità massima 60 secondi; le riprese da disco rileggono l'identità.
- Ampliate le etichette ammesse del pulsante Filtri, mantenendo la scelta univoca. La prima ricerca live resta catastale, già presente nel provider.
- Storici incompleti conservano le ragioni specifiche: data, relazione, stato, elenco o discordanti. Nessuna assenza viene dedotta da una lettura fallita.
- Riepiloghi: attività confermate, già coperte, salvataggi da verificare e immobili non completati restano separati. Le run interrotte sono etichettate come interrotte. Rimangono regole mese/immobile e giorno/cliente, lock condiviso, divieto di reinvio incerto, protezione notizie/incarichi e dati catastali ambigui.

## Intelligence

Per le ricevute vecchie, che conservavano solo un hash, il riepilogo recupera il confronto dalle osservazioni salvate della stessa pubblicazione, alla data della ricevuta e dopo di essa. Mostra campi, prima/dopo, data e fonte; include i metadati aggiunti e gli eventi commerciali registrati. Non confronta annunci di agenzie diverse per inventare un prima/dopo. Le variazioni solo tecniche senza differenze dei campi letti non diventano nuovi avvisi. Se non esiste un confronto documentabile il pannello generico ripetuto non viene mostrato; la ricevuta non è confermata automaticamente.

Prova su cinque annunci Ad Maiora con ricevuta del 16 novembre 16:04 UTC: ricostruiti tipologia, pin escluso, verifica WordPress, classe energetica e, dove presente, variazione dei riferimenti della galleria. Non viene inventata una variazione di prezzo.

## Verifiche

Worker: build TypeScript, 849 test CI in 117 suite passati; 121 test mirati di motore, attività e browser passati. Il caso simulato 0+ nasconde il Task completato fino a Visualizza tutto; il caso di risposte separate conferma solo il medesimo ID. Le regressioni verificano che non si scriva su notizie/incarichi, su clienti diversi o su esiti incerti. Allineate le fixture vecchie alla coda svuotata a fine run e ai guard di protezione già presenti: nessun allentamento delle protezioni production.

Web: 736 test in 98 suite, TypeScript e lint mirati passati; prova Playwright desktop/mobile con ricevuta legacy, confronto reale nel pannello, chiusura con conferma, errore 503 recuperabile e nessun errore JavaScript. Fixture API per UI, nessun avviso utente segnato come letto durante la prova. Build e gate del pacchetto distribuito registrati nella consegna.

Non viene dichiarata una nuova velocità misurata sul CRM reale: sono eliminate letture e navigazioni ridondanti, ma il tempo effettivo richiede la prova sulla postazione autenticata.
