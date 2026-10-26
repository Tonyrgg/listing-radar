# Listing Radar — fonte Elenco Pratiche generale

## Risultato

Implementato un lettore pubblico circoscritto per [Elenco Pratiche del Comune di Bitonto](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche). Il comando qualifica un campione e produce un rapporto senza oggetti liberi, nominativi o recapiti. Non è collegato allo scheduler o al database: **zero scritture, fatti e notizie creati**.

```powershell
npm.cmd run core:radar:protocols -- --output=.runtime/report-protocolli.json --limit=20
```

Il file di destinazione deve essere nuovo. Nessuna credenziale è necessaria. Usa soltanto query SQL di lettura dell'API CKAN ufficiale: massimo 30 gruppi recenti, 30 con parole pertinenti e cinque senza data. Le richieste sono sequenziali e hanno timeout e limite dimensionale. Non scarica il CSV completo degli 85.601 record.

## Fonte osservata

Risorsa `3f1b7588-60e2-449a-9c13-c369a65c0631`; metadati aggiornati il 22 ottobre 2026. Il conteggio resta 85.601 righe; i cinque uffici esatti selezionati contano 2.630 righe. La data più recente dichiarata fra questi uffici è **16 settembre 2026**: l'aggiornamento dei metadati non rende recenti i singoli procedimenti.

Le colonne sono applicazione, numero pratica, oggetto, data e numero protocollo, ufficio. Non ci sono campi strutturati per indirizzo, catasto, stato autorizzativo o URL del documento originale. Un riferimento nel testo libero non diventa automaticamente un collegamento territoriale verificato.

## Prova reale circoscritta

| Risultato del campione mirato | Numero |
|---|---:|
| Gruppi con tutti i campi selezionati uguali | 45 |
| Righe di origine rappresentate | 184 |
| Ripetizioni rappresentate nei gruppi | 139 |
| Gruppi da conservare senza approfondimento delle trasformazioni | 34 |
| Gruppi con menzioni da approfondire sul documento originale | 11 |
| Gruppi privi di data | 5 |
| Corrispondenze di applicazione, pratica e protocollo già in archivio fra gli 11 | 4 |
| Allegati primari già collegati a quelle corrispondenze | 0 |

Il campione unisce 20 gruppi datati più recenti, 20 selezionati per parole pertinenti e cinque senza data. **Non è rappresentativo dell'intero registro.** I gruppi non equivalgono a immobili, trasformazioni avvenute o opportunità commerciali; le ripetizioni non dimostrano da sole un errore del Comune.

I sette gruppi senza corrispondenza di identificativi non sono sette nuove notizie. Il confronto è stato di sola lettura; nessun collegamento o merge salvato. Per gli undici manca la prova primaria consultabile: il registro non conferma il rilascio del titolo o l'esecuzione dei lavori.

## Filtri implementati

- Selezione degli uffici esatti; niente corrispondenza generica con «territoriale».
- Data del protocollo distinta dall'osservazione; null in fondo alla selezione recente, più un campione separato senza data.
- Richieste di accesso agli atti, idoneità abitativa e numerazione civica non promosse a trasformazioni.
- Una nuova costruzione «a destinazione abitativa» non viene trattata come cambio d'uso.
- Frazionamento, cambio d'uso e menzioni di edificabilità o successione rimangono candidati documentali, mai eventi confermati. Nessuna eredità personale dedotta.
- Duplicati esatti accorpati solo con identità amministrativa completa nel qualificatore; dati diversi e righe prive di identificativi rimangono distinti. Le aggregazioni SQL contano righe con tutti i campi uguali, senza affermare l'unicità del procedimento.
- Il rapporto conserva hash e identificativo della riga sorgente per poter ritrovare la descrizione, senza copiarne i dati personali. Nessuna URL primaria viene inventata dal numero pratica.

## Condizione per integrare la fonte

Prima occorrono una via pubblica e verificabile al documento primario e un collegamento deterministico a luogo/pratica. Poi si possono leggere gli atti pertinenti e riusare le regole V2, mantenendo la distinzione fra richiesta, autorizzazione e lavori eseguiti. Senza queste prove la fonte rimane uno strumento di ricerca assistita: nessun backfill o notifica automatica.

## Collaudo

Sei nuove regressioni automatiche: accessi amministrativi, prova primaria richiesta, descrizioni generiche, date nulle/impossibili, duplicati e identità mancanti, uffici e conteggi. ESLint e TypeScript passati. Suite complessiva: **728 passati, 25 saltati**, 78 suite passate e due saltate. Prova live del comando e confronto circoscritto con l'archivio completati; questi risultati non sono giudizi commerciali umani sul dossier.
