# Market Observer — implementazione e attivazione

Conclusione locale: 14 ottobre 2026. Base: `535f51d`. Audit iniziale: [17-market-observer-audit.md](17-market-observer-audit.md).

Il risultato è implementato nel repository e collaudato localmente. Le migrazioni 0014–0016 non sono state applicate al database online; web e runtime Lifecycle non sono stati pubblicati. Nessuna modifica al desktop SISTER/Tecnocloud.

**Aggiornamento successivo del 14 ottobre:** su richiesta di risolvere le quote Supabase, 0014–0016 e la nuova 0017 sono state applicate online. La compattazione conserva lo storico; stato e risultati sono nel [rapporto risorse](../SUPABASE-RESOURCE-OPTIMIZATION.md). Le dichiarazioni di mancata applicazione in questo rapporto descrivono la conclusione del task precedente.

## IMPLEMENTED

### Schema e semantica

- **0014_market_observer_reliability.sql**: date dichiarate di pubblicazione/modifica distinte dalla prima osservazione; campi di stima incarico nullable; ricevute di osservazione separate dalle versioni; hardening delle RPC atomiche di osservazione, assenza e post-uscita.
- **0015_market_observer_intelligence.sql**: statistiche prezzo per pubblicazione, score configurabile centralmente, vendita valutata su tutte le fonti, vista intelligence, rinnovo lease, collegamento esplicito e idempotente ad Acquisition OS.
- **0016_market_observer_private_projection.sql**: proiezione unificata di rapporti agenzia e immobili esclusivamente privati già presenti in V2; ricalcolo derivato in batch da massimo 100 immobili.

Restano le entità esistenti `properties → agency_listings → publications → snapshots/evidence/events`. Le nuove ricevute collegano una lettura positiva alla versione immutabile utilizzata: non sono un secondo archivio di immobili. Una lettura invariata aggiorna presenza e intelligence senza moltiplicare snapshot, evidence o upload media.

`portal_published_at`/`portal_modified_at` derivano da claim espliciti della fonte. `earliest_market_evidence_at` è una proiezione della prima osservazione e delle date pubbliche esplicite, conserva l'anzianità attraverso i rilanci e non usa il mese di una foto come prova certa. Il dettaglio mantiene URL, metodo e confidence delle evidenze. I vecchi bounds restano compatibili ma non sono presentati come inizio contratto. Senza prova specifica, stima e confidence dell'incarico rimangono nulle. Nessuna scadenza contrattuale o simulazione a sei mesi viene inventata.

`sold_at` indica quando è stata osservata/confermata l'evidenza di vendita, non la data del rogito. Il tempo osservabile di esposizione si arresta a quella data quando disponibile.

### Fetching, health e runtime

Restano i dieci adapter verificati nell'audit, HTTP diretto, pacing, retry e coda limitata. Gli adapter estraggono dati e segnali; vendita, identità, rilancio, uscita e score sono conclusioni centrali. Source health espone trovati/processati/errori/timeout/successo/durata. Il worker Lifecycle rinnova il lease e verifica l'ownership prima della persistenza.

Le assenze sono applicabili solo a inventari completi, HEALTHY e con baseline pronta. Servono almeno due scansioni sane e almeno **24 ore** dalla prima assenza; `agencies.settings.missingGraceHours` permette 1–168 ore. La presenza di altre pubblicazioni protegge il rapporto commerciale. Una pagina dettaglio fallita ma ancora presente nel catalogo produce evidenza di sola presenza, senza fingere una nuova lettura del prezzo. Una rimozione esplicita della fonte sufficientemente affidabile segue il percorso di uscita, senza diventare automaticamente vendita.

Il controllo post-uscita, già programmato dopo 48 ore, richiede una scansione completa sana successiva alla scadenza del controllo e nessun run successivo fallito. In assenza di questa prova rimane in retry, senza consumare inutilmente tutti i tentativi. Inventari realmente ridotti possono riqualificare una baseline dopo almeno tre campioni completi, coerenti con il conteggio dichiarato e stabili per almeno 24 ore; la valutazione delle assenze resta congelata durante il nuovo warmup.

### Identità, eventi, prezzi e uscita

Matching conservativo con motivi, fotografie/fingerprint esistenti, coordinate precise e descrizione come segnali aggiuntivi; coordinate approssimate non autorizzano merge. Una distanza incompatibile tra coordinate esatte è un conflitto. I candidati sono caricati in pagine e riusati nella singola sincronizzazione; nuovi immobili entrano nella stessa cache. I casi incerti vanno in review.

ID di pubblicazioni supplementari sono separati per host: due portali con lo stesso ID non collidono. La comparsa simultanea su un altro portale non è un rilancio. Ricomparse e cicli ripetuti conservano eventi separati. Prezzi iniziale/attuale, riduzione assoluta/percentuale, date, conteggi e intervalli dei ribassi sono calcolati **per pubblicazione**; prezzi diversi tra portali non sono variazioni. Un refresh della fonte è un evento distinto.

Vendita esplicita forte e coerente può essere confermata; fonti ancora attive, segnali deboli o grafica contraddittoria producono vendita probabile e review. I nomi di immagini come «Soldati» non sono riconosciuti come «venduto». Le decisioni manuali prevalgono. Uscita senza prova di vendita rimane esito sconosciuto; ritirato, passaggio a privato e cambio agenzia usano i rapporti e le evidenze esistenti. `EXPIRED_POSSIBLE` è un'etichetta disponibile, non una conclusione automatica dalla sola anzianità.

### Acquisition Opportunity Score

Una sola autorità: `market_observer_assess_opportunity`, configurata da `market_observer_config.weights`, aggiornabile soltanto dal servizio. La precedente implementazione TS inutilizzata è rimossa e le sue verifiche sono sostituite da test sulla RPC reale. Lo score è limitato a 0–100 e conserva componenti, motivi, evidenze e versione 2.

| Segnale | Peso iniziale |
|---|---:|
| Esposizione osservabile almeno 150 giorni | 25 |
| Ribasso | 5 ciascuno, massimo 15 |
| Rilancio | 5 ciascuno, massimo 15 |
| Riduzione percentuale | 1 per punto percentuale, massimo 15 |
| Uscita senza prova vendita | 85 |
| Cambio agenzia | 55 |
| Uscita in valutazione | 50 |
| Passaggio a privato | 100 |

I componenti applicabili si sommano fino a 100; vendita confermata azzera lo score. Per i ribassi si prende conservativamente il massimo conteggio fra le pubblicazioni pertinenti, evitando di moltiplicare uno stesso ribasso replicato su portali diversi; tutte le serie originali restano consultabili. Per rapporti attivi, vecchi rapporti chiusi non prevalgono sulla situazione corrente. Il refresh non aggiunge punti da solo. Le modifiche ai pesi hanno effetto al prossimo aggiornamento o ricalcolo.

### UI e Acquisition OS

`/intelligence` riunisce **Mercato, Opportunità, Usciti, Venduti**, con filtri, ricerca e paginazione da 40 righe. La scheda casa mostra prezzo, anzianità dimostrabile, riduzione, score, timeline, pubblicazioni e provenienza; dettagli secondari sono comprimibili. Token e font esistenti sono conservati.

**Porta in Acquisizioni** crea o collega il segnale e il lead esistenti, includendo immobile, rapporto agenzia, priorità, motivi, score ed evidenze. Ripetere l'azione non duplica il segnale. Stato e prossima azione di un lead già gestito dall'operatore non vengono sovrascritti. Non si inventa il recapito del proprietario.

## TESTED

- Unit: **41 file, 316 test passati**.
- Integration: **35 passati, 25 saltati** perché richiedono un ambiente Supabase configurato. Di quelli passati, **28** eseguono schema e nuove RPC su PostgreSQL embedded PGlite; nessuna credenziale production usata nei test.
- Coperti i 15 scenari richiesti, più replay idempotente, cicli multipli, override, lease, collisioni ID, dettaglio fallito con presenza catalogo, rimozione esplicita, score configurabile e ribassi specchiati.
- Typecheck, lint, build Next e controllo token/contrasto: passati.
- Suite E2E generale: **1 passato, 7 saltati**, mancano configurazione e credenziali per i percorsi integrati.
- Browser con fixture locale di sola lettura: **15 scenari passati** sui quattro tab e dettaglio, a 390/1024/1600 px; nessun overflow orizzontale o errore runtime. Screenshot e risultati in `.runtime/market-observer-ui/`, esclusi dal repository.
- Audit remoto di sola lettura del 13 ottobre e probe HTTP pubblici: risultati nella sezione rischi. Non sono test delle nuove migrazioni in produzione.

Docker locale non disponibile: non è stata eseguita la suite completa contro Supabase/PostgREST locale. PGlite verifica SQL e transazioni, ma non sostituisce il collaudo integrato di autenticazione, RLS, Storage e PostgREST.

## DATA MIGRATION

Nessun dato online modificato. Dry-run del backfill: **665 immobili esaminati, zero ricalcolati**. Nessun reset, eliminazione o riscrittura dello storico.

All'applicazione, 0014 ricostruisce ricevute dagli snapshot esistenti e date portale solo dai claim espliciti già registrati. Date di acquisizione/scadenza restano nulle senza prova. Snapshot storici duplicati restano conservati; si evita la duplicazione futura. ID principali non vengono rinominati.

Il backfill opzionale ricalcola soltanto stato derivato e opportunità in batch. Può aggiungere eventi di rivalutazione e review: non riscrive le osservazioni originali. I batch sono idempotenti; se interrotto si può rieseguire. Valori e workflow umani mantengono le protezioni descritte sopra. Il ponte privati e le tabelle legacy restano compatibilità, non vengono estesi o cancellati.

## REMAINING RISKS

- **Studi Santi**: il probe HTTP ha ricevuto 403 dopo redirect. Nessuna assenza viene dedotta; resta necessaria una fonte pubblica nuovamente raggiungibile o un'alternativa autorizzata.
- **PuntoCasa**: inventario pubblico completo 83 annunci di vendita contro baseline storica 127; **Momento**: 2 contro 4. I run remoti risultavano DEGRADED. La riqualificazione conservativa è implementata ma va osservata sui prossimi run online.
- Studio Casa usa Casa.it; Momento/Trio usano TrovaCasa. Sono adapter specifici già presenti, non prova di copertura generale dei portali.
- Wikicasa, Immobiliare.it e Idealista hanno ingressi email/browser storici; non è stato aggiunto un crawler inventario V2 completo di ciascun portale. Il modello gestisce pubblicazioni multiple, date e identità; l'attivazione di ulteriori ingressi deve rispettare la regola portali privati/incerti. Anche search evidence e social non sono nuove fonti attive.
- L'ingresso diretto degli annunci privati/incerti in V2 richiede ancora la migrazione del ponte legacy; la nuova intelligence legge i privati già presenti in V2.
- Coordinate esatte e dati agente dipendono dalla disponibilità della fonte. Non vengono ricostruiti come fatti; match dubbi restano manuali.
- Prezzo è asking, non prezzo di compravendita. Data vendita è osservata/confermata, non notarile; incarico reale non ricostruibile dalla sola pubblicazione.
- Query e viste sono paginate; il costo SQL delle viste aggregate e dei fingerprint va misurato su volumi molto superiori ai 665 immobili attuali, prima di espandere il mercato.

## DEPLOYMENT

Prima collaudare in Supabase locale oppure DEV/STAGING esplicitamente autorizzato. I comandi seguenti non sono stati eseguiti contro production.

1. Salvare un backup verificato e attendere la fine dei job Lifecycle attivi; evitare un deploy di RPC mentre un job ne sta utilizzando la vecchia versione. Verificare progetto CLI e variabili dell'ambiente destinatario.
2. Applicare in ordine **0014, 0015, 0016**. Non riapplicare il consolidato 0001 a un archivio esistente. Con CLI già collegata al progetto autorizzato: `npx supabase migration list --linked`, poi `npx supabase db push --linked`. Il piano deve contenere solo le migrazioni attese.
3. Nessuna nuova variabile runtime. Restano URL Supabase, anon key web, service-role solo server e `SUPABASE_PROJECT_REF` per il worker remoto. Non cambiare `AUTH_REQUIRED` per il rilascio.
4. Eseguire audit e backfill inizialmente in lettura, con configurazione del progetto destinatario:

```powershell
npx tsx --env-file=.env.local scripts/market-observer-audit.ts
npx tsx --env-file=.env.local scripts/market-observer-backfill.ts
# Solo sul progetto esplicitamente autorizzato e dopo le migrazioni:
npx tsx --env-file=.env.local scripts/market-observer-backfill.ts --apply --confirm-project=REF_AUTORIZZATO
```

5. Pubblicare la web app e il codice del **worker Lifecycle di root**. Il workflow `.github/workflows/property-lifecycle.yml` userà il nuovo codice al rilascio del branch. Nessuna nuova release del desktop Property Data Worker, che non è stato modificato.
6. Conservare i cron esistenti: FAST quattro volte al giorno (04/09/13/17 UTC), DEEP rotante giornaliero, Building settimanale. Non aggiungere un secondo scheduler sulle stesse fonti. Per un primo run controllato, usare il workflow manuale `SYNC_ALL`, oppure il comando remoto con progetto confermato:

```powershell
npx tsx --env-file=.env.local scripts/property-lifecycle-remote-worker.ts --confirm-project=REF_AUTORIZZATO --enqueue=SYNC_ALL --drain --max-seconds=3000 --max-jobs=200
```

7. Verificare post-deploy: accesso autenticato a `/intelligence` e scheda casa; health/metriche delle dieci fonti; nessuna rimozione da run falliti; lettura invariata senza nuovo snapshot; evento ribasso distinto da refresh; attesa post-uscita senza prove fresche; collegamento Acquisition idempotente e prossima azione umana preservata. Monitorare PuntoCasa/Momento durante la riqualificazione e Studi Santi senza forzare la baseline.

Se il collaudo fallisce, sospendere i job nuovi e ripristinare web/runtime precedente; conservare le aggiunte di schema e tutto lo storico. Non usare reset o rollback distruttivi per annullare una migrazione additiva.
