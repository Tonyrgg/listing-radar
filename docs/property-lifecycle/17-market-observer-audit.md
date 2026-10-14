# Market Observer — audit prima delle modifiche

Data: 13 ottobre 2026. Base di codice: `535f51d`. Audit del repository, non una certificazione del database remoto o della raggiungibilità attuale dei portali.

## 1. Architettura attuale

`src/lib/property-lifecycle` è il dominio autorevole. `properties` identifica la casa; `agency_listings` il rapporto commerciale osservato; `publications` la presenza esterna; `snapshots`, `evidence`, `events` conservano osservazioni e conclusioni. Esistono già fingerprint dHash/SHA256, revisioni e override umani. Non creare un altro archivio. Il Worker SISTER/Tecnocloud è un dominio distinto, senza ruolo nel fetching del mercato pubblico. La scheda mercato effettiva è `app/(private)/casa/[id]/mercato.tsx`; i vecchi URL del dossier fanno redirect.

## 2. Fetching e runtime

`adapters/registry.ts` registra dieci adapter, con HTTP diretto, timeout normalmente 15 secondi, due retry, intervallo minimo un secondo. `HttpClient` riprova rete, 408/425/429/5xx; non aggira autenticazione o blocchi. Paginazione e conteggi sono specifici della fonte. `sync/engine.ts` legge ogni dettaglio in sequenza, normalizza, filtra geografia e invia la RPC atomica. FAST non scarica media; DEEP/BOOTSTRAP usa `assets/pipeline.ts`, con limite configurabile e immagini rappresentative. `jobs/queue.ts` gestisce deduplica, lease e retry esponenziale. Il workflow GitHub `property-lifecycle.yml` programma quattro FAST quotidiani, una rotazione DEEP e un import edilizio settimanale. Vercel programma ancora `/api/cron/scrape`, che legge email e provider legacy, salva `listings` e report: doppio dominio, non doppio archivio V2 intenzionale. Il ponte privati esistente è compatibilità da migrare, non base per nuove funzioni.

## 3. Fonti e attendibilità

| Adapter | Inventario e identificatore | Date / stato | Limite |
|---|---|---|---|
| Iconacasa | tutte le pagine, ID numerico property | publish_up solo se realmente disponibile; altrimenti prima osservazione | pagina non prova inizio mandato |
| PuntoCasa | archivio WordPress paginato, slug | tassonomia dedicata Venduto/In trattativa; mese upload debole | testo pagina intera escluso |
| Vistocasa | marker mappa, ArticoliId | grafica venduto nel gallery; media originali nel deep | mantiene venduti nel catalogo |
| Studi Santi | sitemap vendite, ID Miogest | data filename foto debole, lastmod escluso | media riutilizzabili |
| Ad Maiora | archivio paginato + join REST pubblico | JSON-LD datePublished; dateModified separata | REST non allarga la baseline visibile |
| Studio Casa | ricerca publisher Casa.it paginata, ID portale | modified conservato, creazione ignota | fonte portal-backed fragile, non intero mandato |
| Futura | Agesta paginato, cod_annuncio | article published del ciclo corrente; modified separato | rilancio possibile |
| Garofalo | API pubblica Flazio, ID | created_at scheda; sold flag | creazione scheda non contratto |
| Momento / Trio | paginazione TrovaCasa, ID | prima osservazione; media con policy esplicita | fonte portal-backed, non sito indipendente |

Per tutte: solo scansioni complete e sane autorizzano assenze; zero inventario, paginazione incompleta, conteggi anomali e struttura cambiata le congelano. Baseline progressiva `health/baseline.ts` richiede tre osservazioni sane e gestisce mediana, variabilità e fingerprint. Le fixture e i playbook 07/13/16 documentano il contratto; non provano disponibilità live oggi. Wikicasa/Immobiliare/Idealista/Casa hanno parser email/import legacy; non hanno un inventory crawler V2 generalizzato. Per AGENTS.md, nuovi ingressi portali devono scartare agenzie riconosciute e conservare privati/incerti. Non simulare copertura completa tramite una pagina di risultati o una ricerca web. Social fuori dal MVP.

## 4. Database

Lo schema attuale è consolidato in `0001_production_schema.sql` (include le vecchie migrazioni Lifecycle 020–038); la numerazione corrente arriva a 0013. Funzioni effettive: `persist_property_lifecycle_observation_atomic`, `apply_missing_observations_atomic`, `run_post_exit_check_atomic`, `refresh_property_lifecycle_intelligence_atomic`. Le RPC, non i vecchi helper TS, decidono le transizioni. `0010_acquisition_os.sql` contiene lead, signal, activity e vincolo di un solo lead vivo per property. Il ponte automatico riguarda soprattutto i privati; manca un collegamento completo delle opportunità di agenzia. Nessuna tabella deve essere eliminata in questo intervento.

## 5. Date

`first_seen_at` è la prima osservazione nostra; `last_seen_at` l'ultima presenza positiva; `snapshots.observed_at` è il momento della lettura, non della variazione originale. La data dichiarata dalla fonte vive in evidence/provenance. `first_public_evidence_at` e i bounds `true_market_start_*` sono stime documentate: media e upload possono precedere la commercializzazione. Nessuna evidence attuale dimostra automaticamente la firma o la scadenza di un incarico. `closed_at`/`exit_confirmed_at` sono conclusioni osservate; non date notarili di vendita. `created_at`/`updated_at` sono gestione tecnica. Gli intervalli prezzo vanno attribuiti alla pubblicazione: prezzi simultanei di portali diversi non costituiscono ribassi.

## 6. Difetti verificati

- La RPC inserisce snapshot/evidence/fingerprint ad ogni run, anche con contentHash invariato. La deduplica esistente protegge solo replay nello stesso run.
- Il missing richiede due run sani ma nessuna durata minima tra essi. La RPC stessa verifica soltanto il run RUNNING, non la salute già registrata.
- Il post-exit rilegge il database, non la fonte: dopo 48h può concludere un'uscita senza alcuna scansione sana successiva.
- Il post-exit guarda una publication, senza controllare tutte quelle dello stesso agency listing per una ricomparsa.
- Un nuovo source key della stessa agency listing è sempre RELAUNCHED, anche se è una pubblicazione simultanea su un altro sito.
- L'osservazione non riattiva chiaramente rapporti OFF_MARKET/CLOSED_SWITCHED ricomparsi, e il sale_status dipende dall'ultima publication lavorata invece che da tutte le evidenze correnti.
- Lo scoring seleziona il vecchio rapporto chiuso prioritario anche quando esistono rapporti attivi, quindi può sopprimere o promuovere impropriamente un'opportunità.
- UI: `REMOVED` è etichettato Uscito dal mercato (affermazione troppo forte); testi parlano di mandati senza prova contrattuale; giorni calcolati dal lower bound invece del minimo dimostrabile.
- Prezzo iniziale deriva dai soli eventi di variazione, quindi manca sui prezzi mai modificati; la scheda limita eventi/prove e non distingue sempre fonte/URL.

## 7. Obsoleto / duplicato

`persistence/repository.ts` conserva helper non chiamati dal percorso atomico (upsertLocation/upsertBuilding/createProperty/updatePropertyObservation/recordSnapshotAndEvidence/recordAssetFingerprints/updateSaleFromObservation), oltre a refresh intelligence TS diverso dall'SQL. Rimuovere solo dopo verifica dei caller; conservare helper usati dagli override. `src/lib/scrapers/providers` e le azioni listings restano compatibilità legacy: non estenderli e non eliminarne i dati. I precedenti documenti di rollout descrivono fasi passate, non migrazioni da rieseguire.

## 8. Da mantenere

Schema V2, atomicità, provenance, review con motivi e margine, scope Bitonto/Palombaio/Mariotto, mancata chiusura su fetch fallito, override umani, foto percettive, snapshot storici, lease e cron esistenti, scheda casa e Acquisition OS.

## 9. Da cambiare

Separare date source/observation/mandate; persistere solo nuove versioni senza perdere last_seen e health; grace period e nuove prove sane per le uscite; classe uscita con confidence ed evidence; rilanci distinti dalla pubblicazione parallela; statistiche prezzo per publication; scoring versionato e spiegabile, eseguito centralmente nel DB; integrazione idempotente Acquisition OS; tab Intelligence e scheda con provenienza. Non dichiarare adattatori live completi che non sono verificati.

## 10. Piano migrazione conservativa

Nuove migration incrementali dopo 0013, senza modificare quelle condivise. Aggiungere colonne/viste/RPC solo dove non esistono equivalenti; usare i bounds e gli evidence attuali come origine. Recuperare date pubblicazione solo da claim espliciti o provenance validata, mai da created_at o generico Last-Modified. Lasciare estimated_acquisition_at nullo senza evidence contrattuale. Non riscrivere snapshot né cancellare storico. Test PostgreSQL reale/embedded sulle RPC e regression dei quindici scenari richiesti, typecheck/lint/build/UI. Deploy separato dall'audit locale: applicazione migrazioni, poi web/worker Lifecycle e verifica scheduler. Il desktop SISTER non richiede un nuovo rilascio se non viene modificato.
