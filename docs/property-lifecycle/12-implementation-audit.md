# Audit implementativo di Property Lifecycle Radar V2

Data audit iniziale: 19 agosto 2026  
Branch: `property-lifecycle-v2`  
Commit di riferimento: `5bbc0d3`

## Scopo e metodo

Questo documento fotografa il codice V2 **prima** dei fix derivanti dalla validazione live. Il perimetro esaminato comprende adapter, contratti, sync engine, persistenza, identity, lifecycle, media, Building Intelligence, Private Radar, job queue, read model, UI, migrazioni e test.

Sono state censite circa 20.700 righe nel perimetro V2 applicativo, test e documentazione. La ricerca statica non ha trovato `TODO`, mock o sample data usati nel runtime degli adapter. Le fixture sono confinate ai test. Le URL e gli identificatori hard-coded individuati sono in prevalenza configurazione necessaria delle fonti pubbliche, non dati immobiliari fittizi.

Le classificazioni usate sono:

- **CRITICO**: rischio immediato di perdita dati, falsa conclusione massiva o accesso production;
- **ALTO**: rischio concreto di falsa identity/lifecycle conclusion o incoerenza persistita;
- **MEDIO**: incompletezza funzionale o debito che riduce verificabilità/manutenibilità;
- **BASSO**: problema circoscritto senza impatto diretto sulle conclusioni;
- **OK**: controllo presente e coerente con i guardrail.

## Sintesi iniziale

Non è emerso accesso implicito a Supabase production: worker e Dry Run rifiutano host non locali. Non è emerso codice che cancelli il legacy o inferisca `SOLD` dalla sola scomparsa. Tuttavia, prima della prova live, il sistema non può essere dichiarato pronto per staging a causa dei punti **ALTO** sotto elencati.

## CRITICO

Nessuna criticità statica già dimostrata in questa fase. La classificazione potrà cambiare dopo il Dry Run live se una fonte strutturalmente valida produce transizioni errate o se vengono osservati falsi auto-match.

## ALTO

### A-01 — Property Identity usa solo una parte dei segnali dichiarati

File principale: `src/lib/property-lifecycle/identity/scoring.ts`.

Il modello implementato usa reference agenzia, indirizzo tokenizzato, località, superficie, vani, tipologia, immagini e planimetrie. Non usa ancora come componenti autonome:

- civico;
- coordinate e micro-location;
- piano;
- bagni e dotazioni distintive;
- compatibilità prezzo;
- similarità descrizione;
- prossimità temporale;
- storia lifecycle/agenzia.

Il punteggio viene rinormalizzato sul solo peso disponibile. Un singolo candidato con stesso indirizzo/località/superficie/vani/tipologia può quindi superare la soglia `AUTO_MATCH` anche senza immagine o planimetria. Il margine protegge quando esistono più candidati simili, ma non quando nel database esiste ancora un solo appartamento dello stesso edificio. Rischio: falso merge cross-agency in condomini con unità omogenee.

### A-02 — Health gate senza baseline storica dei conteggi

File principali: `src/lib/property-lifecycle/adapters/shared.ts`, singoli adapter, `sync/engine.ts`.

`classifyInventoryHealth` verifica marker, zero inventory, error ratio e completezza della paginazione osservata. Non confronta però il conteggio live con l’ultimo inventario sano dell’agenzia. Se una fonte restituisce una porzione strutturalmente valida e dichiara coerentemente una paginazione ridotta, può risultare `HEALTHY`; due run consecutivi potrebbero allora produrre uscite massive. La validazione live deve misurare questo rischio per ciascuna fonte.

### A-03 — Persistenza di una observation non atomica

File principale: `src/lib/property-lifecycle/persistence/repository.ts`.

`persistObservation` esegue numerose scritture sequenziali su location, building, property, agency listing, publication, snapshot, evidence, fingerprint, eventi e opportunità senza una transazione database unica. Un errore intermedio può lasciare stato parziale. Le chiavi idempotenti riducono i duplicati al retry, ma non garantiscono rollback completo né coerenza di ogni combinazione di failure.

### A-04 — Post-exit classification non applica internamente un periodo minimo

File: `src/lib/property-lifecycle/persistence/repository.ts`, metodo `runPostExitCheck`.

Il metodo classifica immediatamente un record rimosso come `OFF_MARKET_NO_SALE_EVIDENCE` quando non trova vendita, nuova agenzia o privato. Non verifica da solo tempo trascorso, numero di controlli o una finestra configurata. La sicurezza dipende quindi interamente da chi accoda `POST_EXIT_CHECK`, scheduler che al momento non è attivo. Un job accodato troppo presto può produrre una conclusione commerciale prematura.

## MEDIO

### M-01 — Il fingerprint percettivo è dHash, non pHash

File: `src/lib/image/inspection.ts`.

L’algoritmo ridimensiona a 9×8 grayscale e confronta pixel adiacenti: è un `dHash` a 64 bit. Il campo viene correttamente etichettato `DHASH64` nella logica identity, ma documentazione e aspettative di validazione non devono chiamarlo pHash. Robustezza a crop, watermark e trasformazioni forti deve essere provata live e probabilmente resterà parziale.

### M-02 — Floorplan classification e matching limitati

File: `src/lib/property-lifecycle/assets/pipeline.ts`.

La classificazione `FLOORPLAN` dipende dal tipo fornito dall’adapter o da pattern nel pathname (`planimetr`, `piantina`, `floorplan`, `pianta`). Non esiste classificatore visuale, embedding o riconoscimento robusto di logo/rendering. Il matching usa lo stesso dHash delle foto. Rischio: planimetrie con URL anonime classificate come foto e layout graficamente simili sovrastimati.

### M-03 — Dry Run non espone tutte le metriche richieste

File: `src/lib/property-lifecycle/bootstrap/dry-run.ts`.

Il report corrente espone inventory, accepted/excluded, errori, property previste, duplicate/cross-agency/review. Non aggrega direttamente distribuzioni di market-start confidence, location precision e sale status; inoltre le decisioni non includono i component score dei candidati. Questi dati possono essere derivati durante la validazione, ma il report nativo non è sufficiente da solo per l’audit richiesto.

### M-04 — Review UI non mostra tutta l’evidenza identity dichiarata

File: `app/(private)/lifecycle/review/page.tsx`.

La UI confronta dossier, fatti e contraddizioni, ma non mostra ancora vecchia/nuova thumbnail né tutti i component score. La decisione è auditata e non esegue merge automatico, aspetto positivo; la velocità e qualità della review restano da dimostrare con casi live.

### M-05 — Moduli di persistenza e bridge molto grandi

File: `persistence/repository.ts` (~2.200 righe), `private-radar/bridge.ts` (~1.100), `read-models/repository.ts` (~900).

Le responsabilità sono distinguibili, ma concentrate in classi estese. Questo aumenta il costo di revisione e il rischio che un fix adapter/lifecycle tocchi aree non correlate. Non è previsto un refactor estetico; si interverrà solo se la validazione dimostra bug o impedimenti concreti.

### M-06 — Possibile concorrenza fra sync della stessa agenzia

Queue e dedupe evitano molti duplicati, ma non esiste un lock esplicito per agenzia condiviso fra `SYNC`, `DEEP_SYNC` e job con dedupe key differenti. Run sovrapposti possono leggere/scrivere publication state e missing count in ordine non deterministico. Va verificato e documentato; nessun scheduler production è attivo.

### M-07 — Opportunity fallback per property senza agency listing

In `refreshPropertyIntelligence`, l’assenza completa di agency listing usa come fallback `OFF_MARKET_NO_SALE_EVIDENCE`, generando potenzialmente `HIGH`. Una property nata soltanto da Private Radar potrebbe quindi ricevere una priorità che semanticamente presuppone un’uscita da agenzia. La validazione su dataset locale deve confermare se il caso si manifesta.

## BASSO

### B-01 — Messaggio worker obsoleto ma ramo difensivo

Il worker termina con l’errore “reserved but not implemented in milestone 1”. Tutti i job attualmente ammessi dal tipo e dal vincolo SQL sono però gestiti nei rami precedenti. Non è uno stub raggiungibile con un `LifecycleJobType` valido; il testo è solo obsoleto.

### B-02 — Duplicazioni di helper locali

Sono presenti piccole duplicazioni (`stringValue`, `unique`, parsing JSON) tra adapter e repository. Non risultano ancora causa di divergenze critiche. Un consolidamento generale non è giustificato senza bug provato.

### B-03 — Limiti hard-coded nei read model

Archive, review, snapshot ed eventi usano limiti prudenziali. Sono adatti al dataset locale iniziale ma dovranno essere osservati con un inventario live più ampio per evitare UI parziale senza indicazione sufficiente.

## OK

- Guardrail locale: worker e Bootstrap Dry Run rifiutano Supabase non loopback.
- Nessun deploy, link remote o sostituzione legacy nel codice V2.
- Absence evaluation bloccata per `DEGRADED`, `FAILED`, `STRUCTURE_CHANGED` o inventory incompleto.
- Una singola assenza sana produce `MISSING_PENDING`; la rimozione richiede almeno due run sani.
- `SOLD` deriva da evidenza esplicita/manuale, non dalla sola scomparsa.
- Gli override manuali hanno precedenza e generano evento auditabile.
- Eventi e snapshot usano chiavi di deduplica e migrazioni additive.
- Adapter isolati dietro un contratto comune e accesso HTTP con timeout/retry.
- Fixture e sample data non sono usati come inventory runtime.
- Private Radar mantiene separate publication private e agency publication e applica minimizzazione PII.
- Building Intelligence lavora a livello building/civico e non promuove automaticamente una pratica a specifica property.

## Stato statico dei dieci adapter prima della prova live

| Adapter | Implementazione runtime | Fonte codificata | Stato dimostrato in questo audit |
| --- | --- | --- | --- |
| Iconacasa | Completa sul piano strutturale | sito agenzia | Non ancora validato live |
| Vistocasa | Completa sul piano strutturale | sito agenzia | Non ancora validato live |
| Studi Santi | Completa sul piano strutturale | sitemap + detail | Non ancora validato live |
| Ad Maiora | Completa sul piano strutturale | archivio WordPress + REST | Non ancora validato live |
| Studio Casa | Completa sul piano strutturale | Casa.it publisher | Non ancora validato live |
| Futura | Completa sul piano strutturale | AgestaNET | Non ancora validato live |
| Garofalo | Completa sul piano strutturale | sito + API Flazio | Non ancora validato live |
| Trio Casa | Completa sul piano strutturale | TrovaCasa publisher | Non ancora validato live |
| PuntoCasa | Completa sul piano strutturale | sito WordPress | Non ancora validato live |
| Momento Casa | Completa sul piano strutturale | TrovaCasa publisher | Non ancora validato live |

## Decisione pre-live

**NOT READY FOR STAGING** fino a completamento di:

1. inventory e detail fetch reali per tutti gli adapter;
2. campione live e verifica manuale delle evidenze;
3. Bootstrap Dry Run live;
4. audit dei top cross-agency candidate e dei non-match ad alto punteggio;
5. prova media/floorplan reale;
6. analisi dei rischi A-01…A-04;
7. quality gate completo dopo gli eventuali fix.

## Addendum post-validazione live

La prova live ha confermato che fixture e test verdi non erano sufficienti. Sono emersi i seguenti difetti reali, tutti riprodotti prima del fix:

| ID | Severità | Difetto osservato live | Esito |
| --- | --- | --- | --- |
| L-01 | CRITICO | `identityCandidates()` inseriva fino a 500 UUID in tre query PostgREST; oltre 208 PROPERTY ogni nuova observation falliva con `URI too long`. | Corretto con batch da 75 ID e regressione integration oltre la soglia. Prova live: 533 PROPERTY persistite senza errore. |
| L-02 | ALTO | Il read model Archive/Review/Private idratava 200–300 UUID in singole query e falliva con `URI too long` sul dataset reale. | Corretto con batching uniforme; Playwright live 3/3. |
| L-03 | ALTO | PuntoCasa includeva otto locazioni nell'inventario “vendita” e le dichiarava `transactionType: SALE`. | Corretto filtrando la tassonomia dei card e rifiutando difensivamente detail `Affitto/Locazione/Rent to buy`; 128 raw dichiarati, 8 affitti esclusi, 120 inventory non-affitto. |
| L-04 | ALTO | Due match cross-agency falsi superavano la precedente regola di auto-merge grazie a segnali disponibili rinormalizzati e indirizzi generici. | Corretto: località generiche escluse dai token indirizzo e auto-match consentito solo con reference della stessa agenzia o evidenza media forte. Dry Run finale: zero auto-match cross-agency. |
| L-05 | ALTO | Iconacasa usava HTML incompleto: superfici `M2144/M2105`, nessun `publish_up`, e fallback crawler come data inizio. | Corretto con JSON pubblico autenticato da token/cookie, riconciliazione 101/101, `sqft` corretto e `ICONACASA_PUBLISH_UP`; `modified` resta solo provenance. |
| L-06 | ALTO | Studio Casa effettuava un detail request per ogni record Casa.it; la fonte iniziava a rispondere 403 dopo circa 31 richieste. | Corretto usando come detail primario il payload inventory pubblico completo; Dry Run finale 52 raw, 46 accettati, zero errori. Il blocco IP intermittente resta un limite operativo. |
| L-07 | MEDIO | Una coordinata Vistocasa malformata (`410638,164041`) faceva fallire l'intera normalizzazione della pubblicazione. | Corretto: coordinate fuori range diventano `null` senza perdere l'annuncio. |
| L-08 | MEDIO | Un override manuale post-exit `EXIT_PENDING` sarebbe stato scritto nell'outcome DB, che accetta invece `NEEDS_VERIFICATION`. | Corretto con classificatore puro e regressione per tutti gli outcome post-exit. |
| L-09 | MEDIO | La Review persisteva e idratava fino a 500 candidate PROPERTY per caso: 141.578 righe su un bootstrap e processo Next a circa 5,4 GB. | Corretto: calcolo completo invariato, top 10 persistiti e top 3 presentati; UI live 3/3 in 10,6 s. |
| L-10 | MEDIO | `WorkerPrompts` apriva `readline` nel field initializer; istanze ripetute nei test aggiungevano listener `end` a `stdin` e producevano `MaxListenersExceededWarning`. | Corretto con inizializzazione lazy e chiusura esplicita, senza `setMaxListeners`; 123 test worker con trace, nessun warning. |
| L-11 | BASSO | Gli artefatti PowerShell recenti erano UTF-16LE e lo script identity li ignorava silenziosamente come JSON non valido. | Corretto il lettore diagnostico con riconoscimento BOM; audit finale su tutti i 572 record. |

Restano aperti i rischi architetturali A-02 (baseline health storica), A-03 (observation non transazionale), A-04 (finestra post-exit affidata all'orchestrazione), M-01/M-02 (dHash e floorplan limitato), M-05/M-06/M-07. Non sono stati nascosti con refactor estetici o nuove feature.

La conclusione post-live resta **NOT READY FOR STAGING**: gli adapter acquisiscono realmente il mercato pubblico, ma Property Identity cross-agency non ha ancora prodotto un match forte dimostrato e 312 pubblicazioni richiedono review nel Dry Run pulito.
