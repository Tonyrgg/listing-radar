# Worker V2 — controllo dell’indice di sincronizzazione

## Riscontri sul PC collegato

Installata 0.34.30; archivio di 1.438 immobili, 11 run e 65 voci in coda.
Backup completo dei file ledger, binding, configurazione online e device ID in
`C:/Users/ruggi/listing-radar-backups/worker-sync-preinstall-20261111-142941`.
Nessuna run attiva prima della chiusura ordinata dell’app.

Workspace condiviso revisione 266, ultimo aggiornamento 10 novembre 13:38 UTC.
Dal pannello dell’app, Sincronizza ora ha risposto «Gli archivi coincidono già».
Questo dimostra soltanto l’accordo del PC collegato con il server; non dimostra
che le postazioni ufficio abbiano inviato i loro dati divergenti.

RPC incrementale senza modifiche: 91–163 ms, zero errori su tre richieste.
Scaricamento iniziale completo: 6.483 record, 7.484.722 caratteri JSON, 2.666 ms.
È stato osservato anche un avviso generico di errore di sincronizzazione nella
0.34.30; non è stato attribuito automaticamente alla rete o alla quota.

## Difetto individuato e migrazione 0088

Il trigger territory_index_workspace usava una sottoquery correlata che poteva
riespandere il JSON dell’intero workspace per verificare ciascun record indicizzato.
Una query equivalente di sola lettura sul database collegato ha superato anche
60 secondi, terminando con 57014. Il limite delle normali chiamate API è 8 secondi.

La nuova funzione calcola la proiezione una volta, con CTE MATERIALIZED, e la
riutilizza per upsert e verifica delle rimozioni. Il controllo equivalente ora
impiega 636,673 ms, con pianificazione 1,898 ms. Sono tempi del controllo in
lettura, non una misura end-to-end del salvataggio dal PC ufficio.

Conservati interfaccia RPC, revisioni, autorizzazioni, snapshot originali e
rimozioni versionate. La migrazione non modifica i dati del workspace. Applicata
tramite db push dopo test locale; efficace anche per client precedenti.

Tre test PostgreSQL PGlite passati: protocollo e rollback/autorizzazioni,
convergenza tra due profili indipendenti, archivio sintetico di 6.500 record con
modifica/rimozione e solo due delta restituiti. Nessuna falsa run CRM o modifica
fittizia dei dati reali per collaudare il salvataggio.

## Distribuzione desktop e verifica ancora necessaria

Installer 0.34.31 già pubblicato, canale verificato: tre parti, 99.891.438 byte.
Installer locale SHA-256 ECB0A7B1748403434FB0660732A6F397DF97DDEB0DBB07AF405298B346417E90.
Avviata installazione silenziosa dopo chiusura ordinata della 0.34.30. Windows
ha richiesto UAC: serve il clic dell’utente; il controllo di sicurezza non viene
automatizzato. Al momento della redazione il binario installato risulta ancora
0.34.30, quindi non si dichiara l’aggiornamento completato.

Dopo UAC: verificare binario 0.34.31, riaprire V2, provare sincronizzazione e
confrontare ledger/binding/cloud. Sui PC ufficio conservare i dati locali,
aggiornare la versione e sincronizzare con code ferme. Non sovrascrivere con
una copia del PC casa: mancano ancora prova e accesso ai dati locali ufficio.
