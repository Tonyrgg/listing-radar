# Public Records Phase 2: audit prima dell'ingestion

Controllo HTTP diretto del 19 ottobre 2026, base `cf5faf4`. Nessuna nuova
property, nessuna modifica al desktop o alle migration 0001–0034.

## Current Public Records Map

| Fonte | Accesso / importer | Record e copertura | Territorio / documenti | Limiti |
| --- | --- | --- | --- | --- |
| Open data pratiche 2024 | CSV Maggioli, `BuildingIntelligenceImporter`, BUILDING_DATA_SYNC | 11.325 righe; 1.190 pratiche APE già importate | 507 pratiche con indirizzi, 1.154 con riferimenti catastali dichiarati; 509 associazioni edificio | CSV contiene anche dati personali: il parser conserva solo campi amministrativi e territoriali. Data pratica non equivale a data pubblicazione |
| Albo Pretorio | HTTP pubblico Liferay, nessun importer precedente | 306 ID distinti, 16 pagine da 20; ultima pagina 6 | Detail stabile `/papca/display/<id>`, date atto/documento/registro/periodo, ufficio, allegati pubblici | Inventory delle pubblicazioni esposte, non storico completo di tutti gli atti; cancellati/annullati presenti. Paginazione NEXT dipendente dalla sessione pubblica |
| SIT/PRG | `importBitontoPlanCatalog`, stesso job edilizio | 22 PDF già catalogati; anche un archivio RAR collegato dalla pagina, non scaricato | Titoli e URL originali, 2 tavole Mariotto, 2 Palombaio, centro urbano e DPP | Catalogo di area, nessuna attribuzione normativa alla property, data documento non dichiarata |
| SUE/SUAP | Sito pubblico / modulistica | Nessun inventario pubblico dimostrato | Servizi e moduli | Non è un elenco di pratiche; niente login automatico |
| Viewer SIT e pagina WMS | Link ufficiali del Comune | Fetch non completato, catena TLS non verificabile (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) | Nessun layer verificato | Non disabilitare TLS. GetCapabilities, CRS, geometrie e copertura restano sconosciuti |

## Albo audit

La prima pagina e le successive hanno intestazioni e classi strutturali stabili.
La paginazione è stata percorsa tutta, conservando soltanto la cookie di sessione
pubblica in memoria: 306/306 ID unici. Ogni pagina dichiara numero corrente,
totale pagine e risultati; una ripetizione, variazione di totale o pagina mancante
deve interrompere l'ingestion, senza dedurre rimozioni.

I dettagli espongono separatamente Data documento, Data atto, Data registro e
Periodo pubblicazione. Gli allegati hanno link pubblici codificati nell'attributo
onclick `window.open(atob(...))`: decodifica statica, nessuna esecuzione JavaScript,
nessun endpoint privato. URL originali mantenuti; niente download FAST dei PDF.
Il range corrente comprende anche atti vecchi con pubblicazione lunga o annullati:
non prova continuità storica annuale. Ricerca e filtri sono presenti nel form
pubblico, ma il primo sync deve leggere l'inventory esposta completa.

Il filtro esplorativo largo trovava 84 candidati, inclusi falsi positivi come
«in via d'urgenza» o la cooperativa «La Strada e le Stelle». L'ingestion non può
usare quel filtro come prova territoriale: richiede categoria/intervento esplicito
oppure una strada riconosciuta nel registro territoriale esistente.

Esempi verificati: ordinanza 692/2026, Via G. Mazzini civici 51–57;
691/2026, Via Prof. N. Fornelli 36A/36B; lavori rete idrica Via Manzoni e
Via IV Novembre, Palombaio. Un intervallo 51–57 non autorizza a inventare tutti
i civici né un'associazione a una singola unità.

## Years available

Ricerca nel catalogo CKAN ufficiale: 55 dataset Bitonto, soltanto tre elenchi
pratiche. Nessun download dei dataset anagrafici estranei.

| Anno / risorsa | Disponibile / formato | Righe / pratiche APE | Campi e qualità |
| --- | --- | --- | --- |
| 2025 | HTTP 200 / CSV ufficiale | 11.577 / 1.161 | Solo applicazione, numero pratica, oggetto, data e protocollo. Anno e tipo possono essere letti dal numero esplicito; nessun campo via/civico/catasto. PARTIAL |
| 2024 | HTTP 200 / CSV ufficiale | 11.325 / 1.190 | Indirizzo, civico, tipo, date, catasto. Importer esistente riutilizzabile |
| 2023 | Dataset annuale non trovato | Sconosciuto | Non significa zero pratiche |
| 2022 | Dataset annuale non trovato | Sconosciuto | Non significa zero pratiche |
| 2021 e precedenti | Dataset annuale non trovato | Sconosciuto | Nessuna continuità inventata |
| Elenco generico senza anno | HTTP 200, 27,3 MB / 86.771 righe | 6.029 gruppi APE del parser attuale | Mancano anno e campi territoriali; potenziale sovrapposizione con annuali. Non importare automaticamente questo insieme ambiguo |

## Decisioni di implementazione

1. Estendere record, observation, link edificio e import run esistenti con
   migration 0035. Non creare un secondo archivio o una coda commerciale.
2. Albo: inventory completa, diff dei metadata, detail solo nuovo/cambiato o
   rotazione controllata. Fonte con limiti, timeout/retry e failure registrati.
3. Conservare solo atti territorialmente pertinenti, titolo/oggetto sintetici
   sanitizzati e hash del contenuto originario. Non indicizzare nominativi, ditte,
   firmatari o beneficiari. L'originale rimane verificabile dal link pubblico.
4. Strade sul registro ufficiale già presente; edificio solo con strada e civico
   esatti. Iniziali ambigue, intervalli, sola via e catasto non risolto rimangono
   contesto o revisione. Nessun auto-match di unità.
5. 2025 nell'importer esistente, con limiti di copertura espliciti; 2024 preservato.
6. Segnali territoriali come read model dei record, senza lead e senza score
   commerciale. Mappa, dossier e ricerca riutilizzano le superfici esistenti.
7. Stesso BUILDING_DATA_SYNC: Albo giornaliero, statici settimanali, cadenza
   centralizzata e nessuna rimozione dedotta da mancato fetch.

Fonti primarie: [Albo](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio),
[catalogo CKAN](https://www.opendata.maggioli.cloud/api/3/action/package_search?q=Bitonto&rows=100),
[SIT e PRG](https://www.comune.bitonto.ba.it/it/page/sit-sue-e-prg).

## Verifiche successive durante il rollout, 20 ottobre

- Il trust store Windows legge legittimamente pagina WMS, viewer e progetto
  QGIS pubblico con HTTP 200, senza bypass TLS. Il progetto contiene **86**
  riferimenti WMS in EPSG:32633. L'endpoint GetCapabilities dichiarato risponde
  404: catalogo statico PARTIAL, layer live non verificati. Dettaglio completo
  in [SIT layer catalog](28-sit-layer-catalog.md).
- Al cambio di giorno l'inventory Albo passa da 306 a **304** pubblicazioni;
  il sync completo live importa 74 atti territoriali. Nessun record viene
  eliminato o dichiarato rimosso. Il replay usa zero dettagli e zero versioni.
- Le letture di contesto di 0035 richiedevano circa 6,7 s; 0036 rende i join
  indicizzabili. La lettura aggregata di tutte le strade superava il timeout;
  0037 aggrega le property una volta. Sono migration successive, senza riscrivere
  quelle già applicate. Le letture reali successive sono riportate nella consegna.
