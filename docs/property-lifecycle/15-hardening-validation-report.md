# Report di validazione hardening di Property Lifecycle Radar V2

Data: 20 agosto 2026  
Branch: `property-lifecycle-v2`  
Perimetro: solo ambiente locale e fonti pubbliche; nessun deploy, nessun accesso a Supabase remoto/production, nessuna sostituzione del Listing Radar legacy.

## A. P0 risolti e non risolti

| P0 | Esito | Evidenza |
|---|---|---|
| Persistenza atomica della singola observation | **RISOLTO** | RPC PostgreSQL unica, lock logico, rollback completo ai quattro failure point, replay idempotente e contatori commit/failure sul `sync_run`. |
| Post-Exit durevole | **RISOLTO** | Fase, scadenza e tentativi persistiti; check prematuro ripianificato; tutti gli esiti derivano dal DB e non dalla memoria del worker. |

Non restano P0 tecnici aperti nel perimetro di questo hardening. Restano però limiti di prova sul matching cross-agency: sono classificati P1 perché l'algoritmo è conservativo e non esegue auto-merge in assenza di evidenza forte.

## B. Adapter PASS / PARTIAL / FAIL

Esito dopo la rivalidazione live mirata: **6 PASS, 4 PARTIAL, 0 FAIL**.

| Adapter | Stato | Live mirato | Motivo |
|---|---|---|---|
| Iconacasa | PASS | 101 raw / 101 accettati | Fonte primaria e semantica `publish_up` già dimostrate. |
| Vistocasa Bitonto | PARTIAL | 112 / 109; tre detail senza errori | Inventory WebForms embedded e segnali `Venduto` validi; la POST ASMX non ha fornito un inventario utile e le coordinate restano area/centro zona. |
| Studi Santi | PASS | 107 / 86 | ID Miogest, reference e batch media dimostrati. |
| Ad Maiora | PASS | 44 / 35 | WordPress, property ID e asset originali dimostrati. |
| Studio Casa Bitonto | PARTIAL | 52 / 46; tre detail senza errori | Publisher Casa.it vivo, ma start soltanto crawler-first-seen e blocchi sorgente intermittenti possibili. |
| Futura Immobiliare | PASS | 49 / 41 | `cod_annuncio`, AgestaNET e date articolo dimostrati. |
| Garofalo Immobiliare | PASS | 40 / 36 | API e asset originali dimostrati senza usare timestamp CDN. |
| Trio Casa | PARTIAL | 10 / 8; tre detail senza errori | Publisher TrovaCasa vivo, ma nessun timestamp proprietario e dati piano incompleti. |
| PuntoCasa Bitonto | PASS | 120 / 106 | WordPress, stati vendita/trattativa e asset dimostrati. |
| Momento Casa | PARTIAL | 4 / 4; tre detail senza errori | Publisher TrovaCasa vivo, ma start soltanto first-seen a bassa confidence. |

I quattro PARTIAL sono al massimo livello dimostrabile oggi. Non sono stati promossi artificialmente: il limite dipende dalla fonte pubblica, non da un selector rotto osservato nel run. Il comportamento resta conservativo su data, coordinate e stato.

## C. Persistenza atomica

Le scritture critiche di una observation sono state spostate in `persist_property_lifecycle_observation_atomic`. La transazione comprende:

`location/building → PROPERTY → agency listing → publication → snapshot/evidence/fingerprint → eventi → sale/lifecycle → opportunity`.

Proprietà verificate:

- advisory lock per la coppia agenzia/source key;
- rollback dell'intera transazione su errore;
- replay della stessa coppia `sync_run/publication` senza secondo snapshot logico;
- dedupe degli eventi e assenza di doppi price-change;
- conteggio separato di observation committate e fallite sul `sync_run`;
- missing observation atomica e idempotente tramite `missing_observation_commits`.

Failure injection integration:

| Punto di errore | Stato DB dopo errore | Retry |
|---|---|---|
| Dopo publication | invariato | un solo commit |
| Dopo snapshot | invariato | un solo snapshot logico |
| Durante event generation | invariato | nessun evento orfano/duplicato |
| Durante lifecycle update | invariato | lifecycle e opportunity coerenti |

Gli upload delle miniature su Storage non possono condividere la transazione PostgreSQL: avvengono dopo il commit come enrichment recuperabile e non determinano lifecycle, identity o sale state.

## D. Durabilità Post-Exit

`agency_listings` conserva ora `post_exit_check_due_at`, `next_check_at`, `check_attempt`, `last_check_at` e `monitoring_phase`. Il job è una materializzazione sostituibile dello stato persistito, non la fonte di verità.

I test integration hanno verificato:

- check prima della scadenza → `NEEDS_VERIFICATION`, stato ancora `EXIT_PENDING`, job di recheck durevole;
- seconda assenza sana e nessuna spiegazione → `OFF_MARKET_NO_SALE_EVIDENCE`;
- ritorno della publication → `REAPPEARED`;
- segnale venduto → `CLOSED_SOLD`;
- nuova agenzia sulla stessa PROPERTY → `CLOSED_SWITCHED`;
- publication privata collegata → `CLOSED_TO_PRIVATE`.

Tutti i rami sono idempotenti e riproducibili ricostruendo il repository da zero; non richiedono memoria volatile del worker.

## E. Baseline Adapter Health

È stata introdotta una baseline progressiva per agenzia con:

- numero di run riusciti;
- finestra degli ultimi 12 inventari;
- mediana rolling e variabilità;
- fingerprint schema osservato/confermato;
- streak healthy/failure;
- stato `WARMING_UP` fino ad almeno tre run stabili.

Durante il warm-up la baseline non finge storico e blocca le absence transition. Zero inventory, cali severi e schema drift degradano il run e congelano le scomparse. I test coprono primo e secondo run, stabilizzazione, calo del 20%, calo dell'80%, zero inventory e drift di schema.

Il Dry Run è intenzionalmente non mutante, quindi lo stato live locale dopo il run resta **baseline vuota / da riscaldare**. Non sono stati inventati tre run storici. Prima di usare disappearance in staging serviranno tre sync sani per ciascuna agenzia.

## F. Golden Dataset reale Property Identity

Dataset versionato: `tests/fixtures/property-lifecycle/identity-golden-live.json`.

Composizione:

- **3 SAME**: ri-osservazioni live della stessa publication stabile (Iconacasa 45212, Vistocasa 9931, Ad Maiora 17361);
- **7 DIFFERENT**: quattro casi same-building/different-unit e tre high-scoring non-match cross-agency;
- **2 UNKNOWN**, esclusi dalle metriche perché non dimostrabili.

I casi difficili includono Via Ambrosi 24, Via Aporti 42 e Via Cioffrese 89: stesso building/civico, ma UNIT diverse. Il vecchio caso PuntoCasa `ARYA` è stato riclassificato da presunto relaunch a **UNKNOWN**: la reference descrive un progetto con quattro appartamenti e non prova identità di UNIT.

Sul piccolo sottoinsieme etichettabile:

| Metrica | Risultato |
|---|---:|
| Precision | 1,00 |
| Recall retrieval | 1,00 |
| False-positive rate | 0,00 |
| False-negative rate | 0,00 |

Queste metriche dimostrano la regressione sui 10 casi verificati, non una precisione di mercato generalizzabile. I due UNKNOWN impediscono conclusioni più forti.

## G. Cross-agency match realmente dimostrati

**Cross-agency SAME verificati: 0.**

La coppia più promettente è Garofalo 10991 / PuntoCasa GU77: via, 100 mq, tre vani, piano e prezzo coincidono, ma il deep dHash massimo è 0,7188 e manca un civico o una planimetria comune. Resta `UNKNOWN/REVIEW`.

Non sono stati creati match per soddisfare un obiettivo numerico. I tre SAME del Golden Dataset sono ri-osservazioni, non switch fra agenzie.

## H. Falsi positivi e falsi negativi

Correzioni di calibrazione:

- la reference agenzia identica non basta più da sola a un merge di UNIT;
- locality, superficie fortemente divergente e famiglia tipologica incompatibile producono hard block;
- prezzo e piano partecipano allo score e forti divergenze di prezzo sono contraddizioni;
- un'immagine non corrispondente è neutra sotto la soglia forte, non una falsa prova negativa;
- media forte, civico o combinazioni coerenti di strada/superficie/vani sono richiesti per retrieval;
- address generico “Bitonto” non è prova di indirizzo.

I sette DIFFERENT non vengono auto-mergiati e i tre SAME restano recuperabili. Non è stato osservato alcun falso negativo sul Golden Dataset; il campione è troppo piccolo per escluderlo nel mercato completo.

## I. Riduzione candidati

Confronto omogeneo delle coppie cross-agency con score esplorativo ≥ 0,55:

| Indicatore | Prima | Dopo | Variazione |
|---|---:|---:|---:|
| Coppie cross-agency ≥ 0,55 | 2.179 | 166 | -2.013 (-92,4%) |
| Coppie recuperate prima dello score completo | non misurato | 895 | — |
| Valutazioni scartate dal blocking | non misurato | 139.141 | — |
| Coppie con media forte | 0 | 0 | invariato |

Nel Dry Run sequenziale sono state registrate 1.610 valutazioni candidate e 161.696 esclusioni; il conteggio differisce dall'audit pairwise perché i due strumenti misurano fasi e ordinamenti diversi. La metrica comparabile prima/dopo è 2.179 → 166.

Gli scarti derivano da contraddizioni affidabili o da assenza di una combinazione minima di evidenze; gli input con location incompleta possono ancora entrare tramite superficie/vani/piano, quindi il calo non è ottenuto imponendo un civico obbligatorio.

## J. Review Queue prima e dopo

| Indicatore | Dry Run #1 | Dry Run #2 |
|---|---:|---:|
| `REVIEW_REQUIRED` | 312 | 121 |
| Auto-match cross-agency | 0 | 0 |
| Riduzione review | — | -191 (-61,2%) |

Le 121 review residue rappresentano candidati ancora plausibili, non tutti i confronti vagamente compatibili. Nessun SAME del Golden Dataset è stato perso e nessun UNKNOWN è stato trasformato in auto-match.

## K. Bootstrap Dry Run #1 vs #2

Dry Run #2: `BOOTSTRAP ALL`, fonti pubbliche live, `max-assets=1`, Supabase locale esplicitamente forzato, durata 691 secondi. Un primo tentativo con host remoto presente in `.env.local` è stato rifiutato dal guard locale **prima di qualsiasi richiesta**.

| Indicatore | #1 | #2 |
|---|---:|---:|
| Raw inventory | 639 | 639 |
| Accettate Bitonto/Palombaio/Mariotto | 572 | 572 |
| PROPERTY uniche previste | 571 | 572 |
| Duplicate same-agency previste | 1 | 0 |
| Cross-agency ≥ 0,55 | 2.179 | 166 |
| Review required | 312 | 121 |
| Auto-match cross-agency | 0 | 0 |
| Source failure | 0 | 0 |
| Warning | 242 | 242 |

La PROPERTY aggiuntiva non è una regressione: il precedente merge `ARYA` era a livello di progetto/building, non di UNIT, ed è stato correttamente rimosso.

| Adapter | Raw | Accettati | Esclusi | Failure |
|---|---:|---:|---:|---:|
| Iconacasa | 101 | 101 | 0 | 0 |
| Vistocasa | 112 | 109 | 3 | 0 |
| Studi Santi | 107 | 86 | 21 | 0 |
| Ad Maiora | 44 | 35 | 9 | 0 |
| Studio Casa | 52 | 46 | 6 | 0 |
| Futura | 49 | 41 | 8 | 0 |
| Garofalo | 40 | 36 | 4 | 0 |
| Trio Casa | 10 | 8 | 2 | 0 |
| PuntoCasa | 120 | 106 | 14 | 0 |
| Momento Casa | 4 | 4 | 0 | 0 |

Il controllo finale ha confermato che il Dry Run non ha scritto stato: `properties=0`, `publications=0`, `sync_runs=0`, `snapshots=0`, `adapter_health_baselines=0`.

## L. Limiti residui

- Nessun SAME cross-agency è dimostrato con evidenza forte: il cuore identity resta validato in modo conservativo, non completo sul mercato reale.
- Il Golden Dataset ha soltanto 10 casi etichettati e tre SAME sono ri-osservazioni della stessa fonte.
- Restano 121 review su 572 publication; il volume è molto ridotto ma deve essere valutato operativamente.
- Vistocasa ASMX, affidabilità sorgente Studio Casa e dipendenza publisher di Trio/Momento restano limiti esterni.
- Image matching usa dHash; nessuna planimetria cross-agency identica è stata dimostrata.
- La baseline health deve ancora maturare con tre run reali sani per agenzia in un ambiente persistente.
- Le miniature Storage sono enrichment post-commit e richiedono retry separato in caso di errore.

## M. Quality Gate

| Gate | Esito |
|---|---|
| Supabase fresh reset | PASS, migration 001–031 |
| Supabase DB lint | PASS, zero errori |
| ESLint | PASS, zero errori e zero warning |
| Typecheck | PASS |
| Root unit + adapter regression + Golden Identity | PASS, 179/179 in 23 file |
| Worker | PASS, 123/123 in 17 file |
| Integration / failure / lifecycle | PASS, 24/24 |
| Playwright desktop/mobile/dossier/smoke | PASS, 4/4 |
| Next.js production build | PASS |

Nel run worker completo non è comparso `MaxListenersExceededWarning`; il fix precedente resta coperto dalla suite e non è stato mascherato aumentando `setMaxListeners`.

Playwright ha inoltre rivelato che il test Lifecycle non autenticava la workspace quando `AUTH_REQUIRED` era attivo. È stato aggiunto un percorso di login esplicito per i run autenticati; il gate finale è stato eseguito in modalità locale controllata con auth disabilitata, senza modificare `.env.local`.

## N. Giudizio finale

**NOT READY FOR STAGING**.

Il sistema è sensibilmente più robusto: entrambi i P0 sono chiusi, la baseline health è conservativa, i candidati sono scesi del 92,4%, la review del 61,2% e il quality gate è interamente verde. Tuttavia, una funzione centrale — l'identità della stessa UNIT fra agenzie diverse — non ha ancora neppure un SAME reale dimostrato. Dichiarare staging-ready ora trasformerebbe l'assenza di auto-merge in sicurezza presunta.

Per una nuova valutazione servono:

1. maturazione della baseline con almeno tre run sani per agenzia in un ambiente persistente;
2. ampliamento del Golden Dataset con SAME cross-agency provati da foto/planimetria o civico più caratteristiche forti;
3. audit operativo delle 121 review residue e conferma che il volume sia sostenibile.

Non è richiesta né autorizzata alcuna azione su production.
