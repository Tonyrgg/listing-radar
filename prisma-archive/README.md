# Archivio fingerprint esterno — Supabase + Prisma

## Funzionamento

Supabase conserva Auth, sincronizzazione Worker, immobili, pubblicazioni, dati
operativi e un catalogo leggero dei fingerprint storici. Prisma conserva i gruppi
storici autocontenuti con tutte le osservazioni. Il matching ordinario continua
ad interrogare il catalogo Supabase, senza una chiamata remota per ogni immobile.

Le migrazioni Supabase 0065–0072 collegano lo storico con un foreign server privato,
TLS verify-full e ricevute verificate. Le migrazioni in questa directory riguardano
esclusivamente Prisma: schema esterno e protezione dei gruppi da UPDATE/DELETE.

Non esiste una transazione atomica fra i due database. La tabella Supabase originale
è una coda durevole: ogni contenuto resta lì fino a copia, rilettura, backup cloud
verificato e confronto esatto effettuato dal server con la destinazione effettiva.
Solo a quel punto viene sostituito da una ricevuta locale. Errori interrompono il
passaggio e conservano quanto non ancora confermato. Gli ID allocati da transazioni
che terminano fuori ordine vengono riconciliati anche prima del checkpoint.

## Pianificazione e limiti

Vercel esegue `/api/cron/archive` ogni giorno alle **03:15 UTC** (04:15 italiane
in inverno, 05:15 in estate). Il cron originario delle acquisizioni resta distinto.
La manutenzione usa un lock su Prisma per evitare due esecuzioni contemporanee e
registra in Supabase ogni esito in `fingerprint_archive_maintenance_runs`.

Il ciclo ha un budget di 270 secondi: compatta un numero limitato di osservazioni,
trasferisce nuovi gruppi, verifica il backup, conferma lotti da 25 e recupera lo
spazio fisico della coda soltanto se questa è vuota. `remaining` riporta lavori
residui, ripresi al ciclo successivo; SUCCEEDED indica un ciclo concluso, non
l'assenza assoluta di lavori residui. Se una sincronizzazione è in corso, la fase
di compattazione viene saltata. La protezione Supabase a 475 MB resta attiva.

Backup nel bucket **privato** `radar-archive-backups`: blocchi gzip identificati dal
contenuto, manifest quotidiani, rilettura e verifica prima della conferma. I blocchi
immutati sono riutilizzati. Conservazione giornaliera per sette giorni e punti
settimanali fino a 35 giorni; i blocchi non più referenziati si eliminano solo dopo
48 ore e dopo aver letto correttamente tutti i manifest da preservare.

Questi limiti non rendono illimitati i piani Free: quote di spazio, operazioni e
traffico vanno sorvegliate. La guardia a 475 MB protegge i nuovi sync di mercato,
non blocca ogni possibile scrittura amministrativa o del Worker.

## Configurazione riservata

`PRISMA_ARCHIVE_DATABASE_URL` è una variabile **server** in Vercel Production.
Per manutenzione locale è in `.env.prisma-archive.local`, ignorato da Git.
TLS richiesto: `sslmode=verify-full`. Non usare un prefisso NEXT_PUBLIC e non
incollare credenziali in log, issue o documentazione. Il collegamento FDW è in
uno schema privato; gli utenti del sito non ricevono la credenziale Prisma.

## Comandi

Dalla radice, con Node recente (supporto `process.loadEnvFile`) e variabili locali:

```powershell
# Sola lettura: controlli connessione, archivio completo e matching
npx tsx scripts/prisma-archive-transfer.ts check
npx tsx scripts/prisma-archive-transfer.ts verify
npx tsx scripts/prisma-archive-shadow.ts

# Backup indipendente locale, con prova di ripristino in tabella temporanea
npx tsx scripts/prisma-archive-report.ts --backup

# Ciclo completo: richiede progetto esplicitamente confermato
npx tsx scripts/prisma-archive-maintenance.ts --apply --confirm-project=REF_PROGETTO
```

`verify` confronta sia i payload ancora nella coda sia i checksum delle ricevute
con tutti i gruppi Prisma; `shadow` confronta le identità su tutti gli immobili.
`report --backup` produce gzip e manifest sotto `.backups`, esclusi da Git.

Il comando `prisma-archive-finalize.ts` è riservato alla prima migrazione: richiede
un manifest cloud, ricontrolla tutti i blocchi prima di confermare i gruppi e poi
verifica ogni ricevuta. Non è necessario per il funzionamento quotidiano.

## Ripristino

Per ricostruire l'archivio esterno: scaricare un manifest verificato e i blocchi
elencati, confrontare SHA-256 dei gzip e SHA del contenuto concatenato, applicare
0001 su un database vuoto, importare i gruppi conservando source/ID/payload/digest,
verificare il totale e soltanto dopo applicare 0002 e ricollegare il server privato.
La prova di ripristino dell'intero backup locale in tabella temporanea è stata
eseguita. Un ritorno integrale a Supabase richiede spazio aggiuntivo: non importare
l'archivio alla cieca nel piano Free e non disattivare le protezioni di capacità.

Esiti di produzione e dimensioni: [consegna](../docs/PRISMA-ARCHIVE-IMPLEMENTATION-2026-11-10.md).

## Dati del modulo matching ritirati

Dal 10 novembre le sezioni Richieste, Incarichi e Abbinamenti sono vuote, come
richiesto dall'utente. I dati ritirati sono in `retired_rows`, con vista di recupero
`retired_matching_effective` e backup privato corretto. Non usare l'esportazione
normalizzata iniziale dei componenti per un ripristino.
[Esiti, limiti e verifiche](../docs/SUPABASE-RETIRED-MATCHING-2026-11-10.md).

La migrazione 0076 mantiene autocontenuti i nuovi gruppi fingerprint in transito:
il passaggio notturno non crea più valori di dizionario destinati a restare inutilizzati.
