# Pulizia Supabase e sospensione dati matching — 10 novembre 2026

## Richiesta ed esito

L'utente ha confermato lo svuotamento di Richieste, Incarichi e Abbinamenti,
mantenendo codice, configurazione e funzionalità per un uso futuro.

Supabase dopo manutenzione: **359.435.411 byte**, circa **359 MB**, rispetto ai
circa 401 MB del precedente passaggio; margine circa **140 MB** sotto 500 MB.

Sono ora vuoti:

- 270 richieste (`property_requests`);
- 78 incarichi (`portfolio_properties`);
- 21.060 abbinamenti (`request_property_matches`);
- preferenze collegate, dati delle due importazioni CRM e attività del modulo:
  complessivamente **22.166 righe** trasferite e rimosse dalle tabelle attive.

Conservati: 15 zone interne, 20 definizioni delle caratteristiche, configurazione
del matching, clienti condivisi, dati di acquisizione, VAB, login e memoria Worker.
Nessuna cancellazione a cascata non verificata: i figli vengono confrontati con
Prisma e rimossi prima dei genitori; dipendenze sopraggiunte fermano il passaggio.

## Archivio e backup

I dati ritirati sono nella tabella privata Prisma `radar_archive.retired_rows`.
Per ripristinare il dataset usare **`radar_archive.retired_matching_effective`**
o il backup corretto. La vista seleziona le correzioni qualificate senza modificare
le copie tecniche precedenti, protette da UPDATE/DELETE.

Sono stati inoltre trasferiti e rimossi da Supabase **33.789 componenti tecnici
non più referenziati**. L'operazione ha ricalcolato le referenze sotto lock e ha
confrontato i payload effettivamente presenti su Prisma prima della rimozione.
I 56.401 componenti ancora utilizzati restano locali.

Il primo strumento di esportazione trasformava il formato di alcune date JSON:
il confronto SQL ha bloccato l'intera rimozione. L'esportazione HTTP grezza ha
conservato i valori originali; 2.003 righe sono state corrette tramite un dataset
aggiuntivo immutabile. Soltanto dopo il nuovo confronto esatto si è proceduto.
La copia precedente dei componenti è diagnostica e non va usata per il ripristino.

Backup corretto privato, anche locale sotto `.backups`:
`retired-sections/retired-matching-2026-11-10-digest.jsonl.gz`, dove il digest
esatto è nel manifest locale `.runtime/retired-components-verified.json`.
Dimensione **7.043.711 byte**, **55.955 righe**. L'intero backup è stato importato
in una tabella temporanea indipendente e confrontato con la vista qualificata:
zero differenze. Nessun dato personale è pubblicato nei log o nella documentazione.

## Crescita futura

I nuovi gruppi fingerprint destinati a Prisma restano autocontenuti nella coda
locale. Non vengono più inseriti nel dizionario condiviso per poi diventare
residui subito dopo il trasferimento. Se Prisma non è disponibile, i gruppi
restano in Supabase; le protezioni di identità e backup restano attive.

Il ciclo Vercel già pianificato è stato provato dopo questa modifica:
HTTP **200**, 233 osservazioni compattate, 170 gruppi copiati e confermati,
**zero residui**. Le restanti tabelle operative rimangono su Supabase, perché
partecipano alle letture, alle relazioni e alle transazioni del sito. Questa
consegna non trasferisce automaticamente ogni nuova tabella su Prisma.

La pulizia dei componenti è un intervento mirato sui valori archiviati e verificati;
non è un job che cancelli indiscriminatamente componenti o dati applicativi.
La salvaguardia a 475 MB sui nuovi sync di mercato resta attiva.

## Verifiche e distribuzione

- Migrazioni Supabase **0073–0076 applicate e registrate**; Prisma 0003–0004 applicate.
- Interventi backend operativi senza cambiare il codice del frontend o del Worker.
- **120 test passati in 17 suite**, inclusi vincoli, copie diverse, referenze
  mantenute, protezioni di accesso e transito senza crescita del dizionario.
- Archivio immagini: **41.809 gruppi, 1.064.383 osservazioni** verificati integralmente.
- Identità su tutti i 706 immobili: stessi 17.883 valori immagine e 79 planimetrie,
  zero differenze dopo la pulizia dei componenti.
- Mappa: **706 immobili unici** letti integralmente, circa 17,9 secondi dal PC.
- Login production HTTP 200; endpoint di manutenzione senza autorizzazione HTTP 401.
- Sito attivo: https://listing-radar-mu.vercel.app. Nessun nuovo pagamento.

## Comandi e evidenze

Gli script `archive-retired-sections.ts`, `retire-matching-sections.ts`,
`repair-retired-component-export.ts` e `verify-retired-backup.ts` richiedono i
file riservati locali. I primi tre richiedono conferma esplicita del progetto.
Sono procedure di questa migrazione, non comandi da eseguire quotidianamente.
Non rieseguire la copia iniziale dei componenti da un export normalizzato:
per il recupero usare la vista qualificata o il backup corretto verificato.

I report sotto `.runtime/retired-*`, le copie sotto `.backups` e tutte le credenziali
restano esclusi da Git. I log di migrazione precedenti non sono prove di successo
se riportano FAILED; l'esito definitivo è documentato dai confronti successivi.
