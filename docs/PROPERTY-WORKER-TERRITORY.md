# Property Worker: Worker V2 e laboratorio Territorio

Dal 6 ottobre 2026, la **0.34.2** alimenta la memoria anche dalle acquisizioni quotidiane delle sezioni precedenti, a V2 chiuso, conservando inventario e prove d'import. Il recupero delle due run di via Palmiro Togliatti e le regole dei conteggi sono documentati in [PROPERTY-WORKER-ACQUISITION-RECOVERY.md](PROPERTY-WORKER-ACQUISITION-RECOVERY.md).

Il nuovo flusso parte dalla via e mantiene insieme acquisizione, confronto e applicazione agli immobili selezionati. La stessa applicazione riconosce tramite catasto le schede presenti e crea quelle mancanti soltanto dopo una ricerca completa. Ora è consultabile anche nella sezione **Worker V2** della stessa applicazione desktop: Lavorazioni, Rifinitura e gli altri flussi restano disponibili durante il passaggio graduale. Archivio, autorizzazioni e Chrome V2 rimangono distinti da quelli quotidiani.

## Stato al 5 ottobre 2026

Worker V2 viene distribuito nella versione desktop **0.34.0**, come sezione affiancata ai flussi precedenti. La memoria reale è su Supabase online: 2.043 vie, 1.161 geometrie, 928 immobili e 180 casi storici da verificare sono stati trasferiti e recuperati da un profilo vuoto. La migrazione `0013_territory_lab_sync.sql` aggiunge soltanto workspace e audit separati, con letture riservate al proprietario e salvataggi a revisione atomica.

Il collaudo reale dei portali non è ancora stato eseguito. Le liste di prova restano vuote: nessuna scrittura Tecnocloud viene autorizzata dall'aggiornamento, dalla sincronizzazione o dall'apertura della mappa. Restano da risolvere le 147 associazioni storiche e le geometrie necessarie al lavoro, usando le schede già disponibili.

## Memoria online nell'app distribuita

La sezione Worker V2 usa il progetto Supabase già configurato nelle preferenze cifrate del desktop. Il renderer non riceve credenziali. `online-config.json` conserva soltanto URL pubblico, proprietario e workspace; la chiave resta nelle preferenze protette di Windows. Le revisioni online usano `sync-state-online.json`, distinto dal registro locale del laboratorio.

Al primo collegamento un profilo vuoto recupera l'archivio online; uno con lavoro già presente lo carica soltanto se la revisione consente di farlo. Note, correzioni e associazioni vengono sincronizzate automaticamente, così come le lavorazioni concluse o messe in pausa. La chiusura attende il checkpoint e tenta un ultimo salvataggio. Durante una run i checkpoint restano locali; il trasferimento avviene quando il motore torna inattivo.

**Archivio sincronizzato / Sincronizzazione da verificare** mostra l'ultimo salvataggio e permette di caricare o recuperare esplicitamente. Senza rete il lavoro locale resta conservato e la mancata sincronizzazione è visibile; il sistema riprova dopo 30 secondi e si può anche usare il pulsante o riaprire V2. Un conflitto non sovrascrive né la correzione locale né quella remota. Il recupero conserva una copia precedente del ledger. Non vengono sincronizzate credenziali, sessioni Chrome, percorso Excel o autorizzazioni alle schede di prova.

Il trasferimento iniziale di manutenzione si esegue, a worker chiuso e schema già aggiornato, con `npm.cmd --prefix worker run territory:setup-online -- --apply`. Usa esclusivamente `.env.local` ignorato, salva una copia precedente e rilegge lo stato remoto prima di confermare. Non tocca le tabelle del worker precedente.

## Avvio locale

Per provare l'app completa con la nuova sezione, chiudere il worker desktop e l'eventuale laboratorio Territorio, poi aprire `worker\Avvia Worker con V2.cmd` e selezionare **Worker V2** nella navigazione. In alternativa: `npm.cmd --prefix worker run desktop:dev`. È l'app completa avviata dal sorgente locale; l'installazione e il canale aggiornamenti non cambiano.

Worker V2 riusa `%APPDATA%\ListingRadarTerritoryLab-live`, inclusi i 928 immobili recuperati e le associazioni confermate. Il profilo è protetto da un lock: non può essere aperto contemporaneamente dal laboratorio separato. Su un computer nuovo la configurazione viene creata con scritture disabilitate. Il file Excel configurato nel worker viene adottato soltanto se manca un percorso esplicito nella configurazione V2.

La mappa vive in un renderer isolato all'interno della stessa finestra: non riceve i comandi o le credenziali della shell quotidiana. Cambiare sezione conserva anche una scheda con modifiche aperte. Tema e dimensioni seguono l'app; la chiusura mette in pausa una run V2 e attende il checkpoint. Durante una run V2 non può partire un secondo motore; **Arresta processo** mette in pausa soltanto V2, conservando i checkpoint quotidiani precedenti. L'installazione di un aggiornamento è bloccata finché la run V2 è attiva.

Per il collaudo reale premere **Apri Chrome V2**, accedere manualmente a SISTER e Tecnocloud nel browser dedicato, aprire una via e acquisire o confrontare i dati. In **Strumenti → Schede autorizzate** scegliere gli immobili concordati e confermare le autorizzazioni; solo successivamente applicare il piano sugli immobili selezionati. Il Chrome quotidiano sulla 9222 resta escluso. La nuova sezione è in collaudo: non vengono eliminate funzioni precedenti o eseguite scritture sul gestionale all'apertura.

Il laboratorio separato continua a essere disponibile per le prove simulate:

Da `C:\Users\ruggi\listing-radar`:

```powershell
npm.cmd --prefix worker run territory:dev
```

In alternativa aprire `worker\Avvia Territorio Prova.cmd`. Non serve un installer. Il comando compila il laboratorio e prepara cartografia e inventario; al primo avvio scarica il CSV pubblico del Comune. Le esecuzioni successive riusano la copia locale validata.

La modalità iniziale simula gli immobili e il gestionale, usando il motore Import V2 effettivo. Ogni via acquisita mostra sei casi: due schede da creare, una da aggiornare, un duplicato, un intestatario incompleto e una ricerca non conclusa. La dicitura «simulazione» resta visibile. Questi casi verificano il flusso e non dimostrano il funzionamento sui portali reali.

## Uso

All'apertura la mappa occupa lo spazio disponibile, senza sidebar di dettaglio. Il pulsante **Rete** apre il riepilogo del setup in una modale. Ogni voce ha già una scheda privata con data di registrazione, anche con zero immobili e zero operazioni. I filtri distinguono inventario ufficiale, tracciati della rete propria e vie ancora da lavorare; la mappa segue gli stessi filtri. Non occorre acquisire una via per aprirla, annotarla o segnalarla.

1. Passare su una via per evidenziare soltanto il tracciato. Dalla 0.34.5 l'hover non apre popup e non cambia la via del riepilogo già selezionato.
2. Cliccare il tracciato per aprire il riepilogo con stato, import e immobili conservati. Il riepilogo permette di segnarla «da verificare» e resta aperto quando il cursore si sposta; un nuovo clic su un'altra via lo aggiorna. **Apri scheda** apre la modale con Dossier, Immobili e Storico. Una voce dell'elenco apre direttamente la stessa modale. **Chiudi**, Escape o il clic fuori riportano alla mappa; con modifiche aperte occorre prima salvare o annullare. **Aggiorna scheda** aggiorna la vista senza scartare i moduli modificati. Le viste sotto Strumenti (Rete delle vie, Schede autorizzate e Storico da associare) usano la stessa finestra, lasciando libera la mappa quando viene chiusa.
3. Acquisire la via. Le letture vengono conservate durante il lavoro, con checkpoint per la ripresa.
4. Confrontare con il gestionale. I duplicati e le ricerche incomplete richiedono verifica; non autorizzano nuove schede.
5. Nella scheda Immobili selezionare i casi pronti e applicare il piano. La presenza viene ricontrollata immediatamente prima della scrittura.

Annotazioni e correzioni sono esplicite e persistenti. Le correzioni si sovrappongono ai dati originali senza eliminarli e restano anche dopo una nuova acquisizione. Dopo una correzione occorre un nuovo confronto. Un import parziale deve essere ripreso prima di modificarne il piano o riacquisire la via. Una seconda applicazione di un import concluso crea un nuovo checkpoint, ricontrolla il gestionale e può aggiornare una scheda modificata nel frattempo.

Durante un confronto l'inventario CRM della via viene letto una sola volta; la ricerca catastale rimane distinta per ciascun immobile. Una lettura fallita resta incompleta per tutta quell'operazione. La cache viene eliminata alla fine, anche in caso di errore o pausa. Ogni applicazione rilegge sia via sia catasto prima di scrivere; nessuna lettura di un confronto precedente autorizza il salvataggio.

### Colori e percentuale di import

Dal **0.34.3** ogni via rappresenta la ripartizione dei suoi immobili per età dell'ultimo import verificato: verde fino a 30 giorni inclusi, giallo da 31 a 90 inclusi, rosso oltre 90, grigio per immobili mai importati o import verificati senza data. Questi ultimi restano distinti nel riepilogo. Le prove possono appartenere a run precedenti: una nuova acquisizione non le azzera nel gradiente. Il denominatore è l'inventario distinto dell'ultima acquisizione completa; immobili assenti da quell'inventario non ne alterano le quote. Con 70 abitazioni e 30 box, 33 import di ieri, 17 di quattro mesi fa e 50 mai importati, la via mostra 33% verde, 17% rosso e 50% grigio.

Il gradiente segue la lunghezza complessiva del tracciato, anche curvo o composto da più parti, con transizioni brevi fra le quote. Non indica la posizione fisica delle case importate. Zoom e ritaglio della mappa non ridistribuiscono i colori. I tracciati sono sempre visibili con spessore **4 px e opacità 90%**; soltanto l'hover aumenta lo spessore a **8 px e opacità 100%**. L'area sensibile resta più ampia della linea. Uscendo dalla via il tratto torna normale subito, anche con riepilogo fissato da un clic; passando a un'altra via cambia soltanto l'evidenziazione, senza sostituire il popup aperto al clic. Zoom, trascinamento e uscita dalla finestra ripuliscono l'hover. I giorni sono intervalli completi di 24 ore; la vista si aggiorna anche al ritorno nella finestra e ogni minuto quando visibile.

La percentuale principale è il numero di immobili distinti già importati, anche in run precedenti, diviso per gli immobili distinti dell'ultimo inventario completo. Tre import su dieci immobili danno 30%, anche se il piano selezionava solo quei tre. Un nuovo import dello stesso immobile ne aggiorna la fascia temporale senza contarlo due volte. Solo un import concluso con riferimento CRM costituisce una prova; tentativi, confronti, date mutabili dell'unità e schede semplicemente trovate nel gestionale non incrementano il numeratore.

Il riepilogo distingue il conteggio «In questa acquisizione», che continua a usare solo le prove della run corrente. Un confronto, una correzione o la riapertura non cancellano le prove. Se la lettura più recente è parziale, non si torna alla run vecchia: si mostra il numero letto e il totale da verificare, senza percentuale o gradiente definitivo. Anche lo storico con righe della stessa via ancora da associare rimane prudenziale. Una prova senza data può contribuire al conteggio ma rimane grigia. Colore e percentuale descrivono gli import effettuati, non certificano che dati successivamente modificati siano allineati.

Le nuove acquisizioni avviate dalla mappa includono categorie A e C. La ripresa conserva i filtri originari. Il totale usa la tabella SISTER precedente ai filtri e comprende anche le unità dell'inventario che non hanno ancora una lettura completa dei proprietari. Indirizzi o identità ambigui impediscono un totale definitivo.

Percentuale e rapporto sono visibili nell'elenco, nel riepilogo e nella modale; aumentando lo zoom ad almeno 16 compaiono anche le etichette percentuali sui tracciati. Lo storico viene aggiornato dalle prove del file locale già esportato, senza ripetere import o riletture dei portali. Le prove restano nell'archivio sincronizzato e sono distinte per acquisizione; i totali di un job che comprende più vie non vengono applicati indistintamente a ciascuna via.

Pausa e chiusura attendono il punto sicuro. Alla riapertura un'operazione interrotta diventa «da riprendere». Gli immobili letti restano disponibili; una lettura fallita non elimina schede conservate e non prova assenze.

## Isolamento

- Entry Electron distinto: `worker/src/territory/main.ts`.
- Archivio locale: `%APPDATA%\ListingRadarTerritoryLab\territory-ledger.json`.
- Profilo reale: `%APPDATA%\ListingRadarTerritoryLab-live\territory-ledger.json`.
- Nessuna lettura della configurazione cifrata, dei checkpoint o delle sessioni del worker quotidiano.
- Nessun aggiornamento automatico, release GitHub o push dei sorgenti.
- Recupero dello storico solo con comando esplicito e richieste GET/HEAD alla fonte. Non riprende i checkpoint del worker quotidiano.
- Sincronizzazione facoltativa su nuove tabelle di Supabase locale; gli URL remoti sono rifiutati.
- Nessuna modifica alle code `owner_network` o alle tabelle legacy `listings`.

L'archivio, le esportazioni storiche e le copie di sincronizzazione contengono dati personali: vanno conservati sul computer dell'utente e inclusi nei suoi backup protetti. Non vanno committati. Il database condiviso del laboratorio è locale, non il Supabase di produzione.

## Storico recuperato

Aprire `worker\Avvia Territorio Storico.cmd` per consultare lo storico nel profilo reale separato. Non serve Chrome per leggere dossier, note e storico; serve per acquisire o confrontare con i portali. Le liste di scrittura restano vuote finché non vengono concordate le schede di prova.

Il recupero effettuato il 4 ottobre 2026 comprende 15 lavorazioni, 936 osservazioni e 928 immobili distinti associati a 69 vie. Sono conservate 542 prove di import precedente, comprese quelle delle righe ancora da associare. Non certificano la situazione attuale del gestionale: ogni immobile richiede un confronto nuovo. Restano 147 righe da associare a un Codvia e 33 righe escluse dalla raccolta originale, conservate come evidenza.

Il pulsante **Storico** apre le associazioni da decidere. Scegliere una voce completa dell'inventario, compreso il Codvia: gli omonimi non vengono uniti automaticamente. La scelta manuale viene registrata e mantenuta anche nei recuperi successivi. Le righe originariamente escluse non diventano automaticamente immobili pronti da importare.

Per aggiornare l'esportazione, a laboratorio chiuso:

```powershell
npm.cmd --prefix worker run territory:history -- --read-source --apply
```

Il comando legge la fonte configurata in `.env.local` e `worker/.env`, salva `history-snapshot.json` nel profilo di prova e aggiorna solo il suo `territory-ledger.json`. Nessuna scrittura sulla fonte. Le lavorazioni in corso o cambiate durante la lettura vengono saltate. Un'esportazione già salvata si può applicare con `--file <percorso> --apply`; le osservazioni identiche non vengono duplicate. Un import parziale nel laboratorio impedisce l'adozione finché non viene risolto.

## Memoria condivisa locale

La migration `supabase/migrations/0013_territory_lab_sync.sql` crea workspace separati, con lettura limitata al proprietario, scritture tramite RPC e controllo atomico della revisione. È stata applicata e verificata sul Supabase locale, senza cambiare tabelle del worker stabile.

Con Docker e Supabase locale attivi, configurare il profilo a laboratorio chiuso:

```powershell
npm.cmd --prefix worker run territory:setup-sync
```

Il comando legge lo stato del progetto Supabase locale e salva la configurazione privata nel profilo. Non stampa le chiavi e non usa le credenziali del progetto remoto. Per la simulazione aggiungere `-- --simulation`.

Il pulsante **Sincronizzazione** permette di caricare o recuperare l'archivio. Le modifiche locali e i conflitti tra revisioni bloccano la sostituzione automatica. Prima di un recupero viene conservata una copia dell'archivio precedente. Le operazioni recuperate in corso diventano da riprendere. Se la risposta di un salvataggio va persa, un nuovo caricamento riconosce i dati già salvati senza duplicarli. Un lock del profilo impedisce scrittori concorrenti sullo stesso archivio.

In alternativa, a laboratorio chiuso:

```powershell
npm.cmd --prefix worker run territory:sync -- --push
npm.cmd --prefix worker run territory:sync -- --pull
```

Lo storico di 928 immobili e il setup di 2.043 dossier sono stati caricati nel workspace locale del profilo reale. La revisione 3 conserva anche le prove per acquisizione recuperate dall'esportazione locale. Prima del setup e dell'aggiornamento delle prove sono state conservate copie dell'archivio. La sincronizzazione non è ancora abilitata verso DEV/STAGING o produzione; la promozione richiederà l'assegnazione degli utenti e dei workspace nell'ambiente concordato.

## Copertura cartografica

Il setup comprende **2.043 schede**: 1.118 Codvia distinti (29 da verificare) e 925 dossier della rete propria OpenStreetMap. Sono presenti **1.161 geometrie apribili e illuminabili** fin dal primo avvio: 236 già associate al Codvia e 925 tracciati aggiuntivi, con 276 nomi e 649 tratti senza nome. Questi ultimi includono accessi e strade di servizio: non corrispondono a 649 nuove vie ufficiali. Nessun immobile o precedente import è necessario per creare le schede.

La rete pubblica è conservata in `data/street-registry/territory-network.json`, con provenienza, data, query sull'area amministrativa di Bitonto e licenza ODbL 1.0. Sono esclusi gli identificativi OSM già documentati nel crosswalk; i tratti omonimi vengono uniti soltanto quando condividono nodi o vertici. Nomi uguali e tracciati disconnessi restano distinti. La compilazione usa questa copia locale senza interrogare Overpass.

Aprendo un dossier della rete propria, **Conferma associazione** permette di collegarlo esplicitamente a un Codvia completo dopo aver controllato la corrispondenza geografica. La via ufficiale riceve il tracciato e mostra insieme immobili, operazioni e annotazioni precedenti. I dati originali non vengono spostati o eliminati; la mappa espone una sola scheda dopo il collegamento. L'associazione è registrata e la geometria confermata resta conservata anche se la fonte pubblica cambia. Non si sostituisce automaticamente un'associazione già confermata. Un tratto senza nome può essere annotato immediatamente, ma richiede il collegamento prima dell'acquisizione SISTER.

Le 882 voci ufficiali senza geometria, incluse le 853 attive, rimangono apribili dalla ricerca. La rete propria rende già operativi i tracciati disponibili senza dichiarare verificati collegamenti ancora da decidere. Non è una certificazione di copertura totale: per associare ogni Codvia occorre completare e validare il crosswalk descritto in `docs/STREET-REGISTRY.md`.

Per aggiornare esplicitamente la cartografia pubblica:

```powershell
npm.cmd --prefix worker run territory:setup-network
npm.cmd --prefix worker run territory:compile
```

Il comando interroga Overpass in sola lettura. Risposte fallite, incomplete o troppo piccole vengono rifiutate; nessuna via conservata viene ritirata automaticamente. La rete conserva identificativi basati sui tracciati OSM: se una modifica pubblica divide o unisce componenti, le schede precedenti restano nell'archivio e richiedono una revisione esplicita.

Nella verifica del 4 ottobre sono state consultate anche le fonti [ANNCSU](https://anncsu.gov.it/it/consultazione-dellarchivio/open-data/Accedi-ai-servizi-di-dowload-massivo-in-Open-data/) e [SIT indicato dal Comune](https://comune.bitonto.ba.it/it/page/sit-sue-e-prg). I download regionali ANNCSU hanno risposto HTTP 403 e la mappa SIT HTTP 502: da queste richieste non è stato ottenuto un nuovo crosswalk verificabile. Non sono state aggiunte geometrie stimate o aggirati gli accessi.

## Collaudo sulle schede reali concordate

L'utente ha scelto schede di prova nel gestionale reale. Prima delle scritture occorre concordare identità catastali, codici fiscali degli intestatari e possibilità di creare nuove schede. La configurazione nasce con tutte le scritture disabilitate:

```powershell
npm.cmd --prefix worker run territory:setup-live
```

Il file creato è `%APPDATA%\ListingRadarTerritoryLab-live\live-config.json`:

```json
{
  "cdpUrl": "http://127.0.0.1:9223",
  "sisterTabMatch": "sister",
  "crmTabMatch": "tecnocasa-group.my.site.com",
  "allowedCadastralKeys": [],
  "allowedTaxCodes": [],
  "allowCreate": false
}
```

La chiave di un immobile ha formato `BITONTO|sezione|foglio|particella|subalterno`, con sezione vuota quando assente: per esempio `BITONTO||49|1243|34`. Il confronto non distingue mai un immobile solo dal nome della via o dell'intestatario. Sono scrivibili soltanto le identità autorizzate con tutti gli intestatari autorizzati. La creazione richiede anche `allowCreate: true`. Nessuna credenziale va inserita nel file.

La configurazione può essere aggiornata direttamente dal pulsante **Strumenti → Schede autorizzate** in `Avvia Territorio Storico.cmd`:

1. Cercare l'immobile per indirizzo, catasto o intestatario e controllare i dati. Le schede incomplete e simulate non sono autorizzabili.
2. Selezionare una o due schede per il primo collaudo (massimo dieci). Aprire gli intestatari per verificare quali anagrafiche verranno coinvolte.
3. Decidere se consentire anche nuove creazioni e confermare l'autorizzazione sulle schede selezionate.
4. Salvare la scelta. Questo salva solo `live-config.json` nel profilo di prova e non scrive nel gestionale. Le modifiche non salvate resistono all'aggiornamento della vista; «Annulla modifiche» ripristina la scelta salvata.
5. Per revocare tutte le autorizzazioni usare **Disabilita scritture**.

La lista dei CF viene ricavata dagli intestatari attuali delle schede scelte, senza ampliare automaticamente le autorizzazioni quando una successiva acquisizione o correzione cambia proprietario. Una creazione o un aggiornamento richiede comunque il confronto fresco e la conferma del piano. La configurazione di prova è locale al computer e non viene trasferita con la memoria Supabase.

Aprire un Chrome di prova con profilo proprio; il laboratorio rifiuta la porta quotidiana 9222:

```powershell
$territoryChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$territoryProfilePath = Join-Path $env:LOCALAPPDATA 'ListingRadarTerritoryChrome'
Start-Process -FilePath $territoryChromePath -WindowStyle Hidden -ArgumentList @('--remote-debugging-port=9223', ('--user-data-dir="' + $territoryProfilePath + '"'))
```

Accedere manualmente a SISTER e Tecnocloud nelle due schede del Chrome di prova. Poi avviare:

```powershell
npm.cmd --prefix worker run territory:live
```

Acquisizione e confronto sono separati dalle scritture. Per il primo collaudo conservare lo stato iniziale delle schede concordate, provare un aggiornamento e una creazione se autorizzata, ripetere per controllare l'assenza di duplicati e verificare i dati effettivamente salvati. Le attività sono disabilitate inizialmente; la 0.34.4 permette di scegliere una Telefonata da eseguire, da includere esplicitamente nel collaudo. Non usare le sessioni del worker quotidiano e non provarlo su schede scelte autonomamente.

## Verifiche automatiche

```powershell
npm.cmd --prefix worker run build
npm.cmd --prefix worker test -- tests/territory.test.ts tests/territory-progress.test.ts tests/territory-network.test.ts tests/territory-history.test.ts tests/territory-sync.test.ts tests/territory-live-settings.test.ts tests/import-v2-engine.test.ts
npm.cmd --prefix worker run test:ci
npm.cmd --prefix worker run territory:compile
npm.cmd --prefix worker run territory:visual-check
npm.cmd --prefix worker run territory:history-visual-check
```

Il collaudo Electron usa una directory temporanea distinta, il gestionale simulato e interazioni reali con mappa e dossier. Verifica il setup senza acquisizioni, note iniziali, associazione di un tracciato e conservazione alla riapertura, hover rapido fra vie diverse, ripristino delle linee sottili all'uscita e dopo selezione o chiusura della modale, flag, acquisizione, confronto, import, storico e layout a più larghezze. L'associazione cartografica scelta dal test è una fixture funzionale nella copia temporanea, non una corrispondenza approvata per l'archivio dell'utente. Le schermate e il risultato sono in `.runtime/territory-ui-check/`. Non esegue login, acquisizioni SISTER o scritture Tecnocloud.

Il collaudo dello storico richiede l'esportazione già adottata e Supabase locale configurato. Usa copie temporanee e un workspace di prova distinto; verifica il recupero dei 928 immobili, un'associazione manuale, il suo mantenimento nella memoria condivisa, la scelta e revoca delle autorizzazioni di prova e il layout. Non cambia il profilo reale dell'utente né il gestionale. Risultati in `.runtime/territory-history-ui-check/`. I permessi SQL sono verificabili con `supabase/tests/territory_lab_sync.sql`, che esegue tutte le proprie prove in una transazione con rollback.

La sezione V2 e la memoria online sono già distribuite. La sostituzione dei flussi quotidiani resta subordinata al collaudo reale e alla copertura delle vie necessarie al lavoro. Il laboratorio simulato rimane distinto.

## Opzioni operative della 0.34.4

Nel Dossier, **Filtri della prossima acquisizione** permette di scegliere categorie A oppure A/C, piano esatto/minimo/massimo e intervallo dei civici. I piani e i civici non riconoscibili sono esclusi quando il relativo filtro è attivo. Il denominatore della via resta l'inventario SISTER precedente ai filtri, inclusi gli immobili senza proprietari ancora letti.

In Immobili, **Opzioni del prossimo import** permette di creare o aggiornare secondo il confronto, oppure di aggiornare solo schede esistenti; di lavorare tutti gli intestatari oppure solo il principale; e di lasciare disabilitate le attività oppure creare una Telefonata **Da eseguire**. Il principale viene scelto dal motore secondo le quote; l'esclusione dei comproprietari conserva i collegamenti già presenti. Se sono selezionate schede da creare con la regola "solo esistenti", l'applicazione resta bloccata e spiega cosa deselezionare. Anche il controllo del gestionale immediatamente prima delle scritture deve trovare la scheda.

Le attività non dichiarano contatti già effettuati. Gli immobili provenienti dall'espansione della rete proprietari ne restano esclusi; se lo storico non permette di verificarne la provenienza, le attività restano escluse fino a una nuova lettura. Il recupero del file storico locale riporta questa evidenza senza alterare le prove d'import. Le modalità storiche che registrano contatti già eseguiti non sono ancora esposte in V2.

Le scelte si fissano all'avvio della run e compaiono nello Storico e nel riepilogo della ripresa. Anche le sorgenti d'import e la scelta delle attività vengono conservate per unità: un errore dopo il salvataggio e una riapertura riprendono lo stesso piano, senza duplicare l'attività. Le opzioni nel form riguardano la prossima run, non cambiano una ripresa. Le bozze restano durante refresh e cambi di tab; alla riapertura si riparte dalle scelte delle ultime run avviate. Non sono trasferite autorizzazioni o credenziali e non serve una nuova migration.

## Cosa resta prima della sostituzione del worker precedente

1. Eseguire il collaudo completo sulle schede reali concordate: acquisizione A/C, confronto, aggiornamento, creazione autorizzata, ripetizione senza duplicati, pausa e riavvio. Verificare nel gestionale catasto, intestatari, quote e recapiti effettivamente salvati. I test simulati non sostituiscono questa prova.
2. Collaudare sui portali reali i filtri e le regole disponibili nella 0.34.4, comprese le attività da eseguire. Decidere separatamente l'uso delle modalità storiche che registrano contatti già effettuati. Le autorizzazioni attuali restano limitate al collaudo, non a tutte le schede.
3. Risolvere le associazioni storiche e cartografiche delle vie su cui si vuole lavorare. Una scheda senza geometria è già apribile dalla ricerca; un tracciato senza Codvia richiede associazione esplicita prima della lettura SISTER. Non è necessario associare ogni tratto pubblico per iniziare il collaudo.
4. Definire la gestione delle run precedenti ancora aperte: l'adozione conserva dati e prove, ma non trasferisce il motore o i checkpoint di import quotidiani nel motore V2. Queste run vanno riprese dalla loro Cronologia; la mappa offre un nuovo confronto e un'applicazione distinta, con le sue autorizzazioni.
5. Dopo prove reali riuscite, ampliare consapevolmente il perimetro operativo e usare V2 su alcune vie prima di rimuovere Lavorazioni/Rifinitura. Confermare sincronizzazione e ripartenza con dati reali, mantenendo backup e revisioni.

`npm.cmd --prefix worker run worker-v2:visual-check` verifica l'integrazione usando il vero entry desktop, profili temporanei e servizi esterni esclusi. Controlla una sola finestra, isolamento dei renderer, ritorno alle sezioni precedenti senza perdere moduli, tema, geometria della vista, blocco del secondo motore, arresto sicuro, riapertura e storico copiato con 928 immobili e scritture disabilitate. Le schermate e il risultato sono in `.runtime/worker-v2-ui-check/`.

`npm.cmd --prefix worker run territory:online-visual-check` verifica la sincronizzazione automatica, una modifica senza rete, la ripresa al riavvio e il recupero da un secondo profilo vuoto. Usa un cloud fittizio su file e copie temporanee dei 928 immobili; tutti i portali sono esclusi. Risultati in `.runtime/territory-online-ui-check/`. `tests/integration/territory-migration.test.ts` verifica migrazione, RLS e revisioni su PostgreSQL incorporato, senza dipendere da Docker.

## Recupero degli indirizzi storici (0.34.6)

Il riconoscimento della via separa il civico esplicito SISTER anche con suffissi
numerici (`110/13`, `172/5`) e toglie i dettagli del lotto. Queste regole servono
solo all'associazione della memoria territoriale: l'identità CRM resta invariata.
All'apertura, dopo l'aggiornamento del catalogo, le righe storiche irrisolte vengono
recuperate solo quando il nome ufficiale è univoco. Restano conservati indirizzo,
date, prove di import e correzioni umane; omonimi, righe escluse e import parziali
non vengono risolti automaticamente. Un inventario incompleto resta incompleto.

Verifica del 6 ottobre 2026 su una copia isolata del profilo reale: 15 righe
riconosciute, 1.007 → 1.019 immobili, nessuna scrittura CRM. Restano 89 righe con
Codvia omonimi, 45 indirizzi da verificare e 40 righe escluse in origine. Il CSV
ufficiale scaricato per l'audit coincide con quello già in uso. Il collaudo reale
richiede ancora la scelta esplicita delle schede e l'accesso al Chrome V2.

## Interfaccia operativa V2 (0.34.1)

Ricerca delle vie etichettata, filtri richiudibili con reset, ordine A–Z/priorità/import meno recenti e caricamento incrementale. L’elenco è percorribile con le frecce; a schermo ridotto Chiudi o Escape riportano alla mappa.

Il Dossier mostra Acquisisci → Confronta → Controlla e applica e il prossimo passo derivato dagli esiti. Se esistono immobili pronti e altri incerti si procede al controllo dei primi; gli incerti restano esclusi. Durante il processo avanzamento e Pausa restano visibili dentro la modale.

In Immobili si cerca per indirizzo, catasto o intestatario e si filtra l’esito. Seleziona pronti opera sulle righe filtrate; Deseleziona svuota la scelta. Il riepilogo distingue nuove schede, aggiornamenti e selezionati fuori dai filtri. Le schede senza autorizzazione offrono Scegli per il collaudo: apre le autorizzazioni, senza abilitarle automaticamente.

Note e correzioni hanno Salva/Annulla e stato non salvato; nessun refresh le scarta. I dettagli aperti, il focus da tastiera e la posizione di lettura restano conservati negli aggiornamenti. L’analisi dei componenti e i criteri sono in [PROPERTY-WORKER-V2-DESIGN.md](PROPERTY-WORKER-V2-DESIGN.md).
