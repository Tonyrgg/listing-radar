# Bozza per il supporto Supabase — non inviata

Project ref: `eqqmglsxwbsihrlecnun`, EU West / Ireland, Free / Nano.

Il database non accetta connessioni e restituisce:

```text
FATAL: 57P03: the database system is not accepting connections
DETAIL: Hot standby mode is disabled.
```

PostgREST restituisce 503/PGRST002 perché non riesce a leggere la schema cache. In precedenza sono stati osservati 53100 (disk full) e 25006 (read-only transaction). Infrastructure riporta 1,92 GB occupati su 2 GB: database circa 1,5 GB, WAL circa 304 MB, sistema circa 171 MB.

È in corso una compattazione lossless di osservazioni ripetute. Nessun reset o cancellazione dello storico: viste compatibili ricostruiscono le righe originali e i batch verificano l'uguaglianza completa prima del trasferimento. Le migrazioni 0014–0017 sono applicate; i batch completati sono durevoli. La manutenzione è stata fermata quando il database è diventato indisponibile. Il recupero fisico con VACUUM FULL non è stato ancora eseguito.

Il riavvio dalla dashboard è stato avviato, ma non ha ancora ripristinato le connessioni. Le API di restart e temporary-disable-readonly hanno negato l'azione all'accesso CLI disponibile con 403. La dashboard usa un membro Developer; l'Owner dell'organizzazione può fornire le autorizzazioni necessarie.

Chiediamo il ripristino dell'accesso e la valutazione dello spazio necessario per completare il recupero senza perdita di dati. È già pronta una migrazione che libera un indice URL da circa 230 MB conservando il controllo transazionale dei duplicati, ma non possiamo applicarla finché il database non accetta query. Non richiediamo reset, restore a un punto precedente o cancellazione di dati.

Vogliamo mantenere il piano Free: non autorizziamo upgrade o addebiti. Potete valutare un recupero sul piano attuale e indicarci i passi necessari per riottenere una connessione di manutenzione? Le scansioni automatiche GitHub sono state temporaneamente disabilitate.

Non allegare file `.env`, service-role key, token, dati personali CRM o dump completi a questa bozza.
