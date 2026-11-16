# Ad Maiora: doppio controllo e schede conservate — 16 novembre 2026

## Raccolta e qualità

Ogni dettaglio Ad Maiora viene confrontato con il record pubblico WordPress identificato da ID e URL coincidenti. Si raccolgono date GMT, indirizzo, prezzo e prezzo precedente dichiarato, dimensioni, locali/bagni, tipologia, zona dichiarata, classe energetica, caratteristiche, planimetrie/allegati e riferimenti della galleria. La foto principale ha un ulteriore controllo tramite il suo endpoint media. I campi WordPress proprietario, contatti privati e note private non vengono acquisiti; titoli fotografici non diventano identità del proprietario o civici.

Le discordanti HTML/WordPress/JSON-LD sono conservate, senza sostituire automaticamente il dato visibile con quello tecnico. La pubblicazione sul sito resta distinta dall'inizio dell'incarico. Le coordinate del publisher sono escluse per tutti gli annunci Ad Maiora, anche dai fallback JSON-LD. L'indirizzo rimane disponibile per localizzazione/correzione; non vengono inventate coordinate o civici mancanti. La persistenza esistente protegge le posizioni già confermate manualmente.

Il catalogo pubblico dell'agenzia su Idealista è interrogato una volta per giro, con paginazione limitata a dieci pagine dello stesso profilo. L'abbinamento richiede una sola pubblicazione compatibile per via, prezzo, superficie, locali e descrizione distintiva. Soltanto allora può completare un civico o piano mancante. Duplicati/ambiguità/contraddizioni non autorizzano sostituzioni. Un HTTP 403 o CAPTCHA lascia il controllo esterno dichiarato non disponibile, senza trasformarlo in assenza del bene. Il controllo secondario non autorizza mai rimozioni: resta valido solo l'inventario primario sano e completo.

## Snapshot

Il payload normalizzato, inclusi dati supplementari, fonti e discordanti, usa la persistenza immutabile V2 già esistente. Nessuna nuova tabella o migrazione. Dalla scheda, «Ultime schede annuncio salvate» legge solo su richiesta l'ultima osservazione conservata di ogni pubblicazione, anche rimossa, senza richiamare il sito remoto. È disponibile il download JSON completo. API autenticata per account, risposta privata no-store, errori recuperabili.

Sono conservati i dati e i riferimenti delle foto. Non è un mirroring permanente di ogni file fotografico esterno: gli URL remoti possono smettere di funzionare; le anteprime rappresentative continuano a seguire la conservazione già prevista dal sistema.

## Qualificazione

734 test passati in 97 suite, TypeScript e lint mirati verdi, build Next.js riuscita. Prova Playwright desktop/mobile: caricamento differito, pubblicazione rimossa consultabile, download JSON completo, gestione errore 503 e retry, nessun errore JavaScript e nessun overflow orizzontale.

Prova live sull'annuncio 17669: pubblicazione 30 ottobre 2026 alle 10:09:23 UTC, modifica 7 novembre alle 19:57:11 UTC; via Vitale Giordano, prezzo 270.000 euro, 110 m², tre locali, due bagni visibili. Conservati 26 riferimenti fotografici e metadati della foto principale. Registrate le discordanti della classe energetica e dei bagni JSON-LD. Pin non acquisito. Idealista ha risposto 403: il civico 29 indicato nel messaggio dell'utente non è stato promosso automaticamente a civico verificato dal crawler.

Prima passata live: 45 normalizzati, 37 nel territorio e 8 esclusi; 36 osservazioni persistite e un timeout DB sul record 17179. Run parziale: nessuna assenza applicata. Seconda passata: 45 normalizzati, nuovo timeout isolato su 15498. Recupero mirato finale di 15498 e 17179: due osservazioni persistite senza errori e senza autorizzare assenze. Le run parziali restano dichiarate tali, senza riscriverne lo stato. Audit finale delle ultime schede: 37 arricchite, 37 identità WordPress verificate, 37 pin publisher esclusi.
