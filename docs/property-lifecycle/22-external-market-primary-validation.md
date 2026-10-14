# External Market Evidence — verifica primaria e follow-up

15 ottobre 2026. Base consegnata: `37e94cc`, migration 0022–0025 applicate. Audit aggiuntivo prima del nuovo adapter in [20-external-market-source-audit.md](20-external-market-source-audit.md). Questa consegna aggiunge un verificatore mirato; non certifica ancora il rollout completo dei portali.

## Implemented

- RE/MAX Stella Polare: parser isolato su JSON-LD `RealEstateListing`, vincolato a canonical e URL del dettaglio noto. Scope Bitonto/Palombaio/Mariotto, off per default, senza inventory/missing. Riusa la queue/lease V2, l'ingestion atomica, i mapping agency e le stesse proiezioni.
- DatePosted, ultimo aggiornamento, osservazione e prezzo restano prove distinte. Nessuna data incarico o data ribasso dedotta. Agency e agente derivano solo dal nodo primario pertinente; coordinate non dichiarate esatte restano approximate.
- Schema `SoldOut`/`Discontinued`: indisponibilità, non vendita confermata. Stato venduto/trattativa richiede un campo esplicito del listing: comportamento coperto da test di contratto, non da una pagina live venduta RE/MAX.
- Verifier su publication già nota, con agency assente/ambigua/diversa: conserva le evidence nella stessa property/publication e apre review, senza aggiornare presenza, agency o stato commerciale. Attribution `KNOWN_PUBLICATION_URL`, agency resolution `REVIEW_REQUIRED`, run DEGRADED.
- HTTP: serializzazione effettiva delle chiamate concorrenti sul client, rilascio dello slot dopo errore, circuit su Retry-After lungo/challenge, risposta cancellata prima di retry, backoff centralizzato. Un 500 con Retry-After lungo interrompe il detail loop e rinvia tramite la queue, senza continuare sugli altri annunci.
- Date malformate/future conservate come claim grezzi a confidence 0,45, con recorded date NULL e motivo di review. Non partecipano all'età pubblica. Timestamp ISO malformati non accettati come giorni validi.

## Migration e files changed

**0026_external_market_primary_verifier.sql** aggiunge `REMAX` alla registry fonti e al guard della RPC esistente. Il trigger exit accoda i verificatori soltanto per publication Immobiliare/RE/MAX note e fonte abilitata. Nessuna migration 0001–0025 modificata, nessuna nuova tabella immobiliare, seed agency o backfill.

Applicata sul target collegato `eqqmglsxwbsihrlecnun` il 15 ottobre, dopo dry-run limitato alla 0026. Smoke SQL successivo: sei fonti tutte off, projections off, missing false; Intelligence su 666 property, zero publication RE/MAX importate, nessun sync RUNNING. Web/runtime non distribuiti, Git non pushato.

Files: `external/{remax,adapters,http,policy,runtime}.ts`, migration 0026, test `remax-external-evidence.test.ts`, `external-verifier-runtime.test.ts`, regressioni fonte e migration, fixture RE/MAX con manifest/hash, access audit e documentazione.

## Source coverage

| Fonte | Copertura effettiva | Stato operativo |
|---|---|---|
| Wikicasa | Contratto inventory/dettaglio e retrieval indicizzati; nuovo HTTP Crocifisso ancora 403 | Off; paginazione live non certificata, nessun missing |
| Immobiliare.it | Verifier URL noti e exit; retrieval storici; nuovo HTTP ancora 403 | Off; venduto live/markup da certificare |
| Casa.it | Verifier su PDP già documentato dalle fixture V2 | Off; accesso live già bloccato nell'audit precedente |
| RE/MAX Stella Polare | **3 detail primari HTTP 200**, date/prezzo/provider/agente/immagini, fixture HTML reali sanificate | A per detail mirato, C per inventory; off, nessun crawler |
| Gabetti | Detail indicizzato 3339528 a Bitonto, agency Bari Palese Santo Spirito; HTTP primario 404 | Storico/indice soltanto; non certifica branch Bitonto o presenza corrente |
| Altri siti agency | Adapter V2 già presenti e matrice conservati | Nessun adapter duplicato |
| Idealista / search | Contratti sperimentali / import selettivo già consegnati | Off; nessuna nuova scansione generalizzata |

## Manual validation sample

Fixture `external/remax/{crocifisso,loiacono,romano}.html`: HTML ottenuto realmente via HTTP, con rimozione di script eseguibili, style, controlli, iframe, navigazione e nonce. JSON-LD primario e campi pubblici preservati. Manifest con URL, observed_at, status, SHA-256 raw e sanificato e trasformazioni: nessun HTML sintetico presentato come cattura live.

| Prova primaria | Asking osservato | Published claim | Agency / agente |
|---|---|---|---|
| [Via Crocifisso 52, rif. 41091011-176](https://stella-polare.remax.it/vendita-casa-indipendente/bitonto/centro-41091011-176) | €155.000 | 05/05/2026 | Stella Polare, Via Caduti del Lavoro / Nicola Sicolo |
| [Corte Abbate Loiacono 8, rif. 41091011-172](https://stella-polare.remax.it/vendita-appartamento/bitonto/centro-41091011-172) | €40.000 | 13/04/2026 | Stesso provider / Nicola Sicolo |
| [Via Giandomenico Romano 20, rif. 41091011-200](https://stella-polare.remax.it/vendita-appartamento/bitonto/centro-41091011-200) | €225.000 | 01/10/2026 | Stesso provider / Nicola Sicolo |

Crocifisso: modified 22/09/2026 rimane aggiornamento; non data del ribasso. La prova primaria RE/MAX attuale conferma asking 155k e published claim; le prove Wikicasa 195k/225k e Immobiliare 155k/195k del precedente retrieval restano separate. Il test PostgreSQL collega RE/MAX alla property Wikicasa esistente: due publication, nessun rilancio/falso ribasso cross-source, acquisition NULL. **Non sono state importate in produzione.**

Questo è un campione tecnico di tre detail live; non sostituisce il confronto umano su 30–50 immobili. Per Gabetti il nuovo caso in scope è [Via Generale Planelli 3339528](https://www.gabetti.it/vendita/bitonto/appartamento/3339528), recuperato dall'indice: 250k, 110 mq, agency Bari Palese Santo Spirito. Risposta HTTP diretta 404: non usarlo come positivo o fixture HTML primaria.

## Test results

- **407 unit TS / 45 file passati**, inclusi 16 casi RE/MAX e 7 runtime verifier, concorrenza/circuit/retry e date malformate.
- **98 integration passati, 25 skipped**: 84 test PostgreSQL/PGlite (50 Phase 1 + 34 Phase 2), migration effettive fino alla 0026. Include enrichment RE/MAX e trigger exit, senza riallaccio aggressivo.
- Typecheck, lint, build Next.js e design:check passati. Ultima modifica HTTP verificata nuovamente nei test unit; non modifica la UI.
- UI: 20 scenari locali della consegna precedente già passati; **nuova esecuzione non effettuata**. L'avvio del server di collaudo con fixture/credenziali fittizie è stato respinto dalla verifica automatica con «blocked by policy», anche vincolando il server a 127.0.0.1. Nessun risultato browser inventato.
- Nessun nuovo collaudo di scheduler/runtime production o ingestion commerciale sul target.

## False positive risks / what remains unknown

- Canonical/JSON-LD stabiliscono la publication; non rendono universali tutti i campi della fonte. Cambi di markup o provider ambiguo devono bloccare la promozione o andare in review.
- Agente e branch appartengono alla prova osservata, non a tutto il brand RE/MAX/Tecnocasa. OUR_AGENCY richiede registry confermata, ancora non impostata automaticamente.
- Inventory RE/MAX pubblica raggiungibile con redirect, ma lista e paginazione dipendono da hydration: nessuna completezza dimostrata né autorizzazione missing. Nessun endpoint interno utilizzato.
- Wikicasa/Immobiliare restano bloccati; HTML live multi-agency e inventory completa ancora sconosciuti. Gabetti in scope via indice non è una certificazione di presenza né della branch locale.
- Mancano date esatte dei ribassi e prove contrattuali; prezzo osservato non è prezzo di vendita. Il campione umano 30–50 e la verifica delle agenzie rimangono obbligatori per l'attivazione.
- Il circuit HTTP è per client/job; lease DB serializza i job per fonte e la queue rispetta Retry-After. Non dichiarare un cooldown persistente globale tra job diversi.

## Performance / deployment plan

Verifica mirata: una sola detail page per URL già noto, limiti HTTP comuni, nessun crawl nazionale, nessun detail FAST ripetuto aggiunto. Media/hash continuano a usare la pipeline V2 soltanto in DEEP; RE/MAX non aggiunge una scansione inventory al fan-out.

1. Schema 0022–0026 applicato; mantenere tutte le fonti Phase 2 off.
2. Distribuire web/runtime, smoke PostgREST/UI e monitorare i primi run delle fonti Phase 1. Il desktop SISTER/Tecnocloud non richiede una release.
3. Confermare registry/OUR_AGENCY e URL/publication da verificare, senza creare copie della property esistente.
4. Wikicasa observation only soltanto dopo accesso/inventory affidabili; verifica umana 30–50 prima delle projections. Nessun missing in questo schema.
5. Immobiliare exit verifier/cross-check dopo fixture live. RE/MAX può essere abilitato separatamente per URL noti dopo mapping e smoke; resta una verifica puntuale.
6. Casa, agency A/B certificate, Idealista e prove storiche selettive secondo qualità, con flag indipendenti.
