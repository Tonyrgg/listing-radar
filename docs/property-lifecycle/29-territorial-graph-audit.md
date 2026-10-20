# Territorial Knowledge Graph: audit prima delle modifiche al matcher

20 ottobre 2026, base `790c3f5`, target autorizzato `eqqmglsxwbsihrlecnun`.
Lettura completa, paginata, dei 2.447 record esistenti e delle entità territoriali.
Nessuna scrittura durante l'audit. Campi personali esclusi dall'analisi.

## Unmatched record analysis

Una causa principale per ciascuno dei **1.938** record senza building link:

| Causa | Record |
| --- | ---: |
| DATASET_WITHOUT_TERRITORIAL_FIELDS | 1.161 |
| CADASTRAL_ONLY | 657 |
| NO_ADDRESS_AVAILABLE | 26 |
| LOCALITY_ONLY | 23 |
| AREA_DOCUMENT | 22 |
| STREET_ONLY | 19 |
| CIVIC_AMBIGUOUS | 16 |
| STREET_AND_CIVIC_NOT_IN_REGISTRY | 14 |
| MULTIPLE_BUILDING_CANDIDATES | 0 |
| NORMALIZATION_FAILURE | 0 |
| OTHER | 0 |

Nella prima classificazione la presenza di un civico senza edificio è distinta
dall'assenza della strada nel registro: le 14 righe hanno indirizzi riconosciuti,
ma non una building identity esistente. Non vengono creati edifici per aumentare
la copertura. Il catasto dichiarato senza resolver non risolve le 657 righe.

Il dry-run V2 individua anche sei slash numerici precedentemente trattati come
liste: `51/57` non prova due edifici distinti, resta intervallo/REVIEW. Pertanto
22 ambigui e 8 civici non presenti nella proiezione conservativa. Non si riscrive
il record originario per nascondere questa differenza.

## Entità e coordinate prima

673 property, 480 building, 511 associazioni HIGH, 6 property con contesto edificio,
0 auto-match di unità. Coordinate: 312 property e 28 building; 236 strade con
geometria. 342 record localizzabili, con precisione STREET. Nessun duplicato
building nella chiave indirizzo/civico/località esatta attuale.

## Strategia

Proiezioni derivate versionate e reversibili, riferite agli ID originali.
Street registry riutilizzato; iniziali/onorifici/apostrofi normalizzati soltanto
se rimane un candidato ufficiale. Località separata. Ambiguità di ID ufficiali
non risolta per frequenza. Nessun merge automatico, nessun aggiornamento delle
coordinate property da punti rappresentativi di strada. Timestamp, hash,
observation e valori originali restano invariati.

L'attività territoriale misura documenti osservati, non propensione alla vendita.
Timeline amministrativa e commerciale affiancate senza causalità.

## Year coverage matrix e 2025 enrichment

Catalogo ufficiale Maggioli: 55 dataset Bitonto riesaminati il 20 ottobre.
Ricerca web mirata anche nei siti istituzionali e nel catalogo regionale Puglia.

| Anno | Dataset annuale dimostrato | Risultato |
| --- | --- | --- |
| 2025 | CSV e CKAN datastore, 11.577 righe | 1.161 pratiche già importate; cinque campi amministrativi, nessun indirizzo/catasto |
| 2024 | CSV ufficiale, ripubblicato dal catalogo regionale | 1.190 pratiche esistenti; campi territoriali disponibili |
| 2023 | Non reperito | Lacuna annuale; Albo storico consultabile, non un registro edilizio completo |
| 2022 | Non reperito | Come sopra |
| 2021 | Non reperito | Albo storico dimostrato fino a gennaio, non continuità delle pratiche |
| 2020 e precedenti | Non reperiti | Nessuna importazione o ricostruzione inventata |

2025: `package_show` contiene una sola risorsa, nessun allegato/relazione utile.
Anche `datastore_search` con `limit=0` conferma gli stessi campi del CSV:
Applicazione, Numero Pratica, Oggetto, Data Protocollo, Numero Protocollo.
L'elenco generico ha unicamente Ufficio Responsabile in più; conteggi protocolli
e conteggi per ufficio sono aggregati, monitoraggio procedimenti descrive tipi
e tempi amministrativi. Nessuno offre un resolver indirizzo/catasto per pratica.
Non vengono usati oggetti liberi o persone per dedurre una localizzazione.

Fonti riproducibili:
- [Catalogo Bitonto](https://www.opendata.maggioli.cloud/api/3/action/package_search?q=Bitonto&rows=100).
- [Schema pubblico 2025](https://www.opendata.maggioli.cloud/api/3/action/datastore_search?resource_id=a987f1b8-6c59-4703-bb84-f65fb5f60a6b&limit=0).
- [Scheda 2024 nel catalogo Puglia](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche-edilizie_20241).

## Albo historical coverage

[Archivio Atti ufficiale](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti):
**25.126 risultati, 1.257 pagine**. Letta soltanto prima e ultima pagina usando
il link «Fine» effettivamente esposto e la cookie anonima della stessa sessione.
Ultima pagina: pubblicazioni del **05/01/2021 e 07/01/2021**; prima pagina:
**16/10/2026 e 19/10/2026**. Le date 31/12/2026 e 31/12/2031 sono termini
di esposizione, non date iniziali di copertura.

Il form espone ricerca per anno/numero registro, oggetto e data pubblicazione
da/a. Nessuna ricerca per nominativo eseguita. Due pagine non certificano la
completezza di ogni anno, allegato o categoria. Nessun crawl di 1.257 pagine
né download PDF; ingestion corrente e storico restano distinti. L'Albo corrente
ora espone 306 ID: non si riscrivono i 74 atti della Phase 2 per inseguire il count.
