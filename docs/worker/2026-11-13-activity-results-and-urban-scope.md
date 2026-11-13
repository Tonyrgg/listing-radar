# Worker 0.34.45 — risultati delle attività e perimetri urbani

## Comportamento

- Un'attività con prova CRM verificata viene conteggiata come lavorazione riuscita anche se la verifica dei soggetti correlati resta aperta. Il checkpoint dei soggetti rimane incompleto; il problema compare separatamente nei risultati e nello storico.
- Il recupero dei vecchi risultati richiede la stessa prova, lo stesso piano attività e un checkpoint temporalmente appartenente alla run. Non basta un invio del salvataggio.
- Una coda terminata rimuove le proprie iscrizioni, comprese quelle accantonate. Run, motivi e checkpoint rimangono conservati; dallo storico si possono ripreparare i casi da verificare. Le iscrizioni nuove dello stesso immobile non vengono rimosse.
- La scheda coda consente di aprire Chrome di lavoro. Il click sullo sfondo chiude i pannelli con una breve animazione; il controllo sulle correzioni non salvate resta attivo.

## Ambito geografico

Fonte: ISTAT, località abitate 2021, Comune 072011, tipo centro abitato, Bitonto, Palombaio e Mariotto. Archivio: https://www.istat.it/storage/cartografia/basi_territoriali/2021/Localita_21.zip

Non sono confini amministrativi comunali né una certificazione della situazione urbanistica attuale. L'utente ha richiesto i perimetri dei tre centri abitati.

`scripts/prepare-urban-scope.py` produce dati riproducibili dalle geometrie sorgenti senza alterarle. Su 1161 geometrie: 449 esterne vengono escluse dalla gestione attiva; 93 vengono ritagliate. I dati storici restano conservati. Le vie prive di geometria e gli identificativi non presenti nel catalogo derivato restano da localizzare, non vengono classificati arbitrariamente. I nuovi cataloghi richiedono la rigenerazione della maschera.

La maschera viene riapplicata al caricamento, al recupero online e alle modifiche locali. L'avvio di una via esterna è rifiutato e la coda di acquisizione Sister non la propone.

## Vistocasa

Il dettaglio ora legge le coordinate dei campi hLat/hLng, con validazione, e conserva la provenienza. Un punto pubblicato non viene promosso a coordinate esatte o a civico verificato.

L'annuncio 9161 era già presente nel mercato. È stato aggiornato con una lettura positiva del solo dettaglio: riferimento descrittivo all'affaccio su Piazza Marconi e coordinate pubblicate. Nessuna assenza, uscita o vendita dedotta da questa operazione. Il riferimento a un affaccio non dimostra l'indirizzo d'ingresso.

## Verifica

Test mirati: calendario attività, conteggio con soggetti ancora da confermare, recupero dei risultati storici, coda, query, più postazioni, maschera urbana e adapter Vistocasa. Le verifiche Electron usano profili temporanei e una copia dell'archivio, senza scritture CRM reali. Il test automatico non sostituisce la verifica di una futura coda reale dopo l'aggiornamento.
