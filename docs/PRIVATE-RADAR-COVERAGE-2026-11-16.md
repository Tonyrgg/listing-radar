# Radar privati: copertura effettiva — 16 novembre 2026

I due annunci Immobiliare.it 133655902 e 116014055 sono stati aggiunti con il bridge V2, senza scrivere nell'archivio legacy. Riletti ACTIVE, sellerType private, rispettivamente 250000 e 240000 euro. Provenienza MANUAL_PUBLIC_PAGE: pagina primaria recuperata tramite indice pubblico; HTTP diretto 403. Nessuna data di aggiornamento promossa a data di prima pubblicazione. Il secondo ha una corrispondenza potenziale da verificare, senza fusione automatica.

Correzione della diagnosi precedente: la vecchia copia C:/Users/ruggi/listing-radar non conteneva il collector attuale. Il main dispone già di cinque collector e workflow orario: Idealista, Immobiliare, Casa, Subito, CasaDaPrivato. Le prime tre fonti erano DEGRADED/403 nell'ultima osservazione, le altre due leggibili. L'orario configurato non dimostra l'effettiva esecuzione ogni ora: il report evidenzia anche controlli più vecchi di due ore.

Aggiunti:
- `scripts/private-radar-add-urls.ts`: accodamento idempotente di URL dei cinque portali; accetta lista JSON con --file=percorso, dry run di default, --apply e --confirm-project per scrivere. Non inventa fatti né dichiara verificati gli URL. Usa la stessa lease del collector.
- `scripts/private-radar-coverage.ts`: riepilogo in GitHub Actions di salute, aggiornamento, pagine e stato degli URL conosciuti. I conteggi non certificano copertura totale.
- Una paginazione interrotta o ciclica degrada la salute della fonte.
- La provenienza delle verifiche manuali resta conservata nei successivi aggiornamenti della pubblicazione.

Prova alternativa Bing RSS: risposta 200, ma zero URL di annunci pertinenti per tutte le cinque fonti. Non collegata al collector perché non dimostra un incremento reale di copertura.

Limiti aperti: nessuna copertura totale, nessuno sblocco dei tre 403, nessun nuovo collector Wikicasa/Bakeca/Facebook. L'accesso ai dettagli bloccati richiede un canale leggibile (feed autorizzato, avvisi, oppure acquisizione delle pagine effettivamente accessibili dal browser). Lo scopo personale non modifica la risposta tecnica del portale. Nessuna assenza inferita dalle letture fallite.

Verifiche: 7 test unitari passati, typecheck web passato, intake URL in dry run, report letto contro database reale, entrambe le pubblicazioni rilette dopo inserimento e refresh del Radar.
