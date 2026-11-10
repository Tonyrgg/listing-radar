> Stato successivo: il passaggio production è descritto nella [consegna definitiva](PRISMA-ARCHIVE-IMPLEMENTATION-2026-11-10.md). Questa pagina conserva il collaudo preliminare.

# Supabase + Prisma Free — primo collaudo e piano

## Decisione proposta

Procedere con un'implementazione isolata per esternalizzare lo storico dei fingerprint. Il campione ha superato i controlli, ma non qualifica ancora la migrazione completa o l'integrazione con il sito. La produzione continua a usare Supabase. Nessuna modifica al codice applicativo, nessuna cancellazione o scrittura Supabase durante queste prove.

Prisma è stato associato all'account dell'utente con conferma esplicita dell'autorizzazione a Prisma Create DB. Nessun pagamento o upgrade attivato. Account e limiti effettivi del workspace vanno verificati nella console prima del collegamento production; il piano Free pubblicizzato offre 2 GB e 200.000 operazioni mensili condivise nel workspace, senza backup automatici.

Fonti: https://www.prisma.io/postgres/free-postgresql-hosting e https://www.prisma.io/docs/postgres/faq.

## Prove concluse

Campione estratto con ordinamento hash dell'ID, distribuito su 154 immobili: 256 gruppi di fingerprint, 6.357 osservazioni. Il contenuto logico viene ricostruito includendo i componenti condivisi: copiare solo i riferimenti numerici a quei componenti non sarebbe sufficiente.

Prisma contiene unicamente la copia di prova, nello schema `listing_radar_trial`. Il campione rimane disponibile per ulteriori verifiche; dati sintetici di test tenuti distinti. Nessuna tabella del progetto operativo è stata collegata a Prisma.

Controlli passati:

1. Rilettura completa di payload, ID e osservazioni identica alla sorgente.
2. Reinvio del lotto senza duplicati.
3. Ricerca dei valori distinti property/algoritmo/fingerprint uguale al risultato atteso del campione. Non è un collaudo del motore completo di similarità o della combinazione con immagini correnti e planimetrie.
4. Due connessioni inseriscono contemporaneamente la stessa osservazione sintetica: un solo inserimento.
5. Ripetizione dopo ipotetica risposta persa: nessun duplicato. La risposta di rete non è stata realmente intercettata o soppressa; è stata ignorata e poi ripetuta l'operazione.
6. Rollback: nessuna osservazione parziale.
7. Disconnessione prima del commit: nessuna scrittura parziale.
8. Nuova connessione: il campione confermato in precedenza è ancora presente.

Ricerche sul campione, 12 esecuzioni, massimo 75 immobili per richiesta: mediana 192 ms, massimo 438 ms. Misura dal PC corrente, senza carico significativo; non è una previsione garantita sul dataset completo o da Vercel.

29 invocazioni client nel test, alcune comprendono più statement. Non sono una lettura del contatore di fatturazione Prisma. Risultati locali in `.runtime/prisma-archive-qualification.json`; campione privato in `.runtime`, credenziali nel file temporaneo separato. Non pubblicare questi file.

## Spazio

Sorgente completa: 40.943 gruppi, 85.139.456 byte fisici per tabella e indici. Fingerprint correnti: 12.050.432 byte, da mantenere inizialmente in Supabase.

Campione Prisma con JSON autocontenuto e indici di prova: 1.130.496 byte; database Prisma totale misurato 8.735.891 byte. Estrapolazione lineare dei gruppi: circa 181 MB per l'archivio, molto sotto 2 GB, ma da misurare copiando il dataset intero perché distribuzione delle osservazioni, indici e compressione cambiano il risultato.

Ultima misura Supabase: 472.427.667 byte, contro 485.002.387 della misura precedente. È una variazione fisica osservata durante letture, non spazio liberato dal trasferimento: nessun archivio è stato rimosso. Non ricavare una crescita giornaliera da questi due numeri.

Sottrarre teoricamente 85.139.456 porta a 387.288.211 byte, PRIMA dei nuovi metadati/cataloghi e di altre variazioni. Non è un risultato ottenuto, né una garanzia. Il recupero fisico deve essere pianificato e misurato dopo un eventuale trasferimento qualificato; una cancellazione logica da sola può non diminuire il numero.

## Consumo mensile: scenari, non misure di fatturazione

Gli ultimi giorni pieni hanno circa 22 sync al giorno. Il lettore attuale richiede fingerprint per gruppi di massimo 75 immobili e memorizza il catalogo nella singola istanza del repository. Con 706 immobili, un caricamento globale richiederebbe circa 10 richieste se lo si conservasse con la stessa suddivisione.

Ipotesi: per ogni sync 10 letture e 2 scritture in blocco, 30 giorni:

- 22 sync/giorno: 7.920 operazioni nominali/mese.
- 220 sync/giorno: 79.200.
- 550 sync/giorno: 198.000, troppo vicino al limite.

Questi conteggi non includono tutte le consultazioni, query ausiliarie, tentativi, backup, connessioni o costi interni del provider. Devono essere verificati dal contatore del workspace durante uno shadow run. Scrivere una query per ogni immagine o osservazione può invece esaurire rapidamente la quota: il contratto deve usare lotti, checkpoint e idempotenza.

## Architettura proposta

Supabase conserva login, utenti, memoria condivisa e coordinamento Worker, immobili, pubblicazioni, fingerprint correnti e planimetrie. Lo storico fingerprint autocontenuto passa a Prisma. I componenti condivisi restano in Supabase finché altre evidenze/versioni li referenziano: nessuna rimozione indiscriminata.

Prima opzione: mantenere su Supabase un catalogo leggero dei fingerprint storici distinti, per conservare il matching locale, e usare Prisma per le osservazioni estese. Va misurato il costo del catalogo: recupero netto inferiore agli 85 MB lordi.

Seconda opzione: ricerca storica su Prisma e unione sul server con correnti/planimetrie Supabase, mantenendo l'identità per ID. Riduce le copie locali ma richiede gestione esplicita dell'indisponibilità di Prisma. Nessun accesso diretto con credenziali amministrative dal browser.

Non promettere una transazione unica fra due database. Il trasferimento richiede una coda durevole con ID operazione, ricevuta verificata dal destinatario e checkpoint. Un guasto deve lasciare un lavoro recuperabile, non provocare perdita o dichiarazione di successo.

## Sequenza di implementazione e passaggio

1. Verificare piano Free e contatore del workspace; collocare le credenziali in configurazione protetta stabile, fuori da TEMP e dal codice, con permessi minimi per il servizio quando disponibili.
2. Definire schema esterno versionato, vincoli, ID stabili, copie di sicurezza ed esportazione verificabile. Separare credenziali amministrative da quelle dell'applicazione.
3. Copiare l'intero archivio in blocchi, senza rimuovere la sorgente. Verificare ogni gruppo, tutte le osservazioni, componenti ricostruite, conteggi e checksum.
4. Provare matching reale, compresa l'unione con dati correnti/planimetrie; scegliere fra catalogo locale e interrogazione esterna con misure sul dataset completo.
5. Implementare inserimenti ripetibili e coda durevole; provare risposta persa, stop, ripresa, aggiornamenti arrivati durante il trasferimento e provider indisponibile.
6. Eseguire shadow read e misurare operazioni reali su un periodo rappresentativo. Non dichiarare valida una stima mensile solo dal benchmark sintetico.
7. Verificare un backup indipendente e il ripristino su un ambiente separato. Prisma Free non sostituisce quel backup.
8. Finestra di passaggio: fermare brevemente le acquisizioni interessate, trasferire il delta, confrontare e attivare il lettore esterno tramite configurazione reversibile.
9. Conservare sorgente e percorso di ritorno durante la verifica iniziale. Poi rimozione della sola copia qualificata e recupero fisico con margine disco/WAL verificato; misurare spazio e funzionalità finali.

Questo documento conclude la prova iniziale autorizzata. Non applica nuove migrazioni, non cambia le acquisizioni, non trasferisce la sorgente di riferimento e non qualifica ancora un rilascio production.
