# News Triage V1 — audit del 20 ottobre 2026

Audit eseguito prima del rilascio sulla base `2e47747`, target `eqqmglsxwbsihrlecnun`.
Nessuna nuova fonte o inventory. Lettura HTTP anonima delle **237 schede Albo
2026 già archiviate**, prima gli atti non stradali; nessuna scansione del portale.
Tre allegati già noti letti integralmente entro il limite di 20 pagine (3, 5, 5).
Il testo integrale e i nominativi non entrano nella proiezione.

## 2026 facts e root cause dello zero 30/90

All'inizio: 4.074 documenti, 1.319 facts. **274 documenti** hanno data
amministrativa tra 01/01/2026 e 20/10/2026: 272 Albo e 2 nel registro edilizio
pubblicato come 2024. Non è stato trovato/configurato un registro edilizio 2026
separato. Cinque facts, su tre pratiche, avevano già data amministrativa 2026;
l'ultimo era del 19 maggio, quindi fuori dagli ultimi 90 giorni.

Stato semantico iniziale del cohort: 3 EXTRACTED, 34 NO_SUPPORTED_FACT,
**237 REVIEW**, soltanto 37 schede già lette in dettaglio. Nei 90 giorni esistevano
137 documenti ma zero facts accettati. La selezione del precedente CLI ordinava
prima per categoria e poi per data, senza limitazione annuale: gli atti recenti
debolmente classificati rimanevano dietro ai titoli edilizi storici.

La territorializzazione contribuisce ma non spiega tutto: 58/274 record non hanno
indirizzi né riferimenti territoriali; solo 3/274 non hanno document_date, con
altra data amministrativa disponibile. Nell'intero archivio 22 record non hanno
alcuna data amministrativa. La data di osservazione non è stata usata per colmare
questi vuoti.

Tipi dei 274 record: ROAD_WORK 93, DETERMINA 67, VIABILITY 48, SAFETY_ORDER 15,
PUBLIC_WORK 9, OTHER 7, DELIBERA 6, URBAN_PLAN 6, EXPROPRIATION 5, HERITAGE 5,
SCIA 4, ORDINANZA 2, PERMESSO_COSTRUIRE 2, SANATORIA 2, BUILDING_PERMIT 1,
CONDONO 1, URBAN_VARIANT 1. Non equivalgono a trasformazioni utili.

## Lettura prioritaria dei REVIEW 2026

237/237 letture HTTP riuscite. Preselezione testuale: P0 8, P1 8, P2 3, P3 218.
Queste sono priorità di lettura, non giudizi di utilità. La maggioranza dei P0
riguardava gestione del patrimonio, non vendite; vari P1 contenevano acronimi o
ordinanze stradali. La lettura ha prodotto molti richiami fattuali generici, che
**non sono stati aggiunti** per gonfiare l'archivio.

Sono aggiunti soltanto tre facts documentati alle proiezioni esistenti, con le
qualifiche che ne impediscono una lettura commerciale falsa:

| Atto | Prova e limite | Triage |
|---|---|---|
| 08/09/2026, Corte Abate Marino 8/9 | Alienazione; risultanze di gara e aggiudicazione definitiva già approvate | REVIEW: verificare esito, bene non presunto disponibile |
| 02/10/2026, stesso bene | Alienazione richiamata in accertamento in entrata | ARCHIVE_ONLY: atto contabile successivo |
| 01/09/2026, viale Giovanni XXIII | Ordinanza circolazione per montaggio gru di demolizione/ricostruzione, senza civico univoco | REVIEW: cantiere indiretto, non titolo edilizio o nuove unità provate |

Fonti primarie:
[aggiudicazione](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti/-/papca/display/10500193),
[accertamento](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti/-/papca/display/10547155).
Gli URL esatti, hash e posizioni delle tre prove sono conservati nel report JSON
di consegna e nella proiezione.

## Audit di tutti i facts 2026 dopo la lettura

Il conteggio per tipo usa l'esito della pratica raggruppata, per non presentare
come tre notizie una ricostruzione con ristrutturazione e sopraelevazione.

| event_type | total_2026 | news_candidates | archive_only | needs_review |
|---|---:|---:|---:|---:|
| RISTRUTTURAZIONE | 1 | 0 | 0 | 1 |
| SOPRAELEVAZIONE | 1 | 0 | 0 | 1 |
| DEMOLIZIONE_RICOSTRUZIONE | 2 | 0 | 0 | 2 |
| ALIENAZIONE | 2 | 0 | 1 | 1 |
| SANATORIA | 1 | 0 | 1 | 0 |
| CONDONO | 1 | 0 | 1 | 0 |
| Totale | **8** | **0** | **3** | **5** |

**Sei pratiche distinte: tre ARCHIVE_ONLY e tre REVIEW, zero NEWS_CANDIDATE
automatici.** I cinque facts REVIEW diventano tre card. Non esistono 5–20 casi
forti dimostrati in questa base e non vengono inventati per soddisfare il target.

Terza card: pratica **21/2024/PDC**, Palombaio, via L. Ariosto angolo via Petrarca.
Il CSV primario dichiara Data Protocollo 19/12/2024 e **Data Rilascio 27/03/2026**,
campo prioritario della data amministrativa. Oggetto: ricostruzione di locali a
piano terra e sopraelevazione. I campi strutturati Via/Codice Via sono vuoti:
non è stata forzata una localizzazione o una corrispondenza all'unità.

I 237 controlli sono registrati come audit derivato, senza riscrivere i facts
preesistenti. Lo stato semantico REVIEW non equivale a una card operativa:
gli atti generici senza facts utili non entrano nella coda.

## Filtro

Policy centrale `news_triage_v1`. Coda 2026 per data amministrativa, oggi calcolato
in Europe/Rome; una card per record. NEWS_CANDIDATE/REVIEW visibili, archivio
storico esplicito. Nessuno score numerico in superficie. FROM/TO ignoti, ampiezza
non chiara, localizzazione incerta e lavori riferiti indirettamente richiedono
verifica. SCA isolata, sanatoria isolata, parti comuni, manutenzione e richiami
contabili restano contesto. Una SCA 2026 può utilizzare una trasformazione storica
dello stesso edificio, senza certificare la stessa unità.

La lettura è assistita dall'agente: **non è un holdout umano indipendente** e non
costituisce una misura di precisione commerciale.
