# Riduzione delle risorse Supabase — 14 ottobre 2026

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
npx tsx --env-file=.env.local scripts/compact-supabase-resources.ts --apply --confirm-project=REF_AUTORIZZATO
npx tsx --env-file=.env.local scripts/compact-listing-previews.ts --apply --confirm-project=REF_AUTORIZZATO
```

Se il conteggio iniziale esaurisce il timeout REST, la compattazione può ometterlo con `--skip-initial-status`, dopo aver rilevato i volumi mediante una sessione SQL di manutenzione. I batch completati si possono rieseguire senza duplicare lo storico.

Lo spazio fisico delle copie sostituite va recuperato dopo il completamento mediante VACUUM FULL sulle sole tabelle fisiche interessate, in assenza di job Lifecycle attivi e con lock timeout. VACUUM FULL blocca la tabella durante la riscrittura: eseguirlo separatamente, non dentro una migration o una transazione applicativa.

```sql
SET lock_timeout = '5s';
VACUUM FULL ANALYZE public.image_fingerprint_current;
VACUUM FULL ANALYZE public.snapshot_observations;
```

In sola lettura usare esclusivamente una sessione di manutenzione secondo la [procedura Supabase](https://supabase.com/docs/guides/platform/database-size#disabling-read-only-mode), non cambiare il ruolo applicativo per consentire scritture incontrollate. Le credenziali sono riusate in memoria e non esportate. Prima del recupero fisico verificare i conteggi logici tramite `resource_compaction_status`.

Il consumo egress già registrato nel periodo non si annulla cancellando foto. Ridurre letture e download evita consumo ulteriore; eventuali restrizioni Fair Use dipendono anche dalla media del periodo, come spiega la [documentazione Supabase](https://supabase.com/docs/guides/platform/database-size#fair-use-database-size-restriction).

## Stato dell'intervento

La compattazione online è **interrotta e riprendibile**, non conclusa. I log dei batch attestano almeno 24.544 snapshot internati e 382.957 osservazioni fingerprint trasferite senza perdita alla rappresentazione condivisa; altri batch precedenti all'interruzione potrebbero essere già completati. Non usare questi minimi al posto del conteggio finale sul server.

Il database è successivamente entrato in recovery e rifiuta connessioni con **57P03 / Hot standby mode is disabled**. PostgREST restituisce **503 / PGRST002**. Il recupero fisico non è stato eseguito; lo spazio delle vecchie copie e gli indici sono ancora allocati. Ultima misura SQL accessibile: 1.500.122.259 byte di database. La pagina Infrastructure mostra **1,92 GB su 2 GB**, con circa 304 MB di WAL e 171 MB di sistema. La compattazione crea necessariamente nuove strutture, tuple morte e WAL prima che il recupero fisico possa liberare le vecchie copie: con disco quasi esaurito serve headroom.

La migrazione **0018_compaction_index_headroom.sql**, pronta e collaudata ma **non applicata**, sostituisce il controllo di unicità dell'indice URL da 229.785.600 byte con un trigger serializzato mediante advisory lock, e crea un piccolo indice per snapshot in una transazione successiva. Nessun dato viene eliminato e duplicati correnti/storici restano rifiutati. Limita anche la ricerca delle immagini storiche alla sola pubblicazione interessata, evitando l'espansione globale dell'archivio nei confronti delle gallerie. Alla ripresa applicare 0018 prima di altri batch.

Le API di restart e temporary readonly disable hanno risposto **403**, per privilegi insufficienti. Il riavvio è stato avviato dalla sessione browser esistente; il database resta in recovery dopo il tentativo. L'account aperto è Developer; solo l'Owner può intervenire sulla fatturazione. Non sono stati attivati piani a pagamento, aumenti a consumo o messaggi al supporto.

L'utente ha escluso il passaggio a Pro il 14 ottobre 2026. Il controllo successivo conferma ancora 57P03: serve una valutazione del supporto per ripristinare l'accesso sul piano attuale; non è garantito che il recupero possa avvenire senza spazio aggiuntivo. La [bozza della richiesta](SUPABASE-RECOVERY-SUPPORT-DRAFT.md) è pronta ma non inviata. Le anteprime restano da compattare: la loro manutenzione è stata arrestata prima di aggiornare i riferimenti.

Il workflow GitHub **Property Lifecycle Radar** (`property-lifecycle.yml`) è stato disabilitato temporaneamente durante il blocco. Nessun nuovo job è stato avviato per il rilascio. Riabilitarlo soltanto dopo la manutenzione e la verifica delle letture/scritture con `gh workflow enable property-lifecycle.yml`; non avviare scansioni nel frattempo. Il desktop SISTER/Tecnocloud e il workflow della sua release non sono modificati.

Alla ripresa: verificare lo stato e i job attivi, applicare 0018, completare i batch, confrontare conteggi e contenuti, eseguire il recupero fisico con lock timeout, verificare nuovamente letture/scritture, compattare le anteprime e misurare Storage. Rilascio del codice applicativo distinto dall'applicazione delle migrazioni: non considerare attive le riduzioni dei trasferimenti del runtime finché il codice non viene pubblicato.
