# Worker 0.34.37 — recupero e barriera di sincronizzazione

## Chiusura del recupero: 12 novembre, revisione 270

La 0.34.37 era installata in ufficio ma il salvataggio continuava a fallire.
I log PostgreSQL hanno individuato il timeout nell'elaborazione del pacchetto
`p_changes`, prima della conferma. La 0091 ha tentato il raggruppamento in una
sola passata, ma il pacchetto reale dell'ufficio ha continuato a superare il
limite di esecuzione. Non è stata considerata una soluzione conclusiva.

La **0092**, applicata e registrata, rende `territory_workspace_records` la
fonte operativa autorevole. La RPC aggiorna solo quei record, le tombstone,
la revisione e l'evento di sincronizzazione, nella medesima transazione.
Non ricostruisce più il grande JSON dello snapshot a ogni invio. La colonna
`state` resta una copia storica di bootstrap con etichetta `snapshot_revision`;
non va letta come archivio online corrente. Le API incrementali e paginate
leggono già i record autorevoli, anche sul Worker 0.34.37 dell'ufficio.
Un vecchio salvataggio completo viene rifiutato se la copia storica è più
vecchia dei record operativi: non può sovrascrivere fatti più recenti.

Subito dopo questo intervento il tentativo automatico dell'ufficio è riuscito:
revisione **269 → 270**, **788 immobili ulteriori**, totale **2.226**.
Via Gorizia: **88 immobili**. Via Giotto: **65 immobili** sulla scheda del
tracciato di mappa `network:34097417`; le voci ufficiali omonime non sono state
unite arbitrariamente. Nessuno stato CRM è stato inventato o forzato.

Casa riconciliata con backup preventivo: revisione 270, pending=false,
zero conflitti. Confronto completo con lo stato ricostruito dagli **7.908
record online**: **hash del contenuto identico**. L'utente ha confermato
entrambe le vie presenti e «sincronizzato» anche sul PC dell'ufficio.
Il secondo PC dell'ufficio non è stato verificato direttamente.

Collaudo SQL isolato: 6.000 immobili sintetici e pacchetto offline di 10.200
record; verificati contenuti di ogni record, rollback completo, revisione
errata o nulla, profilo nullo, tombstone, concorrenza, letture paginate e
rifiuto della sovrascrittura da snapshot vecchio. Le tempistiche locali non
sono una promessa di prestazioni del servizio online.

Le sezioni seguenti descrivono le fasi precedenti del recupero. Il mancato
arrivo di Via Giotto indicato più sotto è stato superato dalla revisione 270.

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

### Secondo problema isolato durante il recupero

Una nuova lettura completa via RPC a quattro parametri è fallita HTTP 500 sotto
carico. Correggere soltanto la scrittura non basta. Migrazione **0090**, applicata
e registrata: overload a sei parametri con pagine da massimo 100 record,
cursore e revisione fissa. Il server rifiuta una pagina se la revisione cambia;
il client scarta tutto il recupero parziale e riparte. Le pagine non modificano
il profilo locale fino al completamento della lettura. La vecchia API resta
compatibile, ma per usufruire delle pagine occorre aggiornare il Worker.

Prova online reale: **6.486 record in 65 pagine, circa 10,64 secondi**, revisione
269 costante. Nuova riconciliazione effettiva di casa via client aggiornato:
pending=false, zero conflitti. Quattro ulteriori test verificano composizione
delle pagine, revisione cambiata, errore nell'ultima pagina senza mutazione
locale e cursore ripetuto. Totale mirato **70 test passati**, più prova SQL
isolata su 6.000 immobili, 61 pagine e controllo del cambio revisione.

La copia dell'ufficio deve essere aperta e collegata alla memoria online, con
coda ferma, per inviare Via Giotto e ricevere Via Gorizia. Il database non può
ricostruire un archivio rimasto solo su un PC non raggiungibile. Aggiornare tutte
le postazioni alla 0.34.37 per usare lettura paginata e barriera prima di ogni immobile.

Non è dimostrata la convergenza di tutti e tre i PC finché non riceviamo e
confrontiamo anche i loro dati. La protezione attuata impedisce di proseguire
silenziosamente quando la conferma manca; non promette disponibilità assoluta
di rete o database.
