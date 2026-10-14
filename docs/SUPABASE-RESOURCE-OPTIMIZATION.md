# Riduzione delle risorse Supabase — 14 ottobre 2026

## Ripristino completato con Pro

L'Owner ha attivato Pro. Il progetto era ancora su Nano con disco da 2 GB: sono stati applicati **8 GB di disco e Micro con 1 GB RAM**, entrambi con incremento mostrato di **0,00 USD/mese**, mantenendo lo spend cap. PostgreSQL è tornato accessibile e la piattaforma ha rimosso automaticamente la sola lettura; non sono stati alterati ruoli di sicurezza o cancellati file WAL.

La compattazione e il recupero fisico sono conclusi. Prima del primo sync di collaudo: **66.372 snapshot e 1.063.130 fingerprint originali conservati**, zero payload da compattare, zero fingerprint rimasti nella rappresentazione non compressa. Dopo VACUUM FULL delle due sole tabelle fisiche: database **613.321.875 byte**, rispetto ai **1.422.806.163 byte iniziali**. Dopo gli indici mirati e durante il collaudo: circa **620 MB**; sono possibili piccoli aumenti dovuti a nuovi sync e log.

Storage: **15.355.770 byte e 653 anteprime**, contro 69.776.368 byte iniziali. Sono stati sostituiti 1.222 file generati, dopo l'aggiornamento verificato dei riferimenti. Zero download mancanti, zero conflitti; nessun immobile conserva più di un riferimento foto. Link delle fonti e tutti i fingerprint sono mantenuti.

Le migrazioni **0018–0021 sono applicate e registrate**. Durante la sola lettura, il runner MCP/CLI non riusciva a inizializzare il registro: 0018–0019 sono state eseguite dai file di migrazione tramite una sessione di manutenzione; a protezione rimossa è stata allineata la history con `supabase migration repair`, verificando poi il dry-run senza migrazioni pendenti. 0020–0021 sono state applicate normalmente tramite CLI. 0020 mantiene il controllo di unicità anche sugli aggiornamenti; 0021 aggiunge piccoli indici parziali su prove di vendita e prezzi, senza cancellare dati.

Il piano reale della vista Mercato mostrava 665 scansioni delle evidenze, con circa 15.256 blocchi letti e oltre 6 secondi di esecuzione. Dopo gli indici e il recupero fisico: prima pagina **471 ms**, altre viste **97–129 ms**. Archivio del worker: **665 immobili, 16.971 fingerprint immagine e 74 planimetrie**, invariati tra i controlli; caricamento da circa **14 secondi a 2 secondi**. I campioni Metrics API tra i passaggi di manutenzione sono rimasti sotto la soglia del 70%, con massimo medio misurato di circa 44% durante manutenzione e profiling; non sono una misura del massimo istantaneo.

Collaudo reale dalla coda: **Iconacasa, 106 annunci trovati e 106 elaborati, zero errori, job SUCCEEDED al primo tentativo**, in circa 173 secondi. Campione Metrics API finale delle 14:23:59 UTC: **CPU media 4,63% negli ultimi 296 secondi**, carico 0,09, circa **7,00 GB disponibili sul disco dati**. Le percentuali dei grafici storici della dashboard non vanno confuse con questo campione. Le altre fonti non sono state forzate: Studi Santi resta non raggiungibile e PuntoCasa/Momento richiedono osservazione delle baseline. I crawler falliti non autorizzano rimozioni.

Le sezioni successive conservano diagnosi e cronologia del blocco precedente. La bozza di supporto non è stata inviata e non è stata necessaria per questo recupero. Il desktop SISTER/Tecnocloud non è modificato.

## Diagnosi verificata

Progetto configurato e collegato alla CLI: quello mostrato negli screenshot. Nessun reset o migrazione verso un altro progetto.

- Database prima dell'intervento: **1.422.806.163 byte**.
- `image_fingerprints`: circa **783 MiB**, **1.063.130 righe effettive** (le statistiche stimavano erroneamente 84.195). Molti valori identici ripetuti a ogni osservazione.
- `snapshots`: circa **350 MiB**, **66.372 osservazioni** ma soltanto **901 content hash distinti**.
- `evidence`: circa **133 MiB**, conservata interamente.
- Storage immagini: **69.776.368 byte**, 1.222 file. È un problema distinto dalla dimensione del database PostgreSQL.
- Il database ha già prodotto SQLSTATE 53100 (disco pieno durante un ordinamento diagnostico) e poi 25006 (scritture bloccate in sola lettura). Non basta un normale VACUUM: la parte dominante erano dati duplicati ancora vivi, non semplicemente tuple morte.

## Modifiche

Le migrazioni **0014–0017 sono state applicate online** nell'ambito della richiesta di risolvere le quote. 0014 impedisce nuove versioni identiche; 0015–0016 attivano le proiezioni e le RPC Market Observer già collaudate; **0017_resource_compaction.sql** aggiunge una rappresentazione fisica condivisa, mantenendo integralmente quella logica.

Gli ID di snapshot, le osservazioni, date, descrizioni, prezzi, URL e le FK delle evidenze rimangono. `snapshot_observations` conserva le righe/identità originali; `snapshot_payload_versions` condivide i contenuti. I timestamp variabili hanno patch per osservazione e vengono ricostruiti esattamente. Campi sconosciuti sono mantenuti. Un trigger accetta soltanto l'interning verificato e continua a rifiutare modifiche dello storico.

I fingerprint ripetuti sono rappresentati da gruppi di valori e liste compresse delle osservazioni originali. La vista `image_fingerprints` restituisce tutte le righe originali, con gli stessi ID e dati. Ogni batch confronta esattamente i due insiemi di righe, prima di rimuovere le copie dalla rappresentazione non compressa. Gli archivi sono append-only. Non si riduce il numero di fotografie usate per il matching: rimangono tutti i fingerprint.

Il runtime aggiornato usa `lifecycle_identity_fingerprints`: trasmette soltanto valori distinti e pagina i risultati, evitando sia i duplicati storici sia il taglio silenzioso a 1.000 righe. Le vecchie letture restano compatibili, ma il risparmio di traffico richiede anche la pubblicazione del codice aggiornato.

## Anteprime

Una sola anteprima WebP per immobile, massimo **640 × 480**, qualità 65, cache lunga su percorso versionato. Link originali e fingerprint sono indipendenti dalle anteprime.

`compact-listing-previews.ts` prepara prima il nuovo file, aggiorna il riferimento con confronto del valore precedente e poi elimina soltanto i file generati nella cartella di quell'immobile nel bucket `property-lifecycle-visuals`. Non tocca immagini di altri bucket, recapiti o dati CRM. Una nuova run Lifecycle sospende la pulizia. Le riesecuzioni non ricomprimono le anteprime già ottimizzate. Dry-run iniziale: **665 immobili, 653 con foto, 1.198 riferimenti**.

## Collaudo

- **317 test unitari passati**.
- **40 integrazioni passate, 25 saltate** per ambiente Supabase non configurato.
- Inclusi confronto integrale delle righe prima/dopo compattazione, batch ripetibili, FK dello storico, immutabilità, duplicati storici rifiutati, metriche prezzo ricostruite e RPC del ciclo completo dopo 0017.
- Typecheck, lint e build Next passati.
- Media: una sola anteprima compatta, con tutti i fingerprint delle foto di origine preservati.

## Manutenzione ripetibile

Con variabili del progetto destinatario e autorizzazione all'intervento:

```powershell
# Prima misurare, senza applicare modifiche:
npx tsx --env-file=.env.local scripts/compact-supabase-resources.ts
npx tsx --env-file=.env.local scripts/compact-listing-previews.ts

# Compattazione verificata e anteprime:
npx tsx --env-file=.env.local scripts/compact-supabase-resources.ts --apply --confirm-project=REF_AUTORIZZATO --confirmed-maintenance-window
npx tsx --env-file=.env.local scripts/compact-listing-previews.ts --apply --confirm-project=REF_AUTORIZZATO
```

Se il conteggio iniziale esaurisce il timeout REST, la compattazione può ometterlo con `--skip-initial-status`, dopo aver rilevato i volumi mediante una sessione SQL di manutenzione. I batch completati si possono rieseguire senza duplicare lo storico.

Lo spazio fisico delle copie sostituite va recuperato dopo il completamento mediante VACUUM FULL sulle sole tabelle fisiche interessate, in assenza di job Lifecycle attivi e con lock timeout. Prima verificare che il disco abbia spazio sufficiente per la nuova copia della tabella e il WAL generato: il solo ritorno della connettività o il recupero di un indice non garantisce questo margine. Se il margine manca, fermarsi e concordare il recupero con il supporto. VACUUM FULL blocca la tabella durante la riscrittura: eseguirlo separatamente, non dentro una migration o una transazione applicativa.

```sql
SET lock_timeout = '5s';
VACUUM FULL ANALYZE public.image_fingerprint_current;
VACUUM FULL ANALYZE public.snapshot_observations;
```

In sola lettura usare esclusivamente una sessione di manutenzione secondo la [procedura Supabase](https://supabase.com/docs/guides/platform/database-size#disabling-read-only-mode), non cambiare il ruolo applicativo per consentire scritture incontrollate. Le credenziali sono riusate in memoria e non esportate. Prima del recupero fisico verificare i conteggi logici tramite `resource_compaction_status`.

Il consumo egress già registrato nel periodo non si annulla cancellando foto. Ridurre letture e download evita consumo ulteriore; eventuali restrizioni Fair Use dipendono anche dalla media del periodo, come spiega la [documentazione Supabase](https://supabase.com/docs/guides/platform/database-size#fair-use-database-size-restriction).

## Cronologia del blocco precedente al ripristino

La compattazione online è **interrotta e riprendibile**, non conclusa. I log dei batch attestano almeno 24.544 snapshot internati e 382.957 osservazioni fingerprint trasferite senza perdita alla rappresentazione condivisa; altri batch precedenti all'interruzione potrebbero essere già completati. Non usare questi minimi al posto del conteggio finale sul server.

Il database è successivamente entrato in recovery e rifiuta connessioni con **57P03 / Hot standby mode is disabled**. PostgREST restituisce **503 / PGRST002**. Il recupero fisico non è stato eseguito; lo spazio delle vecchie copie e gli indici sono ancora allocati. Ultima misura SQL accessibile: 1.500.122.259 byte di database. La pagina Infrastructure mostra **1,92 GB su 2 GB**, con circa 304 MB di WAL e 171 MB di sistema. La compattazione crea necessariamente nuove strutture, tuple morte e WAL prima che il recupero fisico possa liberare le vecchie copie: con disco quasi esaurito serve headroom.

La migrazione **0018_compaction_index_headroom.sql**, pronta e collaudata ma **non applicata**, sostituisce il controllo di unicità dell'indice URL da 229.785.600 byte con un trigger serializzato mediante advisory lock, e crea un piccolo indice per snapshot in una transazione successiva. Nessun dato viene eliminato e duplicati correnti/storici restano rifiutati. Limita anche la ricerca delle immagini storiche alla sola pubblicazione interessata, evitando l'espansione globale dell'archivio nei confronti delle gallerie. Alla ripresa applicare 0018 prima di altri batch.

Le API di restart e temporary readonly disable hanno risposto **403**, per privilegi insufficienti. Il riavvio è stato avviato dalla sessione browser esistente; il database resta in recovery dopo il tentativo. L'account aperto è Developer; solo l'Owner può intervenire sulla fatturazione. Non sono stati attivati piani a pagamento, aumenti a consumo o messaggi al supporto.

L'utente ha escluso il passaggio a Pro il 14 ottobre 2026. Il controllo successivo conferma ancora 57P03: serve una valutazione del supporto per ripristinare l'accesso sul piano attuale; non è garantito che il recupero possa avvenire senza spazio aggiuntivo. La [bozza della richiesta](SUPABASE-RECOVERY-SUPPORT-DRAFT.md) è pronta ma non inviata. Le anteprime restano da compattare: la loro manutenzione è stata arrestata prima di aggiornare i riferimenti.

Il workflow GitHub **Property Lifecycle Radar** (`property-lifecycle.yml`) è stato disabilitato temporaneamente durante il blocco. Nessun nuovo job è stato avviato per il rilascio. Riabilitarlo soltanto dopo la manutenzione e la verifica delle letture/scritture con `gh workflow enable property-lifecycle.yml`; non avviare scansioni nel frattempo. Il desktop SISTER/Tecnocloud e il workflow della sua release non sono modificati.

Il nuovo MCP Supabase è stato collegato e verificato sul progetto `eqqmglsxwbsihrlecnun`. I log sono accessibili e confermano un errore di scrittura `pg_wal/xlogtemp.47151: No space left on device` alle 12:29:52 UTC del 14 ottobre, seguito da recovery. Una query minima e gli advisor falliscono ancora con 57P03. Il collegamento MCP funziona, ma non ripristina la disponibilità PostgreSQL. La bozza per il supporto contiene ora queste evidenze. Il codice applicativo del commit `c4ed16a` è stato pubblicato e il deploy Vercel Production è riuscito; le scansioni Lifecycle restano sospese.

### Verifica della segnalazione CPU

L'utente segnala CPU al 100% dopo l'intervento. Non è stata ottenuta una misura CPU né un piano di esecuzione online durante il blocco: i test funzionali locali non dimostrano il costo sul volume reale.

La lettura dei log nella finestra 06:00–15:00 UTC del 14 ottobre mostra il primo errore di disco pieno alle 08:16:32 UTC, il primo avvio del recupero alle 08:42:35 UTC e 168 avvii del recupero fino alle 12:30:05 UTC. Il commit web è delle 12:21:58 UTC; le migrazioni online e i batch di compattazione sono precedenti. Il codice Lifecycle nuovo non risulta eseguito da GitHub Actions: gli ultimi job usavano `535f51d`, mentre le funzioni SQL e le viste condivise erano già cambiate. Questo distingue il push web dagli interventi diretti sul database, senza escludere il contributo di questi ultimi al problema.

La revisione statica individua costi da verificare prima di riattivare il servizio: confronto integrale JSON nei batch di compattazione; espansione delle osservazioni nella vista compatibile `image_fingerprints`; query DISTINCT globali ripetute durante la paginazione dei fingerprint. La limitazione delle gallerie allo snapshot/pubblicazione è pronta in 0018 ma non applicata. Il recupero ripetuto può contribuire al carico attuale: è una spiegazione plausibile, non una misura della sua quota di CPU. Nessuna compattazione Node locale risulta ancora in esecuzione e lo scheduler resta disabilitato. Non riattivare i batch o lo scheduler senza verificare spazio libero e piani/costo delle query sul database nuovamente accessibile.

### Correzioni locali successive alla segnalazione

**0019_bounded_identity_fingerprints.sql** aggiunge una lettura limitata a 75 immobili, con una riga per immobile e tutti i suoi fingerprint distinti, immagini e planimetrie insieme. Legge soltanto i valori dei gruppi, senza ricostruire le osservazioni; non crea nuove copie dei dati o nuovi indici. Il runtime prepara gruppi in sequenza e non ripete DISTINCT globali per ogni pagina e ogni tipo. Il test conserva 1.201 valori distinti di un immobile oltre il limite delle 1.000 righe, verifica deduplicazione e planimetrie, ed esclude l'espansione dello storico mediante un archivio canarino che fallirebbe se espanso. Non è una misura della CPU production.

La manutenzione ora usa batch da 250 snapshot e 1.000 fingerprint, una pausa di 500 ms dopo i batch non vuoti e un massimo di 100 chiamate per invocazione prima di richiedere una nuova verifica di disco/CPU/WAL. Riprende dall'ultima pubblicazione interamente completata tramite `--after-publication=UUID`; se si interrompe a metà pubblicazione, la include di nuovo. Controlla i job attivi prima di ogni batch e richiede conferma della finestra di manutenzione dopo la verifica manuale del margine disco: il flag non misura né garantisce quel margine. Richiede anche la nuova RPC, impedendo di riprendere con lo schema precedente. 317 test unitari e 42 integrazioni passati, 25 integrazioni saltate; typecheck, lint e build passati. Corretto anche l'occhiello della pagina Intelligence rilevato dalla suite completa dopo il primo commit.

Il runtime nuovo richiede 0019: schema e collaudo online sono ora completati. Le correzioni vengono distribuite dopo questa verifica; lo scheduler va riabilitato soltanto sul codice corretto.

Alla ripresa: verificare lo stato e i job attivi, applicare 0018, misurare il margine recuperato, applicare 0019 e controllare i piani/costi delle letture su volumi reali. Completare i batch soltanto con margine adeguato, confrontare conteggi e contenuti, eseguire il recupero fisico soltanto con spazio sufficiente e lock timeout, verificare nuovamente letture/scritture, compattare le anteprime e misurare Storage. Il codice già pubblicato è `c4ed16a`; non considerare attive le correzioni locali successive finché non vengono distribuite.
