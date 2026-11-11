# Intelligence: venduti, individuabilità e scheduler

La scansione GitHub 42982831095 aveva completato PuntoCasa (90 normalizzati, 87 in zona, zero errori), ma sei POST_EXIT_FRESH_HEALTHY_SCAN_REQUIRED rinviati facevano fallire il drain. Il worker riconosce ora questa attesa già persistita dalla coda senza dichiarare un errore generale. Gli altri errori continuano a fallire il workflow.

La classificazione SOLD_GRAPHIC verificava gli URL, non il testo nei pixel. Aggiunta OCR locale Tesseract italiana sulla copertina durante scansioni rapide/profonde, abilitata nel workflow. Solo righe esplicite VENDUTO/VENDUTA/SOLD e confidenza >=75; il risultato entra nelle prove di vendita già supportate. Non è una prova del rogito. L'archivio proietta i segnali grafici correnti come vendita probabile e li esclude dalle opportunità. Nessuna cancellazione; decisioni manuali non venduto rispettate.

Migrazione 0079 applicata online: indice base + bonus via 8, civico 12, coordinate precise 5, caratteristiche 3, massimo 25. Bonus solo per immobili con segnali già positivi; venduti a zero. Ordinamento/paginazione/filtro indice eseguiti sullo stesso valore server. Ragioni leggibili e tooltip del bonus. Verifiche REST: 84 venduti, 96 record con bonus >15, 188 opportunità dopo esclusioni.

Collaudi: PostgreSQL PGlite esegue la migrazione; verifica bonus e nessuna opportunità generata da sole caratteristiche; esclusione venduti. Test OCR lessicale e prova reale su immagine raster VENDUTO riusciti. Test del worker sul rinvio atteso riuscito. 11 test mirati passati; typecheck, eslint e build Next completati. Il riconoscimento sulle immagini già archiviate si aggiorna alla prossima scansione; non si presume riconoscimento perfetto e non sono stati modificati a mano gli esiti degli immobili.
