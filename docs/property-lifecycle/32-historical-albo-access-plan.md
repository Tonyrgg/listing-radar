# Phase 4 — Historical Albo access plan

Audit HTTP anonimo del 20 ottobre 2026, prima del backfill. Nessun PDF scaricato.

## Accesso e filtri

Fonte primaria: https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/storico-atti

Il form pubblico POST espone oggetto, mittente, anno e numero di registrazione,
inizio e fine pubblicazione. Categoria e ufficio sono link pubblici `eseguiFiltro`
con `categoriaId`; il tipo atto è una categoria. Intestazioni ordinabili per
registro, atto, categoria, oggetto e periodo. Nessun endpoint privato necessario.
Non si usa mittente né si cercano persone.

Attenzione: il campo «data fine pubblicazione» limita la **fine**, non l'inizio.
Usarlo come 31 dicembre dell'anno può escludere atti con pubblicazione pluriennale.
Il filtro anno cerca sia registro sia atto: una riga del registro 2026 può dichiarare un atto 2025. Il backfill verifica almeno uno dei due anni su ogni riga, conserva entrambe le identità e deduplica per ID ufficiale tra batch annuali; non sostiene
che questo ricostruisca tutte le pratiche amministrative dell'anno.

Primi inventari annuali osservati: 2026 3.488; 2025 4.499; 2024 4.740;
2023 4.670; 2022 4.328; 2021 4.171. Conteggi dinamici: non baseline fissa.
Il totale non filtrato è salito da 25.126 a 25.127 durante l'audit.
Un risultato vuoto inatteso ferma il processo, non dimostra assenza.

Sessione anonima effimera obbligatoria: cookie conservati soltanto in memoria.
ID ufficiale `/papca/display/<id>` condiviso con Albo live. Pagine 20/50 righe,
azione pubblica `eseguiPaginazione`; NEXT/LAST richiedono la stessa sessione.
Nessun limite massimo temporale dimostrato. Copertura osservata agli estremi
2021–2026, non prova di continuità o completezza per categoria.

## Strategia meno invasiva

Un anno alla volta, dal 2026 indietro; inventory prima dei detail. Page size 50
solo se la risposta conferma pagina e conteggio. Una richiesta alla volta,
ritardo >=450 ms, timeout 25 s, due retry per 429/5xx con backoff; nessun retry
su 403. Nessuna scansione dei PDF. Filtro locale `territorial_relevance_v1`
prima dei detail, esclusione degli atti amministrativi privi di riferimento
territoriale o categoria utile. Titoli liberi restano soltanto in memoria.

Checkpoint e lease nei run già esistenti; archivio documenti unico. Identity
ufficiale identica al live, hash e first_seen preservati. Health HISTORY separata
da LIVE. Replay invariato: nessuna nuova versione, solo conferma last_seen.
Stop su drift, ID duplicati, anno non presente n? nel registro n? nell?atto, conteggi implausibili, struttura cambiata,
403/429 esauriti o errori detail. Nessun passaggio automatico all'anno successivo
in caso di errore. Checkpoint atomico insieme alla scrittura del batch.

## Ambiguità e identità

I 71 casi sospesi contengono molti ID ufficiali distinti con nome identico e
locality nulla. Il solo testo uguale non autorizza a scegliere un ID. Servono
evidenze indipendenti; altrimenti REVIEW. `building_identity_v1`: strada canonica
univoca, civico esatto, località compatibile e assenza di contraddizioni sono
necessari; coordinate vicine o particella da sole insufficienti. Nessun merge
dei due PROBABLE prima di avere prova forte; conservazione degli ID esistenti.

L'Albo storico rimane distinto da un registro edilizio annuale. Il 2025 non
riceve indirizzi da persone, oggetti liberi o protocolli. Ricerca complementare
e specifica export nel report di consegna.

Audit esteso: 2026 completato in lettura (3.488 righe, 201 candidati). Il primo tentativo 2025 si ? fermato correttamente su registro 2026/921, atto 2025/75. Verificato che il filtro ? una unione registro/atto; policy corretta prima di qualsiasi ingestion.

## Ripresa operativa

`npx tsx --env-file=.env.local scripts/public-records-history.ts --year=2025` esegue soltanto inventory/dry-run. Aggiungere `--apply --confirm-project=<ref>` per il batch. La stessa chiamata riprende il checkpoint dopo il rilascio/scadenza del lease; nessuna nuova versione degli ID invariati. Se il manifest cambia, il processo si ferma: dopo revisione esplicita usare `--accept-manifest=<hash del nuovo dry-run>`. Vengono rivalutati gli ID, senza cancellare documenti o prove. Nessun backfill storico avviato dallo scheduler live.
