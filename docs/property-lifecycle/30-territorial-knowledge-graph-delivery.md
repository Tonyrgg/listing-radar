# Public Records Phase 3: Territorial Knowledge Graph

20 ottobre 2026. Base `790c3f5`, implementazione `5dc8d65`.
Target autorizzato: Supabase `eqqmglsxwbsihrlecnun`, web
<https://listing-radar-mu.vercel.app>. Audit prima delle modifiche:
[29](29-territorial-graph-audit.md). Analisi derivata individuale dei 74 atti:
[31](31-albo-territorial-review.md).

## Unmatched record analysis

L'audit assegna una causa principale a tutti i **1.938** record senza edificio.
1.161 dataset 2025 senza campi territoriali, 657 solo catasto dichiarato,
26 senza indirizzo, 23 sola località, 22 documenti di area, 19 sola via,
16 civici/strade ambigui, 14 civici non presenti nella registry building.
MULTIPLE_BUILDING_CANDIDATES, NORMALIZATION_FAILURE e OTHER: zero nella
classificazione iniziale. Vedi metodologia e tabella completa nell'audit.

La proiezione conservativa successiva classifica **22 ambigui e 8 civici senza
edificio**: anche gli slash numerici vengono trattati come intervalli, senza
inventare gli estremi come identità di edifici. Il totale resta 1.938.

## Normalization fixes

Street registry esistente, risoluzione univoca per località; iniziali, onorifici
Prof./Dott./Mons., apostrofi, accenti, prefissi V.le/P.zza/C.so e suffissi di
località. Numeri romani conservati come parte del nome; nessun II → III.
`14/A` e `14A` coincidono; `14-16`, `51/57`, `51–57`, slash numerici misti e SNC
non generano identità di edifici. `36A/36B` conserva i due civici dichiarati.
Contraddizione di località o più ID possibili: REVIEW, senza alias arbitrari.

Corretto anche il caso reale `VIA TORRE D' AGERA`: l'apostrofo seguito da spazio
non deve perdere l'identità rispetto al nome ufficiale `VIA TORRE D'AGERA`.
Il parser delle nuove osservazioni applica la stessa semantica prima della
minimizzazione. Le osservazioni precedenti non sono riscritte.
La protezione vale anche nel CSV e nel confine condiviso dell'identità edificio:
un intervallo non può diventare un falso civico concatenato. Verifica HTTP del
CSV 2024 nel parser finale: 1.190 pratiche, 507 con indirizzo, nessun intervallo
numerico nei civici APE attuali. Nessuna migrazione retroattiva dei record.

## Building coverage before / after

| Misura | Prima | Dopo |
| --- | ---: | ---: |
| Building esistenti | 480 | 480 |
| Building link correnti HIGH | 511 | 511 |
| Nuovi link edificio proposti/applicati | — | 0 |
| Coordinate building già disponibili | 28 | 28 |
| Building rappresentabili in mappa | Non esposti | 298 |
| Auto-merge eseguiti | 0 | 0 |

I 298 punti non sono nuove coordinate: si riusano coordinate già presenti
con la loro precisione oppure una rappresentazione **STREET** indicativa.
Le varianti del civico e il nome canonico sono proiezioni, non duplicati di building.
805 location analizzate, 436 con strada risolta univocamente nel perimetro.

**28 coppie candidate:** 2 PROBABLE_SAME_BUILDING, 26 REVIEW_REQUIRED,
0 AUTO_SAME_BUILDING e 0 DIFFERENT nel campione attuale. Esempi probabili:
Via Nicola Gliro / Via N. Gliro 48; Via D. Piepoli / Via Donato Piepoli 32.
Nessun ID, alias storico, relazione confermata o building eliminato. I candidati
basati su particella dichiarata o coordinate vicine restano da revisionare;
non si considera una particella come identità ufficiale del fabbricato.

## Street coverage before / after

| Misura | Prima | Dopo |
| --- | ---: | ---: |
| Record con collegamento a un ID strada | 491 | 430 |
| ID strada con record | 207 | 164 |
| Record rappresentabili in mappa | 342 | 348 |
| Punti documentali, inclusi record multistrada | 348 | 354 |
| Strade con geometria nel registro | 236 | 236 |

Non è una crescita indiscriminata: **71 record** non ricevono più un ID strada
automatico perché il registro offre più candidati; **10** acquistano un contesto
univoco prima non risolto. Nessun record sparisce dalla ricerca o dall'archivio.
La riduzione riguarda ID assegnati automaticamente, non cancellazione di prove.

## Property context before / after

| Misura | Prima | Dopo |
| --- | ---: | ---: |
| Property | 673 | 673 |
| Con contesto edificio | 6 | 6 |
| Con contesto strada nella proiezione | 115 | 104 |
| In strada con documenti recenti | Non misurato | 36 |
| Auto-match singola unità | 0 | 0 |
| Coordinate property | 312 | 312 |
| Opportunity Score invariato | — | 673 / 673 |

Il confronto strada iniziale riproduce il join normalizzato della Phase 2,
non una ground truth umana. La riduzione a 104 applica la revisione delle
ambiguità ufficiali. 361 property restano senza coordinate: nessun punto
rappresentativo di strada è promosso a coordinata della casa.

Gerarchia nel dossier: specifici dell'unità (zero prove attuali), contesto edificio,
contesto strada, documenti di area. Link per aprire edificio e strada nello stesso
Territorio. Nessuna proprietà giuridica del documento ereditata dalla property.

## 2025 enrichment result

Risultato: **non territorializzato**. CSV, scheda CKAN, schema datastore e
cataloghi complementari non dimostrano una corrispondenza strutturata pratica →
indirizzo/catasto. Conteggi protocolli e monitoraggio procedimenti non sono
resolver di singole pratiche. Nessuna geografia dedotta da persone o oggetti
liberi. Le 1.161 pratiche restano consultabili. Audit e URL riproducibili in [29](29-territorial-graph-audit.md).
Gli schemi dei due cataloghi dirigenziali hanno riferimenti liberi di fascicolo,
senza colonne territoriali o chiave pratica strutturata. L'eventuale prova su
una singola pratica resta UNKNOWN; non sono stati letti 52.807 contenuti per
costruire una deduzione o un indice di persone.

## Albo coverage e year coverage matrix

Archivio Atti ufficiale: **25.126 risultati / 1.257 pagine** nel controllo.
Prima e ultima pagina verificate, con pubblicazioni dal **05/01/2021 al
19/10/2026**; non certifica continuità annuale o completezza di ogni categoria.
Form pubblico con date da/a, anno e numero. Nessun crawl dello storico.

Annualità edilizie dimostrate: 2024 e 2025. 2023, 2022, 2021, 2020 e precedenti
non reperite come dataset annuali accessibili nel catalogo verificato.
Albo storico e registro edilizio annuale sono fonti diverse. Matrice e limiti in [29](29-territorial-graph-audit.md).

## Territorial activity examples

Indicatore **territorial_activity_v1**, 0–100, spiegabile: ultimi 30 giorni max40,
altri documenti nei 90 giorni max20, varietà di categorie recenti max15,
pratica edilizia recente max15, lavori/viabilità max10. Date amministrative
valide, non data di import; annullati/revocati/cancellati esclusi. Nessun effetto
sull'Acquisition Opportunity Score o sui lead.

- **A:** Via Giacomo Matteotti 181, tre documenti, uno recente, zero property,
  ultimo 24/09/2026; attività 25/100, moderata. Via Carrara 35: due documenti,
  uno recente, zero property, ultimo 07/10/2026, 25/100.
- **B:** edificio con documento recente e property attiva: nessun caso dimostrato.
- **C:** Via Castelfidardo, quattro documenti, tre recenti, una property attiva;
  Via Giovanna da Durazzo, dodici documenti, due recenti, tre property note.
- **D:** property con building context recente: nessun caso dimostrato.

## Building examples / street examples

Edificio Matteotti 181: portafoglio, pubblicazioni, agenzie, documenti, catasto
dichiarato, precisione e timeline consultabili. Coppie Gliro 48 e Piepoli 32
rimangono confrontabili con ID distinti, senza merge silenziosi.

Via Castelfidardo: contatori, categorie, building conosciuti e timeline con atti
e prime osservazioni di mercato. Date dichiarate e osservate sono distinte;
un atto seguito da un annuncio non prova causalità. Price change ricavati dai
propri eventi della publication, senza confrontare prezzi simultanei tra fonti.
Sold evidence distingue data dichiarata e osservazione; nessun asking chiamato
prezzo di vendita.

## Map / UI

Stesso Territorio: layer Immobili, Documenti pubblici, Edifici. Cluster e hover
edificio, filtri 30/90 giorni, categoria, immobili noti/attivi nel contesto
edificio, attività edificio/via. Precisione STREET esplicita; ricerca e zoom
per separare punti vicini. Il filtro di presenza non interpreta vicinanza
sulla via come collegamento all'edificio.

Intelligence aggiunge filtri specifici unità, edificio, attività edificio e
strada recente; nessun aumento automatico del ranking Opportunità. Hover
property distingue documenti specifici, edificio e attività di strada.
Timeline di building/via paginata, con link a record, fonte e dossier.

## Tests

**588 PASS, 25 SKIP**, 59 file passati e 2 saltati. Le integrazioni saltate
non sono dichiarate eseguite. PostgreSQL/PGlite esegue le migration reali,
idempotenza, storico invariato, unità REVIEW, duplicati senza merge,
revocati, attività, street/property inheritance, timeline e permessi anonimi.
Regressioni TS su iniziali, onorifici, apostrofi, numeri romani, lettere,
intervalli, località, conflitti, catasto senza resolver e 2025 non arricchito.
Rendering UI su gerarchia dei contesti, provenienza e prezzi degli eventi.
Typecheck web, lint, build Next e design check: PASS. Desktop non modificato.

## Performance

Ultime due misure reali complete, incluse timeline, documenti di area e revisione
duplicati quando richiesta: building **314 / 251 ms**, street **253 / 319 ms**.
Il campione non costituisce uno SLA o una misura di p95. Layer aggregato building
**651 ms**, record **838 ms**. Letture paginate da 500 righe e arricchimenti
batch; nessun N+1 per edificio, record o evento prezzo. Non sono misure TTI.

## Privacy

Nessun nuovo archivio persone, ownership, nominativo usato come chiave o testo
PDF indicizzato. Nessun PDF scaricato; il CSV primario è stato letto solo in
memoria per verificare civici e copertura, senza conservarne il body. Le risoluzioni
contengono ID esistenti, geografia, ragioni, versione e hash dell'input; nessuna
seconda copia del payload documentale. Originali, observation e first_seen
restano nella struttura esistente. Verificati **2.447/2.447 hash e first_seen
invariati**; property 673, building 480. Nessuna creazione lead o variazione score.

## Deployment

Migration additive **0038_territorial_knowledge_graph.sql** e
**0039_territorial_context_timeline.sql** applicate dopo PostgreSQL isolato e
dry-run sul target. Nessuna modifica a 0001–0037, nessuna cancellazione.
Recompute derivato esplicito, poi web/runtime compatibili. Feature commit
`5dc8d65`; fix di precisione `230abbc`, contesto PRG `6bcf1c0`.
BUILDING_DATA_SYNC mantiene lo scheduler esistente e aggiorna anche il grafo,
inclusi i run con fonti non dovute. Desktop SISTER/Tecnocloud escluso.

## Next opportunities

Revisione umana dei duplicati del registro strade prima di recuperare le
71 assegnazioni sospese; verifica delle due coppie building probabili;
audit mirato dello storico Albo per protocollo/periodo; richiesta di un export
2025 ufficiale territorializzato. Non si amplia il crawling per compensare
campi mancanti. SIT WMS dichiarato ricontrollato: **HTTP 404**, resta
NOT AVAILABLE; catalogo statico PRG/DPP conservato senza interpretazione normativa.

La raccolta conserva date amministrative, prima osservazione, prima evidenza
di mercato e lifecycle per ricerche future; non calcola correlazioni commerciali
su un campione insufficiente. Stato operativo: **READY WITH LIMITATIONS**.

## Chiusura operativa: production e smoke autenticato

Versione funzionale finale **`2a8c04f9f157f4c9caa6a39e52a7c4d2518d72f0`**,
Vercel production **7195511027**, SUCCESS. Migration fino a 0039 allineate,
dry-run finale senza modifiche pendenti. Il commit successivo del presente
report non modifica il codice distribuito.

Runtime remoto finale: workflow **39395934178**, commit `ccdab74`, job
**d494d98d-a915-48fd-94bc-7a690364db5a**, `BUILDING_DATA_SYNC`, **SUCCEEDED**,
nessun `last_error`, un job eseguito e zero falliti. Il commit successivo riguarda
solo la dicitura prudente «Segnale di vendita»; ingestion e scheduler sono gli
stessi della versione funzionale finale. Cadenze esistenti
rispettate, nessun nuovo crawl storico. Non si dichiara osservato un nuovo
evento cron Public Records: continuare il monitoraggio dei run pianificati.

| Smoke production autenticato | Esito |
| --- | --- |
| Matteotti 181 | 3 documenti, 1 recente, 0 property, attività 25/100 con ragioni espandibili |
| Layer building / hover / click | Un punto per Matteotti 181 nella ricerca, documenti e precisione STREET espliciti; apertura del contesto corretto |
| Filtri 30 giorni + Viabilità + property attive | Zero building per Matteotti 181: nessuna falsa presenza |
| Castelfidardo | 4 documenti, 3 recenti nei 90 giorni, 1 property attiva; atti e osservazioni di mercato distinti nella timeline |
| Gliro 48 | Possibile stesso edificio in revisione, link al confronto, nessun merge |
| PRG area | 18 documenti Bitonto nei contesti edificio/via, separati da normativa o zonizzazione |
| Piazza Cattedrale 23 | 0 specifici unità, 1 edificio, 1 via, 18 area; pratica 3/2024/SCA, protocollo 1014 e hash originale verificati |
| Intelligence, attività strada | 36 righe, nessun errore di lettura |
| Intelligence, specifici unità | Zero risultati, nessuna prova di unità inventata |
| Mobile 390×844 | Contesto edificio leggibile, document width 380 px, nessun overflow orizzontale nel caso verificato |
| Console | Nessun nuovo warning/error nei controlli eseguiti |
| Accesso anonimo | /map, /intelligence, /fonti → 307 /login; /api/health → 200 |

Lo smoke ha individuato e corretto la dicitura che confondeva precisione
dell'indirizzo con disponibilità delle coordinate: ora il building dichiara
«coordinate non disponibili» dove manca il punto, e la mappa usa STREET
senza promuoverlo. Coordinate presenti senza prova spaziale sufficiente
restano APPROXIMATE; nessuna EXACT_CIVIC viene inventata.

Verifica DB dopo runtime: 2.447 record, **2.469 observation**, 511 link building,
480 building, 673 property, **1 lead**. Nessun incremento di questi archivi.
Report delle 74 righe e analisi dei candidati sono derivati automaticamente
dai metadata pubblici già osservati, non una nuova ground truth umana.

Prove e log:
`C:/Users/ruggi/listing-radar-validation/2026-10-20/public-records-phase3/`.
Screenshot building desktop/mobile, strada, dossier e revisione duplicati;
metriche, gate e verifica del runtime. Limiti restanti: ambiguità del registro,
dataset annuali mancanti, 2025 senza territorio, WMS 404, nessuna certificazione
di unità/catasto e nessuna precisione empirica del matcher dichiarata.
