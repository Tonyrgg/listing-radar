# Worker 0.34.36 — recupero e barriera di sincronizzazione

## Evidenze raccolte

La schermata dell'ufficio mostra `57014` durante la scrittura online. Il codice
PostgreSQL indica una query annullata: da solo non certifica quale timeout o
intervento l'abbia annullata. La migrazione 0088 risultava già applicata online.
Non è corretto attribuire l'intero incidente alla sua assenza.

L'archivio condiviso e quello di casa contenevano 1.438 immobili, 88 collegati a
Via Gorizia, nessuno collegato alle voci Via Giotto. L'ufficio ha quindi dati che
non sono ricostruibili limitandosi a cambiare lo stato di una via sul server.
Nessun immobile è stato marcato importato manualmente.

## Intervento database

La RPC incrementale ricostruiva lo snapshot e attivava la reindicizzazione
completa. La migrazione **0089** mantiene lo snapshot compatibile, ma per questa
RPC aggiorna solo i record del delta. Snapshot, revisione, eventi di sync,
record aggiornati e tombstone sono una sola transazione. I salvataggi completi
precedenti restano supportati con indicizzazione completa.

Il marcatore che evita il trigger è locale alla transazione, circoscritto al
workspace ed è ripristinato dalla RPC. Le validazioni, l'identità proprietario e
il confronto atomico della revisione restano invariati. Nessuna disattivazione
globale di trigger o controlli di accesso.

Migrazione applicata e registrata sul progetto configurato. Backup locale dello
snapshot precedente in `.runtime/sync-recovery`, non versionato perché contiene
dati personali. Prova RPC sul solo metadato versione esistente: HTTP 200,
circa 1,87 secondi, revisione 268 → 269. Hash del contenuto dell'archivio invariato.
Verifica indipendente: **6.486 record attesi e letti, zero differenze**.

## Intervento Worker

Prima di ogni nuovo immobile della coda, il Worker online attende che l'esito
precedente sia sincronizzato, rifiuta errori/modifiche pendenti/conflitti e
rinnova la sessione esclusiva. In caso di errore si ferma fuori dal ciclo dei
tentativi del singolo immobile: non continua la coda accumulando esiti soltanto
locali. Restano il salvataggio locale atomico e i checkpoint per il recupero.
La sessione esclusiva viene rilasciata solo dopo il salvataggio finale.

Script `worker/scripts/reconcile-territory-online.ts`: controllo senza modifiche
di default; applicazione solo con conferma del progetto, profilo chiuso,
blocco esclusivo e backup di archivio e baseline prima del merge a tre vie.
Nessuna sostituzione forzata di un archivio con l'altro.

## Collaudo

- **66 test passati** in otto suite: sync, più PC, sessioni esclusive, coda,
  recupero CRM e applicazione; controllo TypeScript superato.
- PostgreSQL locale isolato con 6.000 unità sintetiche: delta, tombstone,
  compatibilità snapshot completo, conflitto di revisione fra due writer e
  rollback di snapshot e indice se la scrittura del delta fallisce.
- Nuova barriera: primo immobile concluso e conservato; errore di sync impedisce
  di iniziare il secondo.
- Casa riconciliata davvero: revisione 269, **pending=false**, zero conflitti,
  1.438 immobili; backup nel profilo sotto `sync-recovery`.

## Recupero ancora necessario

La copia dell'ufficio deve essere aperta e collegata alla memoria online, con
coda ferma, per inviare Via Giotto e ricevere Via Gorizia. Il database non può
ricostruire un archivio rimasto solo su un PC non raggiungibile. Aggiornare tutte
le postazioni alla 0.34.36 per usare la barriera prima di ogni immobile.

Non è dimostrata la convergenza di tutti e tre i PC finché non riceviamo e
confrontiamo anche i loro dati. La protezione attuata impedisce di proseguire
silenziosamente quando la conferma manca; non promette disponibilità assoluta
di rete o database.
