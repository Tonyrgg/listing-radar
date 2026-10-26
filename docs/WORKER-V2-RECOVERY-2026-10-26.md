# Worker V2 — ripresa e pause

## Correzioni della 0.34.28

Il caricamento iniziale del checkpoint poteva propagare un errore di rete prima di produrre un esito controllato. Ora una indisponibilità transitoria del servizio restituisce una pausa globale prima di qualunque azione CRM. La ripresa rilegge il checkpoint: una creazione già registrata, ma con risposta persa, non viene assunta come fallita o completata. Errori permanenti continuano a emergere, senza essere mascherati come semplici disconnessioni.

La pausa dopo l'immobile corrente era controllata nel primo passaggio della coda, ma non nel secondo passaggio destinato agli immobili con errore transitorio o indice in ritardo. Ora vale in entrambi i passaggi. L'esito di pausa viene anche notificato al coordinamento parallelo; il completato rimane fra i risultati e gli altri checkpoint restano disponibili.

Queste sono correzioni del motore Import V2 e della coda condivisa. Il desktop Territorio usa il motore ma ha una propria orchestrazione della coda: non si attribuisce a questa correzione un difetto del suo pulsante Pausa che non è stato riprodotto.

## Verifiche

Tre regressioni nuove: checkpoint registrato con risposta persa, errore permanente di caricamento e pausa durante il passaggio di recupero con successiva conclusione dell'immobile rimasto. La ripresa e il replay conservano due persone, un immobile e una sola attività nel caso sintetico. Suite mirata motore/coda/retry: 51 test passati; compilazione TypeScript passata.

Suite completa: **944 test passati in 115 suite**, uscita 0, 316,72 secondi. Build desktop e installer 0.34.28 passati. Il codice motore/coda nell'ASAR del pacchetto coincide con la compilazione qualificata. Installer non firmato, SHA-256 `9ee9ccfcbce66569031e3d0491532c2084260d79138fdd1891a2c187ea46aec0`, 99.872.093 byte.

Consegna sul [canale Worker 0.34.28](https://github.com/Tonyrgg/listing-radar/releases/tag/property-worker-v0.34.28), con verifica del manifest e del download ricomposto dopo la pubblicazione. La versione installata su questo PC resta 0.34.27: nessuna chiusura o riapertura dell'applicazione durante questo intervento in background. Gli esiti della nuova versione sono collaudi del pacchetto, non una prova di installazione locale.

## Prestazioni: cosa manca ancora

La lettura non modificante dell'archivio corrente ha trovato 1.350 immobili, zero checkpoint Import V2 e zero iscrizioni nella coda di importazione. Non esiste ancora il file dei tempi di import sul profilo corrente. Non è stato avviato un lotto storico o creato un nominativo CRM per ottenere un numero.

Il miglioramento reale della ricerca CF misurato nella 0.34.27 rimane valido per quel campione, non misura l'intero import. Questa consegna non aggiunge una nuova percentuale di velocità.

Al prossimo lotto operativo selezionato, lasciare registrare il percorso esistente e usare:

```powershell
npm.cmd --prefix worker run worker-v2:timings -- <profilo>/import-v2-timings.jsonl --run=<ID>
```

Il rapporto distingue ricerca catastale iniziale, stadi del motore, tentativi e salvataggio checkpoint. Non include oggi una misura completa della precedente acquisizione SISTER e non va presentato come tale. Prima si confrontano mediana e coda lenta per stadio, poi si interviene su letture ripetute e attese effettivamente osservate, mantenendo verifica CF, identità catastale, intestatari e ricevute attività.

Nel percorso Tecnocloud restano ricerche, caricamenti Lightning, commit dei lookup e indicizzazione dopo la creazione. Sono vincoli da misurare durante il lotto, non nuovi blocchi live dimostrati. I timeout da 10–30 secondi nel codice sono limiti massimi di attesa e terminano quando il controllo è pronto: non sono tutti ritardi fissi eliminabili. Le finestre di stabilità ripetono letture brevi per evitare risultati vecchi; ridurle senza misurare la risposta può trasformare una ricerca incompleta in una creazione duplicata.

## Limiti

Prove di guasto e ripresa locali con dati sintetici; nessun nuovo import completo live, nessun nuovo guasto causato a SISTER/Tecnocloud. Le sessioni Facebook non servono per questo lavoro. Gli altri due PC non sono stati toccati.
