# Sito: anzianità, avvisi e preferiti — 16 novembre 2026

## Consegnato

- Il Worker è stato pubblicato prima delle modifiche del sito: 0.34.49 e completamento geometrico 0.34.50. Download binario completo verificato per entrambe.
- Le liste dei privati danno priorità all'anzianità pubblica documentata, con ordinamento predefinito per giorni. Nella stessa cella sono visibili i giorni da quando li seguiamo. Una data pubblica assente è resa con un trattino, senza spacciare zero giorni di monitoraggio per età dell'annuncio.
- Date italiane numeriche e testuali, e date sorgente Subito senza timezone, sono normalizzate esplicitamente. Per timestamp senza timezone si conserva solo precisione di giorno. Non sono accettati giorni inesistenti o date future.
- La data di aggiornamento Immobiliare è distinta dalla prima pubblicazione. Può provare soltanto che l'annuncio esisteva già: età espressa come minimo, con fonte e spiegazione nel dossier. La data di ordinamento/ripubblicazione Subito ha lo stesso limite; non è un inizio incarico.
- Il bridge aggiorna la prima presenza pubblica quando trova una prova precedente, senza perderla nelle riletture successive. I due annunci manuali sono stati riletti dopo aggiornamento: 10 agosto e 17 ottobre come limiti di presenza, non date certe di prima pubblicazione.
- Avvisi interni per Mercato, Opportunità, Privati, Usciti/Venduti e Notizie: contatori per vista, campana globale deduplicata per immobile, marcatori nuovo/aggiornato e Segna letti per record o vista. Nuovo significa non ancora letto da questo account. Prezzi/stati/indirizzi/dati rilevanti entrano nella firma; i soli heartbeat di lettura non generano notifiche.
- Preferiti con stella nelle righe e nei dossier, e tab dedicata. Preferiti e ricevute di lettura sono persistiti sotto chiavi dell'account autenticato in app_settings; niente localStorage e nessuna nuova tabella. Le preferenze vengono richieste in background al caricamento, al focus e ogni 60 secondi. Il rilevamento condiviso è in cache per 60 secondi.
- Usciti e Venduti hanno una tab comune; gli esiti e il filtro restano distinti. Gli URL storici della vista venduti sono ancora validi.
- Notizie mostra tutte le notizie candidate/review documentali senza filtri o azioni personali di valutazione; gli atti classificati come solo contesto restano nell'archivio storico. Nessuna decisione storica viene cancellata.
- Copertura fonti e freschezza sono riepiloghi compatti espandibili.
- Esporta Excel disponibile anche nella lista web Vie per zona, con gli stessi filtri di zona, ricerca e acquisite.

## Verifiche e limiti

Suite web completa: 706 test in 90 suite, verde. TypeScript e lint dei componenti/route modificati. Prova browser locale a 1600 px e 390 px: stella, ricevute notifiche, notizie senza triage, nessun errore JavaScript. In questo controllo interfaccia le risposte delle preferenze sono simulate; autenticazione/ownership, anti-CSRF e persistenza chiamata al database sono coperti da test della route. Nessuna preferenza personale è stata modificata per simulare un test in produzione.

Gli avvisi coprono le viste Intelligence elencate, non ogni tabella tecnica o ogni sezione gestionale del sito. Sono consultabili nel sito, non push/email. Le date non ricostruibili restano sconosciute; non si promette l'età reale esatta senza prova.

## Canali alternativi ai 403

- Idealista: https://www.idealista.it/assistenzautenti/articoli/come-registrarsi-servizio-avvisi/ descrive ricerche salvate e riepilogo email dei nuovi annunci; https://www.idealista.it/applicazioni descrive notifiche immediate via app.
- Casa.it: https://www.casa.it/casait/faq/ descrive Salva ricerca, preferenze notifiche e MyCasa. https://www.casa.it/casait/app-annunci-casa/ descrive gli avvisi sui nuovi annunci.
- Strada proposta: ricerche per i tre centri, tipi immobiliari e vendita; acquisizione degli avvisi originali e coda URL V2, più acquisizione dell'inventario storico da pagine effettivamente leggibili nel browser dell'utente. Gli avvisi non certificano tutto il pregresso e la data email non è la data iniziale dell'annuncio.
- Il parser email è già presente nel repository, ma il percorso storico non equivale a un'ingestione diretta e completa in V2. Non è stata attivata qui una nuova sottoscrizione ai portali, né una lettura automatica della sessione personale.
- I 403 restano espliciti; nessun aggiramento di challenge e nessuna copertura completa dichiarata.

Aggiunte due regressioni: un errore nella lettura opzionale del dettaglio date non nasconde il registro principale; un errore nel registro principale continua a essere segnalato, senza fingere un archivio vuoto. Entrambe passate.
