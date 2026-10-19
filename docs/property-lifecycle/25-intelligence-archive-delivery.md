# Listing Radar: archivio Intelligence, consegna del 19 ottobre 2026

## Release e target

- Base: `ab233ef`, successiva alla Phase 2 consegnata e al rollout operativo.
- Implementazione: `bc57e0a`; correzioni emerse dallo smoke: `eeb05c7`, `ecfd885`
  e successiva correzione del giorno di osservazione fra server UTC e browser.
- Production: <https://listing-radar-mu.vercel.app>.
- Supabase autorizzato: `eqqmglsxwbsihrlecnun`, migration **0001–0034** allineate.
- Nuova migration: `0034_intelligence_archive_public_records.sql`; nessuna migration
  precedente modificata e nessuna cancellazione/compattazione dello storico.
- Nessuna modifica o distribuzione del desktop SISTER/Tecnocloud.
- Audit eseguito prima delle modifiche UI/DB: [matrice di route, caller e fonti](24-intelligence-archive-audit.md).

## Navigazione prima / dopo

| Prima | Dopo |
| --- | --- |
| Oggi, Acquisizioni, Mercato, Diario, Immobili, Intelligence, Commerciale, Territorio | **Intelligence, Territorio, Fonti**, più Impostazioni |
| Entrata `/dashboard`, dashboard del giorno | Entrata e login in `/intelligence` |
| Archivi e opportunità divisi fra più sezioni | Mercato, Opportunità, Usciti, Venduti nel medesimo archivio |
| Quick request globale, diario nel dossier, “Porta in Acquisizioni” | Consultazione del dossier e delle prove; nessuna pipeline obbligatoria |
| Mappa del lavoro sul campo, pin/attività/aree | Mappa consultiva delle property V2 e ricerca documentale |

`/dashboard`, `/listings`, `/lifecycle` e le aree `/acquisition/**` e `/logbook/**`
rimandano all'archivio. `/lifecycle/opportunities` rimanda alla vista Opportunità.
Le route di compatibilità, le azioni, i lead, signal/activity, appuntamenti,
contatti, note e diario storico restano conservati. Non sono stati cancellati
map_areas/map_streets/map_pins/map_activity_logs, richieste o portafoglio CRM.
La sezione tecnica delle corrispondenze rimane raggiungibile dalle Fonti.

## Intelligence: copertura e comportamento

`market_observer_property_archive` è una **proiezione**, non un archivio parallelo:
parte da `properties` e conserva gli immobili senza publication corrente.
Una sola riga per property non MERGED. Il rapporto attivo precede un vecchio
rapporto chiuso, anche se quest'ultimo ha un aggiornamento più recente; la nostra
filiale attiva mantiene la precedenza già adottata dal motore Phase 2.

- Archivio rilevato: **673 immobili**; prima osservazione invariata in **667/667**
  record confrontabili con il precedente freeze.
- Stato, agenzia, prezzo richiesto, caratteristiche, date, fonti, conteggio
  publication/evidence e provenienza, con accesso al medesimo `/casa/[id]`.
- Ricerca libera per indirizzo, agenzia, zona e località. Filtri per agenzia,
  località/zona/stato/tipo, prezzo, m², età mercato, ribassi e fonte publication.
- Il filtro fonte usa l'adapter/portale, **non** l'ID numerico dell'annuncio.
- Opportunità separata dai fatti; motivi e versione espliciti. La specifica
  filiale Tecnocasa confermata dall'utente resta esclusa dai lead competitor.
- Venduti distingue segnale confermato/probabile e data vendita/riscontro;
  l'importo resta **ultimo prezzo richiesto**, mai prezzo di compravendita.

Tempi SQL/API misurati nel primo controllo reale: 40 righe di ciascuna vista
in circa **1,6–2,1 s**. Sono tempi di lettura, non misure di TTI del browser.

## Fetch: problemi, interventi e risultati reali

| Fonte | Prima / problema verificato | Intervento | Dopo |
| --- | --- | --- | --- |
| Studi Santi | 403 Cloudflare su sitemap e homepage | Nessun bypass e nessun health falso; problema ora leggibile nelle Fonti | Run `0b45523c-fe0c-4ac6-91eb-79abff75f48b`: FAILED, 0 osservazioni, 0 missing, assenze non autorizzate. Fonte ancora bloccata |
| Studio Casa | Precedente run FAILED/403; profilo agenzia bloccato, inventory dedicata oggi leggibile | Riutilizzato l'adapter V2 già corretto, con dati strutturati dell'inventory e senza fetch dei dettagli bloccati | Run `5dda2495-72e1-4a42-a770-c0915e7ac3b0`: HEALTHY, 52 record, 3/3 pagine, 48 in scope, 0 missing; baseline non ha ancora autorizzato assenze |
| PuntoCasa | Un vecchio URL reindirizza a un immobile diverso, con prezzo e m² diversi | Rifiuto di response URL/canonical con identità diversa prima di persist | Destinazione `...via-palombaio-3` non aggiorna la vecchia scheda. Nessun falso ribasso o merge |
| Vistocasa | Vecchi dettagli terminano su 404/ricerca generale con HTTP 200 | Controllo di `articoliid` della risposta e canonical | Le due destinazioni reali vengono rifiutate; nessuna falsa osservazione positiva |
| Verifier HTTP | La parola reCAPTCHA nel footer veniva confusa con un blocco della pagina | Distinzione fra modulo contatti e vera challenge | Pagine ordinarie leggibili; 403/401, Cloudflare e verifica umana restano bloccati |

Non sono state riscritte indiscriminatamente fonti sane. Audit HTTP con adapter
reali: Ad Maiora 45/8 pagine; Futura 57/7; Garofalo 42/1; Iconacasa 107/6;
Momento 2/1; PuntoCasa 84/16; Trio 10/1; Vistocasa 112/1, payload mappa completo.
Duplicati intermedi Iconacasa riconciliati per identità. Inventario sano non
equivale automaticamente a missing autorizzato: restano baseline, completamento
run, grace period e tutte le protezioni Phase 1.

## Territorio e hover

La mappa legge tutte le property, senza filtro “solo attive”. Gli immobili senza
coordinate restano nell'elenco consultabile e non ricevono posizioni inventate.
La prima lettura misurava 308 posizioni; dopo la run Studio Casa, lo smoke UI ne
ha rilevate **312**, con **361** immobili ancora senza coordinate.

- Ricerca locale immediata, filtri di stato e clustering con apertura dei gruppi.
- Stati distinti: attivo, segnale vendita, non più rilevato/uscita, sconosciuto,
  indizi di opportunità. Etichette oltre al colore.
- Hover con indirizzo, agenzia, agente quando dichiarato, asking e primo asking,
  ribassi, caratteristiche disponibili, età/date, fonti, prove e pratiche edificio.
- Click o Enter apre il dossier; sul telefono il tap apre la medesima scheda.
- Precisione della posizione sempre dichiarata; coordinate di portale non
  diventano automaticamente prova del civico.
- Correzione emersa dallo smoke: contrasto e clipping del tooltip Leaflet nel
  tema scuro. CSS Module dedicato, posizione laterale automatica e marker nominati
  per la navigazione assistita.

Non sono state cancellate geometrie o attività del vecchio workspace operativo.
Queste non vengono però presentate come diario o compiti nella nuova Territorio.

## Dossier unico

Panoramica, storico/prove, pubblicazioni, territorio e documenti sono sezioni
interne di `/casa/[id]`. Rimossi diario operativo e CTA Acquisition OS.
Lo score è un dettaglio espandibile; le correzioni fattuali con motivo e autore
restano disponibili. I valori umani non vengono sovrascritti.
L'agente primario viene letto dalla proiezione corrente e mostrato con link alla
prova. Non viene dedotto dall'appartenenza all'agenzia.
Chiave cache dossier revisionata per non riutilizzare fra deploy il vecchio DTO
privo dell'agente; TTL e invalidazione fattuale restano invariati.

I documenti sono una lettura separata: se il registro non risponde, il resto del
dossier rimane consultabile. Non viene mostrata una falsa assenza di documenti.

## Public Records: cosa è implementato e cosa no

È riutilizzato `building_practice_records`, con nuove colonne documentali opzionali,
insieme a `building_practice_observations`, `building_practice_buildings`,
`building_data_import_runs` e `buildings`. Nessuna seconda property table.

| Fonte | Stato | Copertura effettiva |
| --- | --- | --- |
| Open data comunali pratiche edilizie 2024 | **READY** | 1.190 pratiche già raccolte, 509 associazioni edificio. Tipi derivati soltanto da `practice_type` esplicito; nessun dato personale del CSV esposto |
| Catalogo ufficiale SIT / PRG | **READY per metadati e URL** | 22 link PDF primari, comprese tavole Palombaio/Mariotto. Nessun PDF scaricato in massa o interpretazione normativa automatica |
| Albo / Amministrazione Trasparente | **PARTIAL** | HTTP 200 verificato, 306 risultati/16 pagine e ID stabili. Alcune ordinanze contengono vie/civici; non ancora ingestione degli atti/PDF |
| SUE / sportello telematico | **NOT AVAILABLE come inventario pratiche** | Homepage e moduli accessibili; contatore aggregato non è un elenco di pratiche. Nessuna automazione autenticata |
| SIT viewer / WMS | **PARTIAL / non operativo** | Link ufficiali verificati, viewer non recuperabile in questa sessione. Nessuna geometria normativa attribuita alle property |
| Altri anni/dataset, SUAP, condoni/sanatorie non presenti nei record esistenti | **NON DIMOSTRATI** | Nessuna copertura inventata |

Il catalogo PRG è collegato al job edilizia settimanale esistente. Primo import:
**22 insert**, replay **0 insert / 0 update**, nessuna nuova versione inutile.
Hash dei metadati sanitizzati e pagina sorgente, URL originale, prima/ultima
osservazione. Data documento e data pubblicazione restano NULL se non dichiarate.
Il vecchio `occurred_at` di pratica non viene rinominato tacitamente in data
documento/pubblicazione.

### Matching documentale

- Civico esatto e strada normalizzata: contesto **edificio** ad alta confidenza.
- La singola unità resta **REVIEW** senza prova specifica; il dossier lo dichiara.
- Via senza civico: ricerca contestuale, nessun aggancio automatico all'unità.
- Foglio/particella/subalterno del registro restano come riferimenti dichiarati;
  non è stato costruito un risolutore catastale implicito.
- Nome del proprietario mai utilizzato come chiave di associazione.
- PRG/DPP restano documenti di area; nessuna certificazione di conformità,
  proprietà, destinazione urbanistica o presenza/assenza di abusi.

## Validazione automatica dei 50 immobili congelati

Stessi 50 ID, nessuna selezione opportunistica di un nuovo campione.
Output completo e catture verificabili nella cartella locale:
`C:/Users/ruggi/listing-radar-validation/2026-10-19/archive-validation/`.

| Classe | Immobili | Significato |
| --- | ---: | --- |
| AUTO_VALIDATED | **9** | Publication nota riletta; identità della publication, agenzia, asking esplicito, superficie e altri campi disponibili coerenti |
| REVIEW_REQUIRED | **1** | PuntoCasa Via Palombaio, reindirizzamento ad altra scheda. Non ingerito sulla vecchia property |
| UNVERIFIABLE | **40** | 15 Studi Santi bloccati; altri URL storici non più disponibili, dettagli non sufficienti o 2 asking non pubblicamente dichiarati |

**Non** significa 9 identità immobiliari certificate fra più fonti. I controlli
sono automatici e nessuna ground truth umana è stata inventata.
Nei campi confrontabili: prezzo esplicito **9/9**, agenzia **11/11**, superficie
normalizzata **11/11**, locali disponibili **10/10**, indirizzo-strada **7/7**,
identità publication **11/11**, prima osservazione preservata **11/11**.
I denominatori differiscono perché NULL e dati non pubblicati non sono successi.
Questi sono accordi tecnici con la fonte, **non** precision/recall certificati.

Precisione dell'auto-match property, false merge e false split: **NON MISURABILI
con ground truth indipendente in questo campione**. Non vengono dichiarati raggiunti
i target 95%/98% sulla base della sola concordanza con il parser.

Fra 16 casi del campione con civico preciso è emersa una coppia nello stesso
edificio e con m² simili: Via Rossini 51, 120 m². Conservata come possibile
ambiguità di unità; **nessun merge**. Nessuna richiesta all'utente di ricontrollare
manualmente i fatti già verificabili via HTTP.

Esempi reali AUTO_VALIDATED:

- Via Crocifisso 52, RE/MAX: €155.000, 106 m².
- Via Domenico Urbano 41, Ad Maiora: €150.000, 100 m².
- Via Privata Ingegner L. Ambrosi 24, Ad Maiora: €110.000, 90 m².
- Via Traetta, PuntoCasa: €268.000, 110 m².
- Via Repubblica, PuntoCasa: €50.000, 50 m².

File: `validation-50.json`, `validation-50.md`, `metrics.json`, `captures/*.json`,
`possible-duplicates.json`, `operational-checks.json`, `top20-after.json`.
Gli UNVERIFIABLE conservano le evidenze storiche: un URL oggi assente non rende
falsa un'osservazione passata e non dimostra una vendita.

## Score: prima / dopo

Prima, un'uscita senza esito noto valeva 85 punti e l'età 25: molti record
raggiungevano 100 anche senza ribassi. Ora l'uscita vale al massimo 25, età 30,
ribassi complessivamente 20, ripubblicazioni 15; instabilità/passaggio a privato
non dominano da soli la graduatoria. Configurazione centrale, non frontend.

Ricalcolate **673 property, 0 errori**, versione esplicita
`market_observer_calibrated_v2`, con componenti, ragioni e stato
`NOT_HUMAN_CALIBRATED`. Top 20 successivo: **30–55**, anziché concentrazione
artificiale a 100. Il riequilibrio non è presentato come calibrazione umana
né probabilità di successo verificata.

## Golden case: Crocifisso 52

Property `53390232-8a25-446e-b832-4841f513e877`, sempre una sola scheda.

- RE/MAX Stella Polare, filiale Via Caduti del Lavoro; Nicola Sicolo soltanto
  perché dichiarato dalla prova primaria della singola publication.
- Asking corrente/primo osservato: €155.000; 106 m², 3 locali.
- Prima osservazione nostra: 19 ottobre 2026. Claim pubblicazione: 5 maggio 2026.
- Età pubblica dimostrabile al controllo del 19 ottobre: almeno 167 giorni.
- Modifica primaria corrente: 17 ottobre 2026; la precedente prova 22 settembre
  resta nello storico, non diventa data certa di ribasso.
- Acquisizione/mandato: NULL, nessuna data dedotta dalla pubblicazione.
- WIKICASA €195k / precedente €225k e IMMOBILIARE €155k / precedente €195k
  restano claim storici distinti, con data del cambio non dichiarata.
- Nessun falso PRICE_DROP fra portali, nessun relisting e nessuna nuova property.
- Score aggiornato: 30, componente anzianità. Nessuna previsione contrattuale.

## Test e verifiche

- Vitest completo, eseguito anche con server timezone UTC: **528 PASS, 25 SKIP**,
  56 file passati e 2 saltati.
- SQL su PostgreSQL/PGlite: migration 0034 reale, archivio senza listing corrente,
  selezione rapporto attivo contro chiuso più recente, nessuna duplicazione della
  property, registro documentale, date NULL, anon senza accesso, pesi score.
- Regressioni: redirect PuntoCasa, soft-404/ricerca Vistocasa, vero 403 Studi Santi,
  challenge autentica contro reCAPTCHA footer; fixture reale catalogo PRG,
  host/struttura/count, deduplicazione, fallimento senza ingestione.
- `npm run typecheck`, `npm run lint`, `npm run build`: PASS.
- `npm run design:check`: token allineati e contrasto PASS nei due temi.
- Timestamp delle osservazioni in Europe/Rome, deterministici fra Vercel e browser,
  con regressione ora legale/solare; i claim di data restano distinti dagli istanti di osservazione.
- Lo smoke ha rilevato un errore React di idratazione nel dossier: un'osservazione
  delle 23:15 UTC appariva il 14 ottobre sul server e il 15 nel browser. Riprodotto
  con dev server UTC, corretto centralmente in `formatDate`/`formatTime`, senza
  cambiare il dato salvato. Test del passaggio di mezzanotte e fine mese, e claim
  data-only preservato; nessun nuovo errore testuale nella rilettura locale.
- HTTP senza sessione: `/intelligence`, `/map`, `/fonti` → 307 `/login`;
  `/api/health` → 200. Nessuna autenticazione indebolita.
- Smoke autenticato production: ricerca Crocifisso, dossier e prove, assenza
  di CTA CRM/diario, Territorio con tutti gli stati e marker del golden case,
  catalogo documenti e pagina Fonti con 403/health/baseline reali.
- Hover e focus da tastiera verificati su dati reali: fondo petrolio e testo
  crema, contrasto leggibile, nessun clipping superiore della scheda.
- A 390 px, larghezza documento 380 px su viewport 390 px: nessun overflow
  orizzontale della pagina; navigazione, ricerca e catalogo documentale consultabili.
- Dossier verificato anche a 1024 e 1600 px. A Piazza Cattedrale 23 è consultabile
  la pratica 3/2024/SCA del 9 gennaio 2024, protocollo 1014, con fonte, hash e
  riferimento catastale: collegamento all'edificio, unità ancora da verificare,
  nessuna certificazione automatica. Tap mobile sul marker apre il dossier.

Le 25 integrazioni saltate non vengono dichiarate eseguite. Il typecheck web non
equivale a certificare tutti i test/build del desktop monorepo, non modificato.

## Limiti e stato delle fonti

| Fonte / area | Stato operativo |
| --- | --- |
| Core Market Observer / archivio consultivo | READY WITH LIMITATIONS: copertura e dati mancanti espliciti |
| RE/MAX | PRIMARY LIVE, solo verifier di publication note, missing OFF |
| Wikicasa / Immobiliare.it / Casa.it generalizzati / Idealista / search live | DISABLED; claim storici conservati dove già disponibili |
| Studio Casa, inventory dedicata V2 esistente su Casa.it | LIVE con dipendenza upstream intermittente; non è attivazione del verifier Casa.it generalizzato |
| Studi Santi live | NOT READY / 403, nessuna falsa assenza |
| Opportunity ranking | Indicativo e riequilibrato, non validato umanamente come probabilità commerciale |
| Sold Radar | Prove e ultimi asking consultabili; compravendite e prezzi reali non certificati |
| Public Records | READY per registro già importato e catalogo PRG; PARTIAL per copertura comunale complessiva |

Le nostre conoscenze restano limitate da indirizzi parziali, coordinate
approssimative, URL storici indisponibili e fonti bloccate. Albo/SUE/SUAP/WMS
non sono presentati come una banca dati documentale completa. Non sono stati
aggiunti portali o workaround anti-bot per nascondere questi limiti.

## Deployment e monitoraggio

1. Verifica migration 0001–0033 sul target; applicazione 0034, compatibile con
   web/runtime precedenti e schema cache PostgREST ricaricata.
2. Deploy web/runtime via main; verifica degli stati deployment GitHub/Vercel.
3. Ricalcolo proiezioni e import catalogo con replay; smoke dati e UI autenticata.
4. Run mirate Studio Casa/Studi Santi con coda/lease esistenti e controllo zero
   missing da lettura fallita; scheduler edilizia verificato sul runtime main.
5. Fonti esterne mantenute ai flag precedenti. Non esiste rollout automatico
   di nuovi portali come conseguenza della nuova UI.

Workflow remoto **39327129747**, commit `eeb05c7`, job BUILDING_DATA_SYNC:
**SUCCESS**. Verifica la distribuzione del runtime Lifecycle via main e il
collegamento dell'import documentale al job esistente, senza desktop release.

Monitorare 403, completezza inventory e baseline Studio Casa, errori dettaglio
per identità cambiata, copertura delle coordinate e import settimanale del
catalogo. Espandere la conoscenza soltanto con prove accessibili e verificabili.
