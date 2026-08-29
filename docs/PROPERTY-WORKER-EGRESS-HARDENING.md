# Property Worker: separazione aggiornamenti da Supabase

Data: 29 agosto 2026

## Obiettivo

Rendere installazione e aggiornamenti del Property Data Worker indipendenti dalla quota Egress Supabase, senza cambiare il comportamento delle run e senza indebolire verifica, ripresa o sicurezza del pacchetto.

## Architettura

- GitHub Releases ospita installer, manifesto e parti da 32 MiB.
- Il desktop interroga l'API pubblica della release più recente, accetta soltanto asset del repository `Tonyrgg/listing-radar`, verifica tag, nomi, dimensioni e firma SHA-256 e riusa le parti già valide.
- `/api/property-worker/download` risponde con un redirect diretto all'installer GitHub; il binario non attraversa Vercel o Supabase.
- Gli endpoint `/api/property-worker/download` e `/api/property-worker/version` non eseguono il refresh della sessione Supabase, così restano disponibili durante una restrizione del progetto.
- La build pubblica include soltanto impostazioni non sensibili. Service role key, file Excel e percorsi personali restano nelle preferenze cifrate di Windows.

## Comportamento con HTTP 402

Supabase rimane il registro durevole di job, checkpoint e audit. Una run che usa quella persistenza non può continuare in modo affidabile quando il progetto rifiuta le richieste: il worker la blocca prima di modificare il CRM, mostra una condizione cloud distinta dalla configurazione mancante e conserva i dati locali già presenti. I dry-run locali della via completa e il canale aggiornamenti continuano invece a funzionare perché non dipendono da Supabase.

Per ripristinare le run serve il rinnovo della quota, un piano adeguato o un backend esplicitamente migrato; spostare soltanto gli aggiornamenti evita nuovo Egress ma non può aggirare una restrizione applicata al database.

## Transizione dalle versioni esistenti

La `0.15.1` e le versioni precedenti leggono ancora `property-worker-updates/latest.json`. La prima versione predisposta per consegnare loro il nuovo updater è la `0.16.0`:

1. incrementare la versione, completare i gate, committare e portare `HEAD` sul branch remoto;
2. eseguire `npm.cmd run desktop:release` per pubblicare e verificare la release GitHub;
3. pubblicare la stessa build una sola volta con `npm.cmd run desktop:publish-update:legacy-bridge -- --confirm-one-time-bridge`;
4. verificare su un'installazione precedente che aggiornamento e preferenze cifrate siano conservati;
5. non utilizzare più il ponte dalle release successive.

## Attivazione

Il 29 agosto 2026 il cambiamento è stato integrato in `main`, la release GitHub `property-worker-v0.16.0` è stata pubblicata e verificata integralmente e il ponte legacy è stato pubblicato e verificato nel bucket precedente. Il ponte non deve essere rieseguito: dalla versione successiva il canale è esclusivamente GitHub.

## Gate locali eseguiti

- suite worker completa: 29 file e 210 test PASS, comprese grandi run, batching, updater e classificazione HTTP 402;
- build TypeScript CLI e desktop: PASS;
- controllo visuale desktop/mobile: PASS, compresa la separazione tra blocco delle operazioni cloud e updater disponibile;
- lint, typecheck, 248 test unitari e build di produzione Next.js: PASS;
- installer Windows `0.16.0`: build locale PASS, 98.010.305 byte;
- configurazione nell'installer estratto: presenti soltanto nove chiavi non sensibili, nessuna service role key o percorso Excel;
- protezioni dei comandi di pubblicazione: worktree pulito obbligatorio per GitHub e conferma esplicita obbligatoria per il ponte;
- release GitHub `0.16.0`: manifest e asset verificati senza download binari, poi 3 parti riscaricate e ricomposte con hash finale corretto;
- ponte legacy `0.16.0`: manifest e dimensioni remote verificati dopo la pubblicazione.

Le versioni successive devono usare soltanto `desktop:release`, `desktop:verify-update` e, quando necessario, `desktop:verify-update:full` sul canale GitHub.
