# 2025 territorial data search

Ricerca metodica del 20 ottobre 2026. Nessun arricchimento da persone, oggetti
liberi o protocolli. Nessuna richiesta inviata all'ente.

| Fonte ufficiale controllata | Metodo | Risultato |
|---|---|---|
| [Catalogo Maggioli](https://www.opendata.maggioli.cloud/api/3/action/package_search?q=Bitonto&rows=100) | package_search, 55 dataset e relativi resource URL/formati | Annuali edilizi espliciti 2024 e 2025; non trovati 2023/22/21/20 o precedenti nel catalogo consultato |
| [Package 2025](https://www.opendata.maggioli.cloud/api/3/action/package_show?id=eec7cd4f-6059-433d-82ee-e09b9f881064) | package_show completo, risorse, metadata, allegati dichiarati | Una risorsa CSV; nessun XLSX/export territoriale alternativo dichiarato |
| [Datastore 2025](https://www.opendata.maggioli.cloud/api/3/action/datastore_search?resource_id=a987f1b8-6c59-4703-bb84-f65fb5f60a6b&limit=0) | schema soltanto, nessuna riga personale | `_id`, Applicazione, Numero Pratica, Oggetto, Data Protocollo, Numero Protocollo; nessun indirizzo/civico/foglio/particella |
| [Mirror Regione Puglia 2025](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche-edilizie-2025) | pagina dataset, resource e download URL | Stesso CSV Maggioli, non una seconda fonte di territorializzazione |
| Elenco Pratiche generico, resource `ef757878-74d8-4f8d-aa92-aa4870aa86d7` | schema datastore già verificato in Phase 3 | Campi amministrativi, nessun indirizzo/catasto strutturato; non importato come registro annuale |
| Conteggi protocolli / per ufficio / monitoraggio procedimenti | schemi datastore della Phase 3, confronto catalogo attuale | Aggregati, non resolver delle singole pratiche |
| Provvedimenti dirigenti, resource `d9c2700a-6ac5-48f1-86e8-b949495048ad`; amministrativi `9b8ff13f-b0b2-400a-9637-d27201078fde` | schemi già verificati, 52.807 e 14 righe | Campi liberi contenuto/fascicolo, nessuna territorializzazione strutturata. Nessuna deduzione da questi testi o acquisizione indiscriminata |
| [SIT/SUE/PRG comunale](https://www.comune.bitonto.ba.it/it/page/sit-sue-e-prg) | pagina e link allegati | Catalogo PRG/PDF/RAR, non export del registro 2025 |
| [SUE comunale](https://www.comune.bitonto.ba.it/it/unita_organizzative/sportello-unico-per-l-edilizia-sue) | pagina e link pubblici | Nessun export territoriale annuale trovato |
| Ricerca indicizzata limitata a fonti ufficiali | anno + pratiche edilizie + CSV | Conferma delle risorse annuali note; nessuna nuova fonte strutturata dimostrata |

Una risposta temporanea «no healthy upstream» è stata registrata durante il
primo tentativo; il successivo controllo HTTP ha restituito 200 sulle sei
fonti primarie attuali. Non è stata interpretata come assenza di dati.

Conclusione: **NO PUBLIC STRUCTURED ENRICHMENT FOUND**, non prova di inesistenza
negli archivi dell'ente. Le 1.161 pratiche 2025 rimangono prive di indirizzo e
catasto; hash e first_seen non vengono riscritti. Specifica riutilizzabile in
[35](35-territorial-export-request.md).

## Annual building dataset ≠ historical Albo

2024: registro annuale disponibile con indirizzi/catasto dichiarati.
2025: registro annuale disponibile, soltanto metadata amministrativi.
2023/2022/2021/2020/precedenti: registro annuale **NOT FOUND** nelle fonti consultate.
Albo storico: pubblicazioni osservabili dal 2021, selezione territoriale e coverage
per coorti registro/atto. Non sostituisce un registro edilizio completo.
