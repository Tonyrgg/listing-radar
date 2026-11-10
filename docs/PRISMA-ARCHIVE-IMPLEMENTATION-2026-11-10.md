# Supabase + Prisma — consegna del 10 novembre 2026

## Architettura consegnata

Supabase resta il database operativo: accesso utenti, sincronizzazione dei Worker,
immobili, pubblicazioni e dati correnti. Prisma ospita lo storico autocontenuto
dei fingerprint. Supabase conserva ricevute e valori di identità leggeri, quindi
il matching ordinario resta locale e non richiede lo storico remoto per ogni casa.

Il sito usa la vista storica compatibile tramite un collegamento PostgreSQL privato,
con TLS verify-full. Nessuna credenziale Prisma è consegnata al browser. Le migrazioni
Supabase 0065–0072 e Prisma 0001–0002 sono applicate. Il Worker non cambia versione
per questa consegna: login e contratto della sincronizzazione restano su Supabase.

## Coerenza e guasti

La tabella locale originale diventa una coda durevole. I dati passano al catalogo
leggero solo dopo copia transazionale, rilettura, backup e confronto esatto effettuato
da Supabase contro i payload effettivamente presenti su Prisma. Ogni eliminazione
richiede una ricevuta corrispondente al contenuto sorgente. Il ruolo degli utenti
non può confermare o eliminare gruppi. Prisma rifiuta UPDATE e DELETE sui gruppi.

Un timeout reale durante la migrazione ha lasciato il lotto non confermato sul
sorgente. La ripresa con lotti da 25 ha continuato dal lavoro ancora presente.
Non si è usato il timeout come prova di successo e non si sono saltati record.
Gli ID delle transazioni che terminano fuori ordine vengono riconciliati anche
se inferiori al checkpoint. Non è promessa una transazione unica fra i database.

Lo spazio fisico della coda si recupera solo dopo averla trovata vuota sotto lock;
la sequenza degli ID viene conservata. I componenti condivisi ancora usati da altre
evidenze non vengono eliminati. La protezione dei nuovi sync di mercato a 475 MB
resta attiva: la migrazione non disabilita i controlli di capacità.

## Backup e manutenzione

Backup indipendente locale gzip da 37.806.845 byte, interamente ripristinato in una
tabella temporanea e confrontato con tutti i gruppi prima del passaggio.

Backup cloud nel bucket privato Supabase `radar-archive-backups`: blocchi gzip
con SHA-256 e manifest. La prima copia contiene **40.943 gruppi e 1.063.130
osservazioni**, occupa **38.121.212 byte** compressi ed è stata riscaricata e verificata
prima di confermare i gruppi. I blocchi invariati vengono riutilizzati nei backup
successivi, evitando una nuova copia completa per ogni giorno.

Vercel ha registrato il cron `/api/cron/archive`, **03:15 UTC ogni giorno**;
in inverno corrisponde alle 04:15 italiane, in estate alle 05:15. Il cron esistente
delle acquisizioni rimane separato. Il ciclo ha un budget di 270 secondi e registra
l'esito in `fingerprint_archive_maintenance_runs`, inclusi eventuali lavori residui.
Compatta lotti limitati, trasferisce, esegue backup e conferma; evita la compattazione
quando vede una sincronizzazione in corso. Un lock Prisma evita due manutenzioni
contemporanee. Conservazione: backup giornalieri per sette giorni e punti settimanali
fino a 35 giorni, con pulizia prudente dei blocchi non più referenziati.

## Collaudi

- Matching di tutti i **706 immobili**: **17.883 valori immagine e 79 planimetrie**,
  **zero differenze** fra catalogo locale e storico Prisma.
- Lettura completa della mappa: **706 immobili unici**, nessun ramo mancante;
  28,8 secondi dal PC durante il trasferimento. È una misura sotto carico,
  non una promessa di tempo di caricamento della pagina o una prova dal PC ufficio.
- **116 test passati in 14 suite**: archivio, ricevute, dati differenti, ripresa,
  checkpoint fuori ordine, identità, letture territoriali, backup e conservazione.
- Build production, TypeScript applicativo e lint dei file aggiunti passati.
- Endpoint di manutenzione senza autorizzazione: **401**; login pubblico: **200**.
- Distribuzione Vercel production READY, con credenziale Prisma configurata come
  segreto server e cron registrato nel progetto.

## Limiti operativi

Prisma Free non è spazio o traffico illimitato. Operazioni, spazio e traffico vanno
controllati sui contatori ufficiali; le chiamate contate dal client non equivalgono
alla fatturazione. Il filtro a 475 MB protegge i nuovi sync di mercato, non ogni
possibile scrittura amministrativa. I backup consumano Storage, non Database Size.

La verifica delle identità rimane locale se Prisma è indisponibile. Le letture dei
payload storici e i controlli di duplicazione che richiedono quelle osservazioni
possono invece fallire esplicitamente: non vengono tradotti in assenza di dati.

Comandi, conservazione e recupero: [manuale dell'archivio](../prisma-archive/README.md).

## Esito finale in produzione

- Supabase: **401.214.611 byte** dopo il recupero fisico, circa **401 MB** e
  **99 MB di margine** rispetto alla soglia decimale di 500 MB. Prima del passaggio
  erano 472.427.667 byte: circa 71 MB recuperati, al netto del nuovo catalogo.
- **41.639 gruppi e 1.064.150 osservazioni** verificati integralmente; coda locale
  **vuota**, tutte le ricevute confrontate con i payload esterni. I numeri includono
  anche i nuovi gruppi prodotti durante le prove della manutenzione.
- Ultimo ciclo Vercel: **HTTP 200 / SUCCEEDED**, concluso in **106,7 secondi**:
  305 osservazioni compattate, 238 gruppi copiati, 696 confermati, zero residui.
- Backup finale: `manifests/2026-11-10-41675.json`, **38.195.553 byte** compressi;
  SHA-256 del contenuto: `f48cef0bee6b935fd62ad2f6578ee2904fb7fb5607dc381c02756602132e33dd`.
- Il backup giornaliero ora riutilizza il prefisso immutabile già verificato,
  riscarica e controlla i blocchi esistenti con concorrenza limitata a quattro e
  legge da PostgreSQL soltanto i nuovi payload. Se compaiono ID più vecchi del
  checkpoint, il conteggio forza una nuova scansione completa. La prima versione
  riscriveva tutti i blocchi e ha superato il budget Vercel: quel tentativo è
  registrato FAILED e non ha confermato né rimosso dati pendenti.
- Migrazioni 0071–0072: lettura storica circoscritta alla pubblicazione e riuso del
  precedente snapshot nella stessa osservazione atomica, evitando la ripetizione
  della lettura remota per ogni fotografia. Verifica reale: 27 impronte uguali al
  riferimento esterno; prova integrale delle osservazioni atomiche passata.
- Matching finale su 706 immobili: zero differenze, 17.883 valori immagine e
  79 planimetrie. Lettura completa della mappa finale: **706 immobili unici,
  19,5 secondi** dal PC. Nessuna prova diretta effettuata sul PC dell'ufficio.
- Prisma: database fisico **184.659.091 byte**, tabella archivio e indici
  **175.685.632 byte**. Queste sono misure SQL, non il contatore di fatturazione.
- Rilascio attivo: `dpl_CpXqVYdPmV1L8rYvgKwhTqZUMMZJ`, alias
  https://listing-radar-mu.vercel.app. Cron attivo e registrato sull'ultimo rilascio.
- Ledger delle migrazioni Supabase aggiornato fino alla 0072. Nessun pagamento
  attivato; il database Prisma e Vercel rimangono sui piani gratuiti esistenti.
