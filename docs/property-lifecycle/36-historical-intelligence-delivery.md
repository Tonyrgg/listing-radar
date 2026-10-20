# Public Records Phase 4 — Historical intelligence & coverage recovery

Consegna production del **20 ottobre 2026**. **READY WITH LIMITATIONS**.

Backfill 2021–2026 concluso, nello stesso archivio V2: **1.627 nuovi record**,
**4.074 documenti totali**. Nessun edificio/property/lead creato o fuso.
I 2.447 documenti precedenti conservano tutti hash e first_seen.
Questi numeri misurano copertura osservata, non precisione certificata da ground truth indipendente.

## Historical Albo access

Audit prima dell'ingestion: [access plan](32-historical-albo-access-plan.md).
Fonte: [Albo storico ufficiale](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti).
Form pubblico, sessione anonima effimera, page size 50 verificato, ID `/papca/display/<id>`.
L'anno cerca **registro oppure atto**: i batch possono sovrapporsi.
«Data fine pubblicazione» filtra la fine della pubblicazione, non la data dell'atto:
non è stata usata come limite superiore dell'anno.
Copertura agli estremi pubblici osservati 2021–2026, senza attestare completezza
del registro edilizio. Alcuni documenti pubblicati nel 2021 sono datati 2020;
la data amministrativa più antica nell'Albo importato è **23 dicembre 2020**.
Questo non ricostruisce un registro annuale 2020.

## Years processed / records scanned / relevant records

Tutti i sei batch sono **SUCCEEDED**. Policy `territorial_relevance_v1`:
inventory prima dei detail; riferimenti geografici espliciti o categorie territoriali
prioritarie; esclusione di amministrazione ordinaria non pertinente e testi personali.

| Coorte anno | Righe inventory | Pagine | Candidati verificati | Nuovi ID | ID già presenti | Versioni aggiornate |
|---|---:|---:|---:|---:|---:|---:|
| 2026 | 3.488 | 70 | 201 | 201 | 0 | 0 |
| 2025 | 4.499 | 90 | 261 | 261 | 0 | 0 |
| 2024 | 4.740 | 95 | 291 | 285 | 6 | 0 |
| 2023 | 4.670 | 94 | 303 | 285 | 18 | 0 |
| 2022 | 4.328 | 87 | 313 | 306 | 7 | 0 |
| 2021 | 4.171 | 84 | 296 | 289 | 7 | 0 |
| Totale | **25.896** | **520** | **1.665** | **1.627** | **38** | **0** |

Le righe inventory e i candidati sono **conteggi di coorte, non identità uniche**.
I 38 replay tra coorti non generano documenti o versioni duplicati. Viene conservata
l'identità della pubblicazione ufficiale: due pubblicazioni ufficiali distinte
dello stesso atto restano prove distinte, senza deduplica aggressiva per titolo.
Il 6,43% delle righe delle coorti è stato selezionato per il dettaglio.

Due interruzioni di lettura nel 2025 hanno fermato realmente il processo dopo
200 record salvati. Nessun anno successivo è partito durante l'errore. Verificato
il ritorno HTTP 200 della fonte e del dettaglio successivo, la ripresa ha acquisito
soltanto i 61 record mancanti, con zero aggiornamenti dei 200 precedenti.
Il problema precedente resta nell'audit del run; la health finale è HEALTHY.

## Territorial value by year

| Coorte | Con strada risolta | Con civico esplicito | Building HIGH* | Building REVIEW** | Ambigui | Solo contesto di area |
|---|---:|---:|---:|---:|---:|---:|
| 2026 | 126 | 61 | 2 | 0 | 49 | 40 |
| 2025 | 167 | 77 | 6 | 0 | 71 | 48 |
| 2024 | 171 | 71 | 2 | 0 | 61 | 93 |
| 2023 | 176 | 67 | 6 | 0 | 59 | 101 |
| 2022 | 212 | 109 | 4 | 0 | 60 | 61 |
| 2021 | 171 | 84 | 3 | 0 | 86 | 76 |

Le colonne si sovrappongono; un atto può citare più luoghi. Il civico dichiarato
non implica una strada risolta. HIGH indica un link di contesto edificio con
confidence di policy >=0,95, **non** accuratezza empirica del 95% e mai prova di unità.
**REVIEW qui conta più candidati edificio; le ambiguità di strada/civico sono separate.**
Il contesto comunale/di area non è una localizzazione puntuale.

Prevalgono viabilità, lavori stradali e atti urbanistici. Il valore maggiore è
storia delle strade; i collegamenti a edifici conosciuti restano pochi. Non è un
motivo per allentare il matcher. Categorie e dettaglio dei conteggi sono conservati
in `final-metrics.json` nel pacchetto di prova operativo esterno al repository.

## New street context

Strade con storia: **164 → 292**, +128.
Documenti rappresentabili sulla mappa: **348 → 1.155**;
punti documento/strada: **354 → 1.214**. Sono punti STREET, non coordinate di civico.
Via Castelfidardo passa da 4 a **20 documenti**, con **22 eventi** nella timeline
amministrativa e immobiliare già esistente.

## New building context

Edifici conosciuti con documenti: **404 → 406**. Archivio edifici fermo a **480**.
Due esempi nuovi, con primary URL verificata dal detail fetch:

- [Via Traiana 49](https://listing-radar-mu.vercel.app/map?edificio=cff388fb-cc35-4489-9fd5-adf9a5db15dd#edificio):
  lavoro stradale 903/2023, **26 luglio 2023**,
  [pubblicazione ufficiale 8064719](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti/-/papca/display/8064719).
  Un immobile attivo noto; unità REVIEW_REQUIRED. Attività recente **0/100**.
- [Via Vito Siragusa 19](https://listing-radar-mu.vercel.app/map?edificio=2e558d0e-db01-4c64-aaa3-f6f2a17f2d8a#edificio):
  lavoro stradale 265/2021, **6 marzo 2021**,
  [pubblicazione ufficiale 6223179](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti/-/papca/display/6223179).
  Un immobile storico noto; attività recente **0/100**.

Non sono pratiche certificate degli appartamenti. Le coordinate originali non sono
state modificate; 298 edifici rimangono rappresentabili, anche tramite punto di strada.

## New property context

| Contesto | Prima | Dopo |
|---|---:|---:|
| Property con documenti di strada | 104 | 133 |
| Property con documenti di edificio | 6 | 8 |
| Property con prova specifica di unità | 0 | 0 |
| Property totali | 673 | 673 |
| Lead totali | 1 | 1 |

Tutte le **673 prime osservazioni e earliest market evidence restano invariate**.
Via Traiana conserva market evidence del 30 agosto 2026, anche se ora conosciamo
un atto territoriale del 2023. Il documento amministrativo non retrodata il mercato
o l'incarico. Nessun segnale commerciale/lead generato dal backfill.
Due score differiscono dalla vecchia snapshot Phase 3 (+30): le righe opportunities
dimostrano che erano già stati aggiornati alle **09:16 UTC**, prima della Phase 4,
per `observed_age: 150`. Non sono effetti dell'attività territoriale.

## 71 ambiguities

Analisi individuale: [71 righe con input, civico, locality, codici e fonte](33-territorial-identity-review.md).
Esito: **0 AUTO_RESOLVED_HIGH, 0 PROBABLE, 71 REVIEW_REQUIRED, 0 UNRESOLVABLE**.
Toponimi identici con Codvia distinti, locality nulla e assenza di coordinate
discriminanti non autorizzano una scelta. Un indirizzo property equivalente non
prova quale codice ufficiale usare. Nessun mapping inventato o chiesto automaticamente all'utente.

Interfaccia tecnica in **Fonti → Corrispondenze territoriali**, 25 casi/pagina,
con candidati, codici, input, civico, località e primary link. Azioni Stessa strada,
Differente/scarta associazione, Non determinabile. Decisioni con autore, data,
input hash e storico; source hash cambiato richiede rivalutazione. Nessuna scelta
salvata artificialmente durante lo smoke. Le azioni di scrittura sono verificate in PostgreSQL.

## Building duplicates

Policy `building_identity_v1`: strada canonica univoca, civico esatto, località
compatibile, nessuna contraddizione; coordinate vicine o particella da sole non bastano.
**28 coppie**: 2 PROBABLE_SAME_BUILDING e 26 REVIEW_REQUIRED; nessun AUTO o merge.

- Gliro 48: nomi esteso/abbreviato e riferimento condiviso a particella 942;
  una fonte cita anche terreno/particella 492. Nessuna coordinata o property/publication collegata.
- Piepoli 32: foglio 41/particella 6007, subalterni 18 e 12 su nomi esteso/abbreviato.
  Nessuna coordinata o property/publication collegata. Subalterni diversi non vanno collassati.

Piano condizionale di conservazione, **non eseguito**: confermare prima l'identità
fisica; scegliere un ID canonico; mantenere gli altri ID come redirect e tutti i
nomi come alias; unire relazioni senza perdere evidence/observation/human confirmation;
verificare lo stesso insieme di property e prove prima/dopo; conservare un audit
di ogni relazione spostata. Non sono state create infrastrutture di merge speculative.

## 2025 territorial search / year coverage

[Ricerca ufficiale metodica](34-2025-territorial-data-search.md): catalogo CKAN,
55 dataset e risorse, package 2025, schema datastore, mirror regionale, risorse
complementari, SUE e SIT/PRG. Nessun export strutturato alternativo trovato con
indirizzo/civico/foglio/particella. Le **1.161 pratiche 2025 non sono state arricchite**.
Specifica riutilizzabile CSV/API con i nove campi minimi in [35](35-territorial-export-request.md),
**non inviata**. Nessuna inferenza da persone, testo libero o protocolli.

Registro edilizio annuale 2024 disponibile; 2025 metadata only;
2023/2022/2021/2020/precedenti NOT FOUND nelle fonti consultate.
L'Albo 2021–2026 non viene presentato come ricostruzione di questi registri.
WMS resta NOT AVAILABLE: non era un prerequisito di questa fase e non sono state
inventate geometrie normative.

## Activity vs history

`territorial_activity_v1` invariato, basato su date amministrative valide negli
ultimi 30/90 giorni. Assenza di data o atto revocato non diventa attività recente.
Nessun contributo dei documenti vecchi al solo fatto di essere importati oggi.
`historical_record_density` espone separatamente il numero di record osservati.
Matteotti 181 resta a 3 documenti e attività **25**; Traiana 49 ha 1 documento del
2023 e attività **0**. Density conta record/pubblicazioni, non interventi edilizi certificati.

Read model `market_observer_territorial_history`: scope BUILDING/STREET, density,
recent30/90, activity, proprietà note/attive e ultima attività. Consente letture
per vie recenti, edifici con molta storia, contesti recenti e assenza di property
conosciute. Si riusano i contesti property e la timeline di Phase 3; nessuna dashboard nuova.

## Idempotence / performance / health

Replay production del piano 2026 concluso: **0 insert, 0 update, 0 detail fetch,
0 richieste HTTP**; documenti 4.074 e osservazioni 4.096 invariati. È replay del
piano già osservato, non una nuova osservazione live. Nessuna nuova presenza inventata.

Checkpoint/lease sul run esistente; un solo backfill alla volta, lease 10 minuti,
batch da 25, transazioni bounded, RPC atomica per record+checkpoint. Piano di inventory
minimizzato e congelato per resume, con timestamp della lettura e hash verificabile;
nessun titolo libero nel checkpoint. `--refresh-inventory` effettua una nuova lettura;
un manifest cambiato richiede accettazione esplicita del suo hash.

Concorrenza HTTP 1, delay >=450 ms, timeout 25 s, due retry con backoff;
stop su diniego, rate limit esaurito, drift, struttura, ID duplicati, anno incompatibile,
conteggio implausibile o errore detail. I detail sono solo dei candidati; nessun PDF scaricato.
2024/2023 riusano gli inventari HTTP completi già raccolti nell'audit; i detail vengono
verificati direttamente. 520 è il numero delle pagine nei sei inventari di riferimento,
non il totale di tutte le richieste di audit/retry. Il numero completo dei tentativi
di trasporto e detail non committati non è stato misurato: non si inventa un totale.

Health LIVE/HISTORY separata con `run_kind`; un fallimento storico non cambia il live
e non ne modifica la cadenza. Migration 0041 impedisce che batch parziali non ancora
proiettati usino temporaneamente il fallback di matching meno conservativo.
Ricalcolo anche dei batch parziali dopo errore; nessuna scomparsa dedotta.

Misure finali HTTP/DB dalla postazione, due letture per contesto, non SLA:
edificio **339–449 ms**, strada **345–377 ms**; mappa documenti completa **4.997 ms**,
mappa edifici **1.291 ms**. La mappa intera cresce con i documenti e resta la lettura
più costosa; dettaglio e timeline sono paginati/scoped. Nessun fetch N+1 dei PDF.

## Tests

- Suite completa: **603 PASS / 25 SKIP**, 60 file passati, 2 saltati.
- PostgreSQL reale tramite PGlite: migrations 0040/0041, lease concorrente, resume,
  health isolata, replay idempotente, storico con data vecchia, density che aumenta
  senza activity, guard sulle proiezioni parziali, timeline storica, override e stale hash.
- Test TS: year cohort registro/atto, duplicati, pagination drift, markup cambiato,
  policy rilevanza/privacy, piano minimizzato e tampering, retry limitati, manual
  manifest acceptance, ambiguità e nessun merge insicuro. Regressioni 2025 senza enrichment conservate.
- Typecheck web, lint, build Next.js e design check: PASS realmente eseguiti.
- Smoke autenticato production: Fonti live/history, revisione desktop/mobile 390 px
  senza overflow, nessun heading vuoto, contesto edificio e storia datata;
  console senza nuovi errori/warning. Nessun override umano simulato in production.
- Nessun merge eseguito: il test di conservazione di un merge applicato non è
  dichiarato passato; l'assenza di merge distruttivi è verificata.

## Deployment

Core consegnato in `88c1345`, hardening `97ce0e204e3c0a4ecad41bed5ef2b203822add91`.
Migrations **0040–0041** applicate sul target `eqqmglsxwbsihrlecnun`; dry-run finale
upToDate, nessuna modifica a 0001–0039. PostgREST notificato e RPC/view lette sul target.
Web su https://listing-radar-mu.vercel.app, deploy Vercel **7200874525** per l'hardening.
Runtime GitHub **39430810370**, head `97ce0e2`, SUCCESS: executed 1, failed 0.
Il backfill storico è esplicito, non agganciato al cron live; il cron BUILDING_DATA_SYNC
esistente rimane invariato. Nessuna release del desktop SISTER/Tecnocloud.
Il commit conclusivo conserva lo stesso backend e chiarisce in Fonti la distinzione fra problema precedente risolto e problema aperto.

## Remaining gaps

- 71 identità strada ancora REVIEW; 2 coppie edificio ancora PROBABLE, senza merge.
- Registry ufficiale con codici indistinguibili e coordinate mancanti: niente geocoding inventato.
- Registro edilizio 2025 non territorializzato; registri annuali precedenti non trovati.
- Albo è un archivio di pubblicazioni, non prova di completezza di pratiche o lavori.
  Pubblicazioni diverse dello stesso atto possono aumentare la density: non sono
  automaticamente interventi distinti né segnali commerciali indipendenti.
- Precisione del filtro di rilevanza e dei match non certificata da revisione umana
  indipendente dell'intero campione. Contesto di area non è localizzazione certa.
- Anteprima documenti di area limitata; archivio documenti completo consultabile
  con filtri e paginazione. Nessuna conclusione normativa dall'anteprima.
- WMS non disponibile, nessun resolver catastale ufficiale di unità.

**Conclusione:** memoria territoriale operativa e misurata, con lacune esplicite.
READY WITH LIMITATIONS per backfill e lettura storica; non un certificatore di
identità edilizia/unità, completezza annuale o interesse commerciale.
