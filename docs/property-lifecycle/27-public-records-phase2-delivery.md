# Public Records Phase 2: Comune e territorio

Consegna del 20 ottobre 2026, base `cf5faf4`. Production autorizzata:
<https://listing-radar-mu.vercel.app>, Supabase `eqqmglsxwbsihrlecnun`.
Audit precedente all'ingestion: [26](26-public-records-phase2-audit.md).
Catalogo tecnico SIT: [28](28-sit-layer-catalog.md).

## Public record sources e years available

| Fonte | Stato | Copertura reale / limiti |
| --- | --- | --- |
| Registro edilizio 2024 | READY per il dataset pubblicato | 1.190 pratiche APE preesistenti, nessuna cancellata. Indirizzi/catasto come dichiarati, non identità catastale certificata |
| Registro edilizio 2025 | PARTIAL | 1.161 pratiche deduplicate da 11.577 righe, di cui 9.424 APE. Anno e tipo dal numero esplicito; mancano campi indirizzo e catasto. Nessun geocoding inventato |
| Albo Pretorio | READY per inventory esposta e metadata territoriali | 304 ID su 16 pagine nel primo sync live del 20 ottobre; 74 atti pertinenti, 230 esclusi. Non è l'archivio storico completo del Comune |
| PRG / DPP | READY per catalogo, PARTIAL per interpretazione | 22 PDF referenziati, nessun download automatico. Tipo PRG/tavola/DPP e località. Un RAR aggiuntivo presente nella pagina resta fuori dall'import PDF |
| SIT / WMS | PARTIAL statico, NOT AVAILABLE live | 86 layer nel progetto QGIS pubblico, EPSG:32633; GetCapabilities dichiarato risponde 404. Nessuna geometria normativa assegnata |
| SUE / SUAP | NOT AVAILABLE come inventario di pratiche | Sito e modulistica pubblici, nessun inventario dimostrato; nessun login automatizzato |
| Annuali 2023 / 2022 / 2021 | NOT AVAILABLE nel catalogo verificato | Lacuna di dataset, non zero pratiche. L'Albo contiene singoli atti vecchi, senza continuità annuale dimostrata |
| Elenco pratiche generico, 27,3 MB | Non importato | Campi insufficienti e sovrapposizione potenziale con annuali: nessuna duplicazione indiscriminata |

## Albo audit e ingestion

ID `papca/display`, registrazione e numero atto distinti. Oggetto, categoria,
date documento/atto/registro/periodo e ufficio nei dettagli pubblici. La cookie
anonima di sessione resta solo in memoria per avanzare NEXT. Controlli di
pagina, totale, struttura, ID duplicati, host, timeout e dimensione; 403 non
produce inventory vuota valida. 429/5xx hanno tentativi limitati e backoff;
il job conserva inoltre lease/retry esistenti. Nessun login o bypass.

Inventory completa prima delle scritture, diff dei marker, dettagli solo per
record nuovi/cambiati o rotazione a 7 giorni. FAST conserva metadata e URL,
non scarica PDF. Link onclick decodificati staticamente, mai eseguiti.
Record, observation significativa e link al building sono atomici per batch
di massimo 100. Replay invariato aggiorna presenza, non lo storico completo.

Primo sync: `f95efc60-4ba5-497a-bec3-fe2522241f3c`, 74 insert, 0 update,
2 associazioni a edifici esistenti. Replay:
`564ba3c6-ea4b-4365-b6c5-aa1db2ff3746`, **0 insert / 0 update / 0 detail fetch**,
74 conferme. Nessuna deduzione di record rimosso.

Il precedente audit del 19 ottobre vedeva 306 pubblicazioni e 76 candidati:
questa differenza temporale è conservata nel report, non nascosta o trattata
come fallimento. I dati live del sync sono 304/74.

## Imported records e metriche

| Misura | Risultato |
| --- | ---: |
| Record totali | 2.447 |
| Edilizia 2024 / 2025 | 1.190 / 1.161 |
| Albo / PRG | 74 / 22 |
| Anno record 2023 / 2024 / 2025 / 2026 / non dichiarato | 1 / 1.192 / 1.161 / 71 / 22 |
| Con strada / con civico esplicito | 558 / 523 |
| Con riferimenti catastali dichiarati | 1.154 |
| Link edificio HIGH / MEDIUM | 511 / 0 |
| Record senza link edificio | 1.938 |
| Property con contesto edificio collegato | 6 |
| Record datati negli ultimi 30 / 90 giorni | 61 / 70 |
| Auto-match di singola unità | 0 |
| Record localizzabili sulla strada | 342, con 348 punti per le diverse vie |
| Storico observation | 2.469 versioni significative |

Le 22 versioni aggiuntive sono l'arricchimento dichiarato PRG/tavola/DPP del
catalogo esistente; il secondo import PRG crea **0 insert e 0 update**.
`first_seen_at` conservato in **1.190/1.190** pratiche precedenti. Property
**673 → 673**, buildings **480 → 480**, lead **1 → 1**. Nessun nuovo archivio,
profilo proprietario, lead o modifica allo score commerciale.

## Document types

SCIA, CILA, segnale di agibilità, permesso, sanatoria, condono, ordini di
demolizione/sicurezza, occupazione/accesso, SUAP, urbanistica/variante,
lavori pubblici/stradali, viabilità, esproprio, tutela, delibera, determina,
ordinanza e altro. Si conservano solo categorie sostenute dal contenuto reale;
confidence e versione sono centralizzate. Nell'Albo importato prevalgono
46 atti di viabilità, 12 lavori stradali, 6 lavori pubblici e altri casi.
La tassonomia supportata non afferma che ogni categoria sia presente.

## Matching quality, buildings e property

Il registro strade esistente è riutilizzato. Nome completo o iniziale
univoca, località e civico sono distinti da via sola, SNC e intervalli.
Solo chiave esatta di edificio già conosciuto produce il link HIGH; niente
creazione di property o collegamento sulla sola via. MEDIUM non viene
promosso automaticamente. I riferimenti foglio/particella/sub restano
dichiarazioni, senza resolver catastale o identità di unità.

I due ID ufficiali di Via Giuseppe Mazzini non vengono risolti arbitrariamente.
L'atto 692/2026 conserva strada, intervallo **51–57**, candidati e ragioni di
revisione; non espande l'intervallo né collega appartamenti. Fornelli 36A/36B
conserva i due civici dichiarati, senza inventare interni.

La confidenza del matcher non è una precisione empirica misurata: non si
dichiara un 95% di accuratezza né una certificazione di conformità.

Golden case Piazza Cattedrale 23: `3/2024/SCA`, data pratica 09/01/2024,
protocollo 1014, foglio 49 / particella 1485 / sub 22; fonte, hash e contesto
edificio preservati. Singola unità **REVIEW_REQUIRED**. Fixture derivata dai
campi amministrativi del CSV primario, con dati personali esclusi.

## Territorial signals con esempi reali

Segnali consultivi derivati dai record e dalle loro date, senza nuovo archivio
di segnali commerciali. Un vecchio atto importato oggi non diventa per questo
una pratica recente; atti annullati/revocati non generano il flag recente.

- **A, edificio senza property attiva:** Via Giacomo Matteotti 181, tre documenti,
  ultimo 24/09/2026, nessuna property conosciuta; Via Carrara 35, due documenti,
  ultimo 07/10/2026, nessuna property conosciuta.
- **B, edificio con pratica recente e property attiva:** nessun caso dimostrato
  con il matching conservativo attuale. Non sostituito con una vicinanza sulla via.
- **C, concentrazione di strada:** Via Castelfidardo, quattro documenti,
  tre recenti, una property attiva; Via Giovanna da Durazzo, dodici documenti,
  due recenti, tre property conosciute. È contesto strada, non prova sull'unità.
- **D, property storica con nuovo documento di edificio:** nessun caso dimostrato
  nel campione attuale. Il dato resta sconosciuto.

## UI

Nelle stesse Intelligence / Territorio / Fonti / dossier, senza nuova app:

- Intelligence: filtri documenti, pratica/atto recente e nuovo segnale **di edificio**.
- Territorio: layer attivabile Documenti pubblici, clustering, popup e dettaglio
  dell'atto; punti indicativi di strada dichiarati come tali. Record senza
  coordinate restano nella ricerca. Nessuna coordinata precisa assegnata alle case.
- Ricerca: strada/parola nel titolo o oggetto sanitizzato, civico esatto,
  anno, fonte, categoria, località/area. Paginazione e link alla fonte/allegati.
- Contesto atto: edifici conosciuti, numero property/pubblicazioni/agenzie e
  dossier collegati. Contesto via sul registro esistente con lettura aggregata.
- Dossier: edificio, via e area distinti; documenti PRG mostrati come contesto
  di area, non pratiche individuali o vincoli assegnati.
- Fonti: ultimo sync, pagine, count, errori e limiti annuali/tecnici espliciti.

## Privacy e document policy

Nessuna indicizzazione di persone, ditte, firmatari, beneficiari o profili
proprietario. Titolo e oggetto Albo sono generati da categoria, numero e luoghi
riconosciuti; hash dei metadata originari e link permettono la verifica.
Proponenti privati non sono esposti come ufficio. Il CSV conserva soltanto
campi amministrativi/territoriali già sanitizzati. Fixture minimizzate.

`scripts/public-records.ts` offre dry-run, sync esplicito con conferma del project
ref e ispezione di **un solo PDF già noto** su richiesta. Whitelist host,
timeout, limite streaming **8 MB**, MIME/magic PDF e SHA-256; nessun body
conservato né testo personale indicizzato. Full-text PDF e download massivi
non fanno parte del rollout.

## Tests e performance

Test mirati: nuova identità, invariato/last_seen, metadata cambiati e rollback,
paginazione reale e ID duplicati, source failure, URL PDF, date mancanti/malformate,
via/civico/lettere/intervallo/SNC, ambiguità, building HIGH, unità REVIEW,
catasto dichiarato, privacy, documento area e golden case reale.

- PostgreSQL/PGlite esegue 0035, 0036 e 0037 reali, con le dipendenze.
- Suite completa finale: **551 PASS, 25 SKIP**, 57 file passati e 2 saltati. Le integrazioni
  saltate non vengono dichiarate eseguite. Typecheck web, lint, build Next e design
  check: PASS. Il desktop non è stato modificato né ricertificato.
- Contesto edificio: prima circa **6.694/6.660 ms**, dopo indici e join
  **200/117 ms** per le letture da cinque righe misurate.
- Layer documenti: **898 ms** per catalogo completo e punti.
- Lettura di 500 strade: prima timeout, dopo aggregazione unica **2.521 ms**.
  Queste sono letture API, non TTI del browser.

Ispezione live on demand di un solo PDF dell'ordinanza 692/2026: HTTP/MIME/magic
validi, **160.207 byte**, SHA-256
`f925e4ba4dff91fe6815a031cb7e96b2216d44c7eb80737c9cdb15e5b3c97c0b`.
Nessun file o testo personale conservato dall'ispezione.

## Deployment

Migration incrementali applicate sul target autorizzato, senza modificare 0001–0034:

1. `0035_public_records_territorial_intelligence.sql`, schema/read model/RPC atomica.
2. `0036_public_records_context_indexes.sql`, fix della lettura misurata su DB reale.
3. `0037_public_records_street_aggregation.sql`, fix del timeout sulla lettura completa.

Nessun DEV/STAGING configurato impiegato: test PostgreSQL isolato e dry-run di
ingestion prima del target production esplicitamente autorizzato.
Stesso BUILDING_DATA_SYNC, ora giornaliero; Albo giornaliero, statici con cadenza
settimanale e tolleranza di scheduling nella policy centrale. Runtime via main,
nessuna distribuzione desktop SISTER/Tecnocloud. Fonti portali e Studi Santi
non sono state riattivate o aggirate.

Verifica runtime remoto: workflow **39333305693**, commit `d02d385`,
BUILDING_DATA_SYNC, **SUCCESS**. Le cadenze evitano di rileggere fonti appena
sincronizzate. Il primo successivo avvio cron giornaliero resta da monitorare;
non viene dichiarato già osservato un evento futuro.

## Remaining gaps

Copertura documentale parziale; annuali mancanti; 2025 senza campi territoriali;
molti record non geolocalizzabili; iniziali/strade duplicate in revisione;
nessun resolver ufficiale catastale/unità; WMS live non operativo; WFS non
dimostrato; nessuna normativa interpretata automaticamente; nessun full-text
universale o download di tutti i PDF. I sei collegamenti a property sono
contesto di edificio, non documenti certificati della singola unità.

## Chiusura operativa e smoke autenticato del 20 ottobre

Web production: <https://listing-radar-mu.vercel.app>. Il rilascio iniziale
`02309a4` è completato; durante lo smoke sono emersi e sono stati corretti
tre problemi della mappa: marker documentali coperti da quelli immobiliari,
zoom iniziale non sincronizzato nel layer documenti e aggregazione troppo
fine nella vista regionale. Fix `4551380`, `8ef02bc`, `8e47aeb`; nessuna nuova
fonte o funzionalità commerciale. Regression test per lo zoom regionale,
suite completa rieseguita, typecheck, lint e build finali PASS.

Versione funzionale verificata: **`8e47aebbca47fc403fd40fc751765e47260135af`**,
deploy production **7194285563**, Vercel SUCCESS. Schema remoto allineato
fino a 0037, verificato nuovamente con dry-run senza migration pendenti.
L'eventuale commit successivo del presente report modifica solo documentazione.

| Verifica production autenticata | Esito osservato |
| --- | --- |
| Territorio e layer documenti | 673 property, 342 record localizzabili su 2.447; punti di strada esplicitamente indicativi |
| Atto Mazzini 51–57 | Date e fonte visibili; intervallo non risolto, nessuna property associata |
| Contesto Castelfidardo | 4 documenti, 3 recenti, 1 property attiva; contesto della strada esplicito |
| Ricerca Fornelli + 36A + 2026 | Restituisce l'atto 691/2026 con i civici dichiarati 36A/36B |
| Intelligence, filtro documenti edificio | 6 property, compresa Piazza Cattedrale 23 |
| Piazza Cattedrale 23 | Pratica 3/2024/SCA del 09/01/2024, protocollo 1014; fonte/hash e foglio 49, particella 1485, sub 22 verificati nell'espansione |
| Semantica del dossier | Edificio, via e area separati; singola unità da verificare |
| Fonti | Albo 74/16 pagine; 2025 1.161; PRG 22; lacune annuali e SIT non operativo espliciti |
| Mobile 390×844 | Dossier e ricerca documentale: larghezza documento 380 px, nessun overflow orizzontale nel caso provato |
| Accesso anonimo | /map, /intelligence e /fonti: 307 verso /login; /api/health: 200 |

Sul deploy finale il click fisico del gruppo Piazza Cattedrale apre le due
pratiche corrette (475/2024/CILA e 3/2024/SCA), senza aprire un dossier immobile.
La vista regionale ora aggrega ulteriormente i punti; gruppi vicini possono
ancora sovrapporsi a scala molto ampia: ingrandire o cercare la via per
distinguerli. Il controllo da tastiera apre il gruppo selezionato.

Nessun nuovo errore/warning console nei controlli eseguiti. Non è una
certificazione di ogni browser, viewport o combinazione di filtri.
I filtri documentali si combinano con l'eventuale contesto via selezionato;
«Azzera» rimuove anche quel vincolo prima di una ricerca globale.

Scheduler: run pianificata `39379020100` del 20 ottobre completata con successo,
ma riferita a **DEEP_SYNC_AGENCY**, non Public Records. Il BUILDING_DATA_SYNC
remoto è quello manuale verificato sopra; nessun successivo evento cron Public
Records viene dichiarato osservato. Verificare il prossimo avvio giornaliero
e il primo Albo nuovamente dovuto, senza forzare fetch ripetuti oggi.

Privacy operativa: eliminati 120 file temporanei grezzi di questa fase
(45.751.903 byte), inclusi HTML Albo e CSV di audit con campi non necessari.
Restano fixture minimizzate, metriche aggregate, hash e prove UI. Nessuna
cancellazione di dati Supabase o di file delle fasi precedenti.

Prove locali: `C:/Users/ruggi/listing-radar-validation/2026-10-20/public-records/`.
Comprendono metriche, log finali e screenshot desktop/mobile del golden case.

Conclusione: **READY WITH LIMITATIONS** per consultazione Public Records.
Albo e registri importati sono operativi; precisione empirica dei match non
certificata, annuali incompleti, WMS non disponibile e singole unità in REVIEW.
