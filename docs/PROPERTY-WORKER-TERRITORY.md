# Property Worker: Worker V2 e laboratorio Territorio

## Versione 0.34.24: un archivio condiviso fra le postazioni

Diagnosi del 15 ottobre: il workspace online era ancora alla revisione **46, 9 ottobre 08:00 UTC**, mentre le postazioni continuavano a lavorare localmente. Il vecchio ciclo non riceveva aggiornamenti in assenza di azioni locali; dopo cambiamenti su entrambi i PC, il confronto della revisione fermava l'invio senza unire gli archivi. Durante una run non veniva inviato alcun checkpoint.

Il Worker V2 operativo usa ora uno scambio ogni 15 secondi anche senza azioni locali e un invio circa 1,5 secondi dopo le modifiche, senza rinviarlo indefinitamente se continuano ad arrivare avanzamenti. Le run non sospendono la sincronizzazione. Gli import ordinari continuano ad alimentare lo stesso archivio attraverso l'inbox durevole. La chiusura attende gli scambi e prova un ultimo invio; senza rete i dati restano su disco per il prossimo avvio. Non è possibile ricevere dati che non hanno ancora lasciato un PC spento o offline.

La migrazione **0027** aggiunge l'indice dei record `territory_workspace_records`, con revisione e tombstone, e gli RPC `read_territory_workspace_changes` / `save_territory_workspace_changes`. Lo snapshot `territory_lab_workspaces` resta la stessa fonte: un trigger indicizza anche i salvataggi delle versioni precedenti. Il vincolo di unicità impedisce due workspace reali dello stesso proprietario. RPC controllati per proprietario; nessun accesso anonimo o diretto ai record da authenticated. Un controllo invariato restituisce revisione e lista vuota, senza caricare l'intero JSON; il primo collegamento scarica l'archivio completo una sola volta. I cambiamenti vengono applicati in blocco per raccolta, con CAS e audit nella medesima transazione.

Ogni PC conserva atomicamente la baseline riconosciuta dal server, distinta dai checkpoint locali più recenti. Il confronto a tre vie unisce immobili, osservazioni, storico, gruppi di vie, query e coda. I successi mantengono ID/data e prove; le cancellazioni e i successi della stessa iscrizione non riaccodano vecchie copie offline. Un aggiornamento arrivato durante la rete viene riunito nella transazione seriale del ledger, senza sostituire il nuovo successo. Una risposta persa non ripete i fatti né incrementa inutilmente la revisione. Prima del recupero iniziale viene conservato `territory-ledger.json.before-shared-recovery.json`; nessuna cancellazione degli archivi utente.

Le modifiche concorrenti allo stesso dato manuale mantengono entrambe le proposte in `syncConflicts`. Il valore già condiviso resta attivo e il pulsante Memoria segnala **Modifiche da confrontare**. Da **Rivedi modifiche concorrenti** si sceglie quale mantenere; la scelta si propaga. Altri immobili e azioni continuano a sincronizzarsi. Timestamp tecnici ricostruiti e schede vuote create all'apertura non vengono trattati come correzioni dell'operatore. Una run conserva `deviceId`: solo la postazione proprietaria chiude un proprio lavoro interrotto al riavvio, non quella che lo riceve. Questo non introduce un servizio distribuito di esecuzione delle run né autorizza a scrivere contemporaneamente lo stesso immobile su due PC.

Verifiche: profili indipendenti con lavoro precedente, modifiche concorrenti, proprietà e import in corso, rimozioni, offline, risposta persa, conflitto CAS, riapertura e risoluzione delle note; integrazione degli stessi client con PostgreSQL PGlite e migrazione reale, controllo di ownership e rollback. Prova Electron con due postazioni aperte e ricezione senza azioni locali, senza servizi o scritture CRM reali. Unione a secco del profilo locale reale e della copia online: **1.350 immobili conservati**, nessun conflitto manuale artificiale. L'import Tatulli più recente dell'altro PC richiede che quel PC riceva l'aggiornamento e invii il proprio archivio; la prova locale non certifica il recupero di dati ancora presenti soltanto lì.

Applicata online la **0027 il 15 ottobre**: confronto del digest e della revisione prima/dopo, snapshot invariati; indice iniziale circa 5,4 MB. Il recupero tramite lo stesso client applicativo, su una copia del profilo reale, ha poi portato il workspace alla **revisione 47, 1.350 immobili**. Nessuna modifica al profilo originale, nessuna scrittura CRM, zero conflitti; secondo scambio senza nuove revisioni o modifiche pendenti. Controllo online invariato: `{"changes":[],"revision":47}`. Gate finale: **110 gruppi worker, 904 test**, 10 test PostgreSQL/migrazioni/compattazione, build e compilazione desktop; prove Electron di sincronizzazione e V2 integrato. Gli errori di rete compaiono anche come toast, senza fermare il lavoro locale.

## Versione 0.34.23: attività Killer e riscontri CRM

Il precedente controllo cercava la descrizione dell'attività nel testo di qualsiasi risposta XHR/fetch del CRM. Le opzioni dei menu («Non vende», «Ci abita», «Eseguito»), un'attività di un altro immobile o descrizione e stato di due record diversi potevano quindi far risultare l'attività già presente, saltandone la creazione.

Il controllo accetta ora record Task persistiti con ID, relazione `WhatId` all'immobile corrente, descrizione e stato dello stesso record. Legge i campi UI API e i valori serializzati Aura; conserva nel checkpoint l'ID attività quando disponibile. Le righe visibili vengono confrontate separatamente: non si uniscono descrizione e stato di due attività. Le risposte fallite o ancora in caricamento non provano l'assenza; un Task corrispondente privo di relazione/stato verificabile mantiene il caso da controllare, evitando una creazione alla cieca.

Il motore non completa un import che prevedeva l'attività se il port la restituisce disabilitata o segnala descrizione/stato non verificati. I dati immobile già salvati restano nel checkpoint. Le protezioni contro salvataggi ripetuti restano attive.

Killer conserva lo stato **Eseguito**, quindi le attività sono fra quelle concluse. La correzione non converte retroattivamente i piani già avviati con «Nessuna attività» e non cambia le esclusioni dei portafogli storici non verificati. Per una nuova scelta serve un nuovo lavoro dopo aver riconciliato quello precedente. I test riproducono il difetto su pagine simulate; il collaudo della run segnalata sull'altro PC richiede il relativo archivio aggiornato, assente nella memoria consultabile da questa macchina.

Copertura verificata: **109 gruppi, 893 test**, build TypeScript, compilazione desktop e controllo grafico. Il flusso completo è stato rieseguito separatamente (7 test) dopo aver completato il CRM simulato: salva descrizione, modalità e stato dai campi del modulo, li espone alla rilettura e ne verifica i valori. Le altre 108 suite passano; nessuna scrittura di collaudo sul CRM reale.

## Versione 0.34.22: recupero letture, quote e nomi SISTER

Le letture V2 che restano bloccate sui filtri o sul caricamento ricevono fino a **tre refresh**, oltre al tentativo iniziale. Una pagina non caricata non prova l'assenza di un immobile. Non vengono ricaricate finestre di modifica, merge o salvataggi incerti e non viene ripetuta alla cieca una scrittura. L'elenco completo immobili del nominativo viene chiuso prima del recupero perché è una finestra di sola lettura.

Il contatore **Immobili/Notizie/Incarichi** include anche NT e IN: una lista interamente caricata contenente solo queste voci è valida e non genera l'errore delle righe IM mancanti. Un elenco incompleto resta da recuperare. Le card annidate non fanno contare due volte «Attività e appuntamenti» o la related list. Nel merge i radio vengono risolti per nome anche dopo un riordino, selezionati tramite tastiera quando necessario e verificati stabili; fino a tre passaggi recuperano le scelte azzerate da Lightning prima dell'unica conferma di salvataggio.

Più righe di **proprietà** dello stesso CF vengono consolidate per immobile, sommando le frazioni esattamente prima della percentuale; restano conservate le righe e le quote originali. L'usufrutto e gli altri diritti non entrano nella somma. Identità senza CF, quote non interpretabili e somme superiori al 100% non vengono rese valide artificialmente. Il piano CRM gestisce anche le quote duplicate delle vecchie acquisizioni che conservano ancora le righe distinte, unendo i recapiti. Non ricostruisce quote già perse nei vecchi archivi.

In **Scheda via → Impostazioni della via → Come cercare questa via in SISTER** si salvano due testi:

- **Parte di parola**, inviato letteralmente nella ricerca SISTER con modalità parte di parola;
- **Voce esatta nell'elenco SISTER**, incluso VIA/PIAZZA, usata per scegliere solo i risultati coincidenti, escludendo traverse e nomi simili.

Il nome della scheda resta distinto. I campi vuoti usano il comportamento automatico precedente; svuotare e salvare ripristina quel comportamento. Ogni acquisizione congela entrambi i testi nel proprio checkpoint. Cambiare la scheda modifica solo le acquisizioni nuove. La memoria condivisa JSON conserva le scelte dopo riapertura, sincronizzazione e aggiornamento dell'inventario, senza migrazioni SQL. L'associazione del tracciato trasferisce la ricerca nella scheda ufficiale solo se questa non ha già una scelta dell'operatore. I conteggi dell'inventario riconoscono la dizione scelta nella run anche se successivamente modificata.

Verifiche: regressioni sulle quote, sulle impostazioni persistenti e sui checkpoint; fixture Chrome per tre refresh, related list solo NT/IN, card annidate e radio azzerati dal rerender; verifica Electron del modulo a 390/1024/1600 px e della conservazione dopo riapertura. Nessuna scrittura di collaudo sui dati reali Tecnocloud.

Esito locale del 15 ottobre: **107 gruppi, 876 test superati**, build TypeScript e desktop, controllo UI desktop e stati della scheda via superati. Installer `worker/release/Property Data Worker Setup 0.34.22.exe` verificato nei contenuti (versione, recupero, consolidamento quote, renderer e preload). Pubblicazione sul canale GitHub aggiornamenti autorizzata esplicitamente dall'utente il 15 ottobre, con commit e sorgenti pubblicati, installer ricostruito e verifica del manifest e degli asset.

## Versione 0.34.21: portafogli completi e recupero degli accantonamenti

Nelle impostazioni della via, **Acquisisci tutte le proprietà degli intestatari** apre il portafoglio di ogni persona fisica incontrata, una volta per CF nella run. Legge tutti gli intestatari e le quote di ciascun immobile e conserva i dati in V2, senza avviare Tecnocloud e senza espandere ricorsivamente altri portafogli. Categorie A/C e Comune di Bitonto restano il perimetro; il filtro categorie vale anche per i portafogli, mentre piani e civici valgono soltanto per la via iniziale. L'associazione delle proprietà esterne richiede un nome ufficiale univoco; quelle non associabili restano in memoria e nelle query, senza inventare una posizione o autorizzare un import senza via.

**Riusa gli immobili completi già in memoria** evita di riaprire gli intestatari quando catasto, indirizzo, categoria, classe, consistenza e rendita coincidono con l'inventario corrente. Il riuso richiede una lettura completa documentata e nessuna quarantena attiva; non attribuisce una nuova data di lettura agli intestatari, non cancella correzioni, import o storico. Disattivare l'opzione forza una nuova lettura nella nuova run. Attivare per la prima volta i portafogli su una via già acquisita apre comunque gli intestatari; gli immobili trovati più volte nella stessa run vengono deduplicati. Inventario e denominatore della via sorgente non includono gli immobili su altre vie. Lo storico distingue quelli trovati nei portafogli e quelli riutilizzati.

Gli errori dello screenshot di via Francesco Muciaccia sono gestiti per causa:

- recapiti oltre i campi CRM: i numeri restano tutti conservati, quelli eccedenti in un blocco delle note private; la rilettura verifica anche quel blocco e non interpreta altri numeri scritti liberamente nelle note;
- principale con ID cambiato dopo una fusione: viene riconosciuto tramite CF verificato. Se il principale privato verificato non compare fra gli intestatari SISTER, il V2 lo sostituisce con la quota maggiore (pari quota: ordine SISTER), secondo la scelta esplicita del 13 ottobre 2026. La precedente identità viene conservata dopo la verifica della scrittura nel checkpoint e nello storico; i flussi legacy non attivano questa politica;
- ricerca CF ambigua e filtri non disponibili: recupero di lettura con refresh limitato, senza ricaricare modali di scrittura; riconoscimento di comandi filtri anche localizzati. Un'assenza non verificata non consente duplicati;
- luogo di nascita: un campo vuoto non legge più il valore di un vicino. Dopo il salvataggio il worker attende i campi anagrafici forniti; confronto del Comune limitato a differenze di accenti, apostrofi e provincia tra parentesi. Nomi realmente diversi restano un errore, con valore SISTER e Cloud mostrati nel motivo.

Verifiche: fixture SISTER con lettura di tutti gli intestatari, appartenenza a due vie, denominatore, riuso, rilettura e riapertura; fixture Chrome per recapiti, note, principale e recupero; suite worker e controllo Electron di opzioni, pausa/ripresa e layout. Nessuna scrittura automatica di collaudo sulle schede reali già accantonate dell'altro PC.

## Versione 0.34.20: import solo CRM, immobile corrente e modalità attività

La coda e il confronto V2 usano `connectToCrmChrome`, senza cercare o richiedere la scheda SISTER. L'acquisizione mantiene il proprio collegamento. Una riconnessione libera soltanto i collegamenti CDP e mantiene la memoria degli ID e delle attività inviate. I messaggi dell'attesa import indicano Tecnocloud.

La ricerca catastale V2 riconosce anche i link visibili delle righe, senza dipendere dalle dimensioni dei checkbox Lightning. Può aprire e verificare le schede già visibili anche con richieste di background pendenti. Se le righe non corrispondono al catasto e una richiesta resta aperta, il risultato non prova un'assenza e non autorizza una creazione. Un risultato vuoto continua a richiedere ricerca conclusa e assenza di spinner. Le procedure legacy mantengono l'attesa delle richieste. Il flag Importato da visura viene letto dal valore del campo/checkbox, quando disponibile, e non dalla semplice presenza della sua etichetta. La selezione preferisce la visura, altrimenti la prima scheda con lo stesso catasto; una sezione non specificata in SISTER è accettata soltanto se i duplicati dimostrano tutti la stessa sezione Cloud.

Il riquadro **Sto importando…** mostra la sorgente congelata del singolo immobile: indirizzo, civico e piano, catasto, categoria, classe, consistenza, rendita, acquisizione, intestatari e recapiti, note e attività prevista. La fase aggiorna confronto, anagrafiche, salvataggio, collegamenti, verifica e attività. Gli stati transitori non diventano nuovi salvataggi del ledger; i cambi di fase riusano il riepilogo della mappa quando la revisione non cambia.

Le opzioni includono **Nessuna attività**, **Telefonata da eseguire**, **Contatto diretto automatico** e **Killer**, con le stesse definizioni del worker precedente. Il contatto diretto automatico usa Telefonata/Da eseguire se i recapiti acquisiti sono presenti; senza recapiti usa Contatto diretto/Eseguito. Killer usa sempre Eseguito: con recapiti ruota gli esiti telefonici, senza usa gli esiti di contatto diretto. Recapiti e intestatari inclusi determinano il piano, mentre ordine, descrizione e modalità vengono congelati prima dell'avvio e conservati nel recupero del checkpoint. Gli immobili di rete e lo storico senza provenienza verificata restano esclusi dalle attività.

La coda conserva indirizzo e motivo di ogni accantonamento anche nei **Lavori precedenti → Esiti da controllare**. I dati validi accantonati prima di qualsiasi scrittura possono essere confrontati di nuovo senza correzioni fittizie; gli originali restano conservati fino al successo. Anomalie SISTER, dati invalidi e piani con scritture possibili conservano le proprie protezioni. Nessuna migrazione SQL e nessun replay automatico dei salvataggi.

Verifiche su Chrome fixture: due copie dello stesso immobile, link con checkbox nascosti, telemetria pendente, flag visura vero/falso e righe vecchie che non provano un'assenza. Verifiche backend: connessione CRM senza SISTER, quattro modalità e recapiti, rotazione/freeze/ripresa, sorgente corrente e fasi, retry dei confronti senza modificare dati validi. Il caso live di Modugno 7 richiede lo storico dell'altro PC: la copia online disponibile durante la diagnosi era ferma al 9 ottobre e non conteneva quella run; non si attribuisce una causa senza il suo checkpoint.

## Versione 0.34.19: duplicati catastali e continuità della coda

Quando più schede Cloud condividono sezione, foglio, particella (anche Denom Particella) e subalterno, il V2 sceglie quella **importata da visura**, altrimenti il primo risultato. Rendita e indirizzo possono essere aggiornati; non distinguono due copie dello stesso catasto. La scelta e gli ID alternativi rimangono nello storico dell'immobile. Un indirizzo comune, un sub diverso o una sezione non confermata non autorizzano questa scelta. Il sub vuoto non diventa un jolly. La procedura legacy conserva la scelta rigorosa precedente.

Gli errori del singolo immobile, inclusa una ricerca rimasta non confermata dopo il recupero, finiscono in quarantena e in `run.skipped`: il cursore avanza e il batch gestisce gli immobili successivi. Una ricerca fallita non autorizza mai una creazione. Se potrebbe esserci stata una scrittura, il checkpoint attivo conserva il piano e le opzioni originali; la coda ne impedisce la modifica e recupera quel solo immobile al prossimo avvio. Si eliminano dalla coda soltanto i successi verificati. Il riepilogo distingue successi, accantonati e interruzione esplicita.

Chrome chiuso o sessione scaduta mantengono la run **in corso, in attesa di recupero**, senza data di fine o avanzamento. Ogni cinque secondi si tenta una nuova connessione al Chrome di lavoro, senza chiudere il browser reale; dopo l'accesso la stessa run prosegue. L'interruzione dell'operatore resta disponibile. Le scritture locali dal risultato incerto vengono accantonate, senza ritentare alla cieca: non sono trattate come un semplice guasto della connessione. I port V2 condividono la memoria delle attività inviate durante l'operazione, anche dopo la riconnessione, per non ripeterle se non sono ancora verificabili. I risultati non confermati di una ricerca possono ricevere i due refresh delle letture; i salvataggi non ricevono tale automatismo.

Non è una garanzia contro spegnimenti o impossibilità di salvare sul disco: senza persistenza durevole non si prosegue con altre scritture CRM. La riapertura conserva le prove e i checkpoint, come prima. I campi `waiting`, `skipped` e gli ID alternativi sono facoltativi nel JSON esistente, senza migrazioni SQL o modifiche delle schede reali durante i test.

Verifiche: scelta della visura e del primo risultato; unità distinte protette; recupero di una ricerca e prosecuzione dopo una ricerca irrecuperabile; creazione incerta accantonata con gli immobili successivi conclusi; recupero del solo checkpoint senza duplicati; attesa/ripartenza nella stessa run per Chrome e login; interruzione esplicita; assenza di scritture successive quando il checkpoint non è persistibile. Le prove usano CRM simulato e pagine Chrome fixture, non schede reali.

## Versione 0.34.18: ricerca catastale, identità Cloud e recupero delle letture

Il V2 non apre più l’inventario di tutti gli immobili della via. La prima verifica usa **foglio, particella e subalterno**, inclusa l’alternativa Denom Particella dove disponibile. Un sub vuoto continua a essere una coordinata vuota, mai un jolly. Se una ricerca completa non trova corrispondenze, si prosegue nel normale flusso; prima di una creazione restano il controllo dei collegamenti degli intestatari e la verifica contro un salvataggio precedente incerto. Il worker precedente conserva il proprio flusso, compresa la ricerca per indirizzo quando prevista.

Il workspace conserva `cloudMemory.properties` per identità catastale e `cloudMemory.people` per codice fiscale. Ogni riscontro registra ID, stato, ultima verifica positiva e ultimo controllo. Gli ID positivi servono a **aprire direttamente la scheda e confermarne l’identità**, evitando la ricerca globale ripetuta. Gli intestatari dello stesso CF condividono una sola voce, anche su più vie e acquisizioni. Una nuova acquisizione cambia la sorgente, non perde l’identità Cloud già trovata.

Le date distinguono un riscontro positivo da un tentativo recente: una ripresa, un retry o un errore non trasformano un vecchio checkpoint in una verifica appena eseguita. Se una scheda nota non si legge, dopo i refresh si tenta la ricerca mirata. Se anche questa non conferma l’identità, resta **da riconfermare**, con ID e data precedenti, senza autorizzare una creazione; questa protezione sopravvive al riavvio. Un’identità positiva cambiata o un CF differente non autorizzano l’aggiornamento del vecchio ID. Più ID noti vengono riletti tutti, conservando l’ambiguità. Le ricerche vuote non diventano una scorciatoia persistente per le creazioni.

Le verifiche confluiscono nei commit già previsti dal confronto e dai checkpoint. Non si introduce un nuovo salvataggio dell’intero archivio per ogni lettura. Anche gli import ordinari alimentano i riscontri dai checkpoint completati; all’apertura si recuperano soltanto i fatti storici con data e identificativo documentati. Il campo è facoltativo nel JSON versione 1 e viene conservato dalla sincronizzazione esistente, senza nuove tabelle o migrazioni SQL. L’archivio originale non viene modificato durante i test.

Nelle card di via e coda, **Presenza in Tecnocloud** espone immobile e intestatari, ID e date dei riscontri. “Già presente” descrive l’esistenza della scheda, mentre “Import riuscito” resta una prova distinta della lavorazione del singolo immobile. Il campo Ultimo controllo compare quando differisce dalla verifica positiva, senza stampare due volte la stessa data.

Il recupero automatico è abilitato sul port del V2 per le sole letture: timeout o caricamento bloccato permettono massimo due `reload` con attesa del commit e ripetizione della ricerca/lettura. Prima e dopo si controllano sessione e interruzione; una modale aperta impedisce il refresh. Creazione, aggiornamento, merge, proprietà e attività non ricevono questo replay automatico. I loro checkpoint e le verifiche dopo scrittura rimangono obbligatori. `openProperty` aspetta il titolo visibile, evitando falsi timeout su una copia del titolo nascosta da Lightning.

Verifiche: recupero reale in Chrome su una pagina fixture ferma sul titolo immobile, seguito da una lettura corretta dopo il refresh; nessun refresh di un salvataggio, di modali o di sessioni scadute; ID/CF riusati tra acquisizioni; conservazione di ambiguità e assenze non cacheabili; protezione dopo restart; data non inventata da riprese/errori; collaudo Electron dei riscontri a 390/1024/1600 px. Le prove CRM usano fixture, non schede reali.

Copertura finale: **100 gruppi, 830 test**; i file browser più pesanti sono eseguiti separatamente. Sulla copia del profilo reale si recuperano 646 identità immobili Cloud dai fatti disponibili; i 1.350 immobili e i checkpoint restano conservati, e l’originale non viene modificato. Gli ID proprietari non documentati non vengono inventati.


## Versione 0.34.17: svuotamento della coda e prestazioni

**Coda immobili → Svuota coda** rimuove tutte le iscrizioni, comprese quelle nascoste dalla ricerca o bloccate per dati incompleti. La conferma mostra il totale; Annulla conserva la selezione. Immobili, correzioni permanenti, acquisizioni, date di import, storico e checkpoint incerti restano nell’archivio. Si può accodare di nuovo un immobile. Non è possibile svuotare durante un lavoro; il backend verifica atomicamente la revisione confermata e rifiuta una coda cambiata nel frattempo. Lo svuotamento resta conservato al riavvio e si sincronizza con l’archivio esistente, senza migrazioni SQL.

Le ottimizzazioni riguardano:

- Ricerca della via nella coda: elimina una ricerca annidata sul catalogo, preservando le associazioni ufficiali.
- Mappa: indicizza le appartenenze degli immobili una volta; riusa il riepilogo finché non cambiano la revisione salvata, il lavoro attivo o il minuto. Il rinnovo temporale aggiorna l’età degli import. Le risposte sono copie indipendenti, non riferimenti modificabili all’archivio.
- Sincronizzazione: l’impronta locale si ricalcola solo dopo un commit o un recupero. Il registro di sincronizzazione viene comunque riletto. Pull, push, conflitti e verifiche remote restano invariati.
- Interfaccia: aggiornamenti serializzati, notifiche accorpate, nessun ridisegno per dati invariati, nessun refresh della vista V2 nascosta. Tornando alla mappa si recupera lo stato corrente. La shell del worker precedente si aggiorna al cambio del flag occupato, anziché a ogni checkpoint V2. Selezionare in coda mantiene le card e i form montati; ricerca con debounce 180 ms. I formati delle date sono riusati nelle due interfacce.
- Persistenza: gli import ordinari consegnano fatti durevoli al V2; l’adozione li applica in blocchi di massimo 50 con un commit atomico. I file originali vengono rimossi soltanto dopo il commit; un’interruzione lascia fatti da rileggere senza duplicare lo storico. Nell’import V2 il completamento salva prova e audit insieme, e la transazione dell’esito conserva anche il cursore. Restano tutti i checkpoint intermedi e le riletture CRM.

Misure locali sull’identica copia del profilo reale (1.350 immobili, 2.043 vie, archivio 5,88 MB), con tre letture per operazione:

| Operazione | Prima | Dopo |
| --- | --- | --- |
| Coda, lettura backend | 1.129–1.323 ms | 34–38 ms |
| Riepilogo mappa, prima lettura | 733–786 ms | circa 110 ms |
| Riepilogo mappa invariato | 733–786 ms | circa 14 ms |
| Stato sincronizzazione invariato | impronta ricalcolata a ogni refresh | circa 0,1–0,2 ms |
| Costruzione HTML di 100 card con date | circa 22 ms | circa 2–4 ms |

Sono misure di elaborazione locale: non misurano tempi SISTER/Tecnocloud, rete o layout del browser. Lo script verifica anche che il riepilogo indicizzato coincida con quello originale e che i due modi di costruire le card producano lo stesso HTML.

Per ripetere il controllo, compilare Territorio e lanciare da root:

```powershell
npm.cmd --prefix worker run territory:compile
node worker/scripts/territory-performance-check.mjs "$env:APPDATA/ListingRadarTerritoryLab-live"
```

Lo script usa una copia temporanea, verifica l’integrità dell’originale e stampa soltanto conteggi, dimensioni e durate. Non apre browser né contatta Supabase. Il collaudo Electron verifica conferma/annullamento, ricerca, conservazione delle correzioni, riavvio, vista nascosta e layout 390/1024/1600 px; le regressioni coprono anche coda cambiata, lavoro attivo, piani incerti e commit falliti. Nessuna prova scrive nel CRM reale.

La regressione finale comprende **98 gruppi e 815 test** (i due file CRM con molte istanze Chrome vengono eseguiti separatamente), oltre ai collaudi Electron. Una copia successiva del profilo reale verifica lo svuotamento di 51 iscrizioni, mantenendo tutti i 1.350 immobili, checkpoint, dati e storico; l’originale rimane invariato.


## Versione 0.34.16: un ciclo per immobile, un percorso guidato

Il flusso è **acquisisci da SISTER → scegli gli immobili → aggiungi alla coda → controlla il riepilogo → avvia import**. La scheda via propone selezione e accodamento; aggiornamento SISTER e consultazione facoltativa del CRM sono nelle impostazioni. Il confronto necessario avviene automaticamente dalla coda, prima di ogni scrittura. Nelle card si leggono indirizzo, civico/piano, catasto, ultimo import riuscito e intestatari; esiti tecnici e tentativi sono nei dettagli. Il filtro principale distingue mai importati, entro 30 giorni, da 31 a 90 e oltre 90.

Ogni lavoro dalla coda termina, anche dopo una richiesta di interruzione, un errore o la chiusura dell’app. `stopped` descrive la fine del lavoro, senza affermare che tutti gli import siano riusciti. Ogni successo verificato conserva immediatamente data, scheda CRM e storico individuale, prima dell’avanzamento del cursore; soltanto il suo elemento esce dalla coda. Non esiste un obbligo di completare la vecchia selezione. All’apertura e al recupero della memoria condivisa, le precedenti run apply sospese/in corso vengono chiuse nello storico, conservando dati, prove, piani e coda. Scansioni e confronti mantengono i propri checkpoint di lettura.

Una scrittura incerta è protetta sul singolo immobile: il checkpoint viene trovato per identità catastale anche dopo una nuova acquisizione. Al prossimo avvio della selezione dalla coda, quell’immobile conserva sorgente, via e opzioni originali, visibili nel riepilogo. Si rileggono comunque le corrispondenze CRM; ambiguità nuove impediscono scritture ripetute. Le sue correzioni sono bloccate finché il piano non viene verificato, ma può essere rimosso dalla coda senza cancellare il checkpoint. Gli immobili non ancora iniziati rimangono modificabili. Più checkpoint incerti o opzioni non recuperabili bloccano soltanto quel caso, con motivo esplicito. Non cambia il motore del worker precedente.

Verifiche locali: regressioni di successi prima del cursore, interruzioni, libertà della nuova selezione, date/filtri, recupero del piano e dell’attività incerta senza duplicati, anche dopo una nuova lettura SISTER; percorso Electron e layout 390/1024/1600 px. La migrazione su una copia del profilo reale conserva 1.350 immobili e 52 elementi in coda, chiudendo due lavori senza checkpoint; il file originale resta invariato. Le prove non scrivono nel CRM reale. Copertura finale: 97 gruppi, 809 test, con i due file che avviano molte istanze Chrome eseguiti separatamente; 145 regressioni Territorio ripetute dopo le modifiche definitive.

## Versione 0.34.15: coda unica degli import

La **0.34.15** introduce la **Coda immobili** come unico punto di avvio degli import Tecnocloud nel Worker V2. Dalle schede via e dalle query si filtrano e selezionano gli immobili da accodare, anche su più vie. La coda conserva la selezione alla riapertura, permette correzioni permanenti della memoria e rimozioni senza perdere dati o storico. Ogni import confronta il CRM prima di scrivere e rimuove dalla coda soltanto i successi verificati; anomalie e interruzioni restano conservate. Le riprese precedenti V2 vengono esposte nella coda con il piano originale. Le sezioni del worker precedente mantengono il proprio flusso.

Il pulsante **Coda** è sulla mappa, dopo Query immobili e Centra Bitonto; il contatore mostra le iscrizioni attuali. Le schede via conservano acquisizione SISTER e confronto in sola lettura, senza azioni o opzioni di import. **Filtra immobili** combina piani, categorie, intestatari per CF, import verificati, anzianità e intervallo dei civici con la ricerca e l’esito del confronto. Più valori nello stesso filtro si sommano; campi diversi si combinano. Piani e civici non rilevati non soddisfano un filtro esplicito. La selezione fuori dai filtri resta indicata e **Seleziona tutti** riguarda soltanto gli immobili filtrati non già accodati.

La coda contiene riferimenti all’immobile canonico, senza copie modificabili separate. **Correggi i dati conservati** aggiorna indirizzo, categoria, intestatari, quote e note nella memoria, conserva la lettura originale e richiede un nuovo confronto. Queste correzioni non scrivono subito nel CRM. Rimuovere dalla coda conserva la scheda e il suo ciclo di vita. Una seconda aggiunta dello stesso immobile non duplica né riordina l’iscrizione.

Le opzioni creazioni/aggiornamenti, intestatari e Telefonata sono nella coda. L’import può interessare più vie, con la via di origine verificata per ogni immobile. Una ripresa usa le sorgenti, opzioni e checkpoint originali: gli immobili ancora nel piano non sono correggibili o rimovibili fino alla conclusione. Gli immobili già verificati escono subito dalla coda; una successiva iscrizione non viene rimossa dalla ripresa di un vecchio import. Ricerche incomplete e salvataggi incerti conservano la ripresa; le anomalie scartate prima delle scritture rimangono accodate con motivo e possono essere corrette o rimosse.

La coda è nel JSON del workspace esistente e segue revisioni, sincronizzazione automatica e protezioni dai conflitti già presenti. Non richiede tabelle nuove o migration SQL. I checkpoint delle sezioni precedenti non vengono trasferiti: soltanto gli import del motore V2 vengono recuperati nella coda.

Verifica dell’interfaccia: `npm.cmd --prefix worker run territory:queue-check` (dopo `territory:compile`) usa un profilo temporaneo e CRM simulato. Controlla filtri combinati, aggiunta da via e query, persistenza al riavvio, correzioni permanenti, rimozione, import su più vie, mancata scrittura prima dell’avvio e layout desktop/mobile. Non acquisisce dai portali reali e non scrive in Tecnocloud.

Verifica della 0.34.15: 97 gruppi / 805 test coperti. Il file adattatori (50 test) è stato rieseguito separatamente dopo due timeout del browser, senza modificare verifiche o tempi limite; tutti i 50 passano. Build TypeScript, installer, corrispondenza dei renderer nel pacchetto, mappa, query, quarantena, coda, desktop integrato e layout mobile verificati. Pausa e riavvio della coda riprendono lo stesso import. Queste prove usano dati temporanei e gestionali simulati; non certificano il collaudo live dei portali.

## Versione 0.34.14: acquisizione SISTER distinta dagli import Cloud

La **0.34.14** distingue sulla mappa V2 gli immobili **acquisiti da SISTER ma mai importati in Cloud** con il blu. Le quote verde/giallo/rosso conservano gli import Cloud verificati anche in run precedenti; il grigio identifica le righe dell’inventario ancora prive di dati acquisiti e, separatamente nel riepilogo, gli import Cloud senza data. I dati acquisiti in quarantena restano blu. I tracciati con dati acquisiti o importati rimangono davanti alla rete grigia agli incroci. Barra, legenda e tracciati usano gli stessi conteggi, senza modificare gli archivi o avviare scritture CRM.

## Versione 0.34.13: quarantena e confronto durante l'import

Le letture SISTER concluse non diventano parziali per anomalie dei singoli immobili: le righe da controllare sono conservate nella **Quarantena** della via e in **Strumenti → Quarantena**, separate dall'elenco operativo e dalle query. I totali noti dell'inventario le includono; una riga con piano ma senza civico viene contata solo se il nome della via corrisponde esattamente. Interruzioni di sessione e inventari non attribuibili restano distinti da dati validi. Le vecchie false acquisizioni parziali vengono riparate solo con checkpoint completo e privo di errori.

**Applica selezionati** ora esegue confronto e import nello stesso avvio: selezionare gli immobili validi è sufficiente. Il confronto separato resta facoltativo e non scrive. Ambiguità prima delle scritture vanno in quarantena; salvataggi incerti e checkpoint avanzati mantengono la ripresa originale. Il subalterno può essere vuoto, senza inventare valori o scegliere altre unità della stessa particella. [Regole, correzioni e verifiche](PROPERTY-WORKER-QUARANTINE.md).

## Versione 0.34.11: prima acquisizione e accesso operativo

Una via **Mai acquisita** apre una modale compatta: nome, stato e un solo **Acquisisci via**. Non mostra percentuali, distribuzione, confronto, filtri degli immobili o tab senza dati. **Impostazioni della via** raccoglie filtri SISTER, note e associazione alla via ufficiale; un tracciato senza nome propone prima l'associazione. La prima acquisizione interrotta mostra **Riprendi acquisizione**. I primi immobili letti rendono disponibili elenco, storico e confronto. Un'acquisizione conclusa senza immobili resta distinta da una via mai acquisita.

**Acquisisci via** usa il Chrome di lavoro, con sessioni SISTER e Tecnocloud già aperte. Cerca il nome della via in SISTER e legge immobili e intestatari, includendo per default le categorie A e C. Filtri espliciti possono restringere la lettura. Dati e checkpoint vengono conservati durante l'operazione nella memoria V2. Questa azione non importa in Tecnocloud: il passaggio successivo è confronto, selezione degli immobili e applicazione confermata.

Nella sezione integrata **Worker V2** sono rimossi il banner del profilo di prova e la lista di identità autorizzate. Il desktop abilita la modalità operativa solo con il proprio collegamento Chrome; non si abilita tramite configurazione locale o renderer. Ogni immobile deve avere identità catastale e intestatari validi ed appartenere al Comune di Bitonto. Restano ricerca CRM attuale, blocco dei duplicati, regola creazioni/aggiornamenti o solo esistenti, checkpoint, rilettura delle scritture e conferma del piano. L'apertura della mappa non esegue scritture. Il **laboratorio separato** conserva profilo e liste di collaudo: le istruzioni su schede autorizzate nelle sezioni storiche riguardano quel laboratorio.

La verifica locale degli stati usa `npm.cmd --prefix worker run territory:stage-check`, con profilo temporaneo e dati simulati. Non costituisce un collaudo delle scritture reali.

La **0.34.10** elimina la sidebar delle vie: la ricerca è sopra la mappa, con risultati a tendina dopo 250 ms, selezione da mouse o tastiera e pulsante X. Selezionare una via ingrandisce il tracciato e apre il riepilogo; **Apri scheda** apre la modale. La ricerca lascia visibile l’intera rete. La scheda via usa icone coerenti per azioni, immobili, intestatari e storico; gli avvisi transitori sono toast chiudibili, con apertura di Chrome quando manca il browser. Le vie senza geometria restano accessibili, senza attribuire loro una posizione.

Dalla **0.34.9** gli immobili nella scheda via sono ordinati per civico (numero e lettera), piano e foglio/particella/subalterno; civici e piani mancanti seguono quelli noti. La posizione viene derivata dai dati conservati, senza cambiare le osservazioni SISTER. Intestatari e quote sono visibili senza accordion; dati immobile, acquisizioni, storico e correzioni hanno sezioni distinte. **Confronta gestionale** legge il CRM e prepara create/update/review: non scrive. **Confronto da eseguire** indica un piano mancante; **Confronto incompleto** una ricerca che non ha accertato la presenza, mai una prova di assenza. Query immobili combina checkbox ricercabili, conserva le selezioni durante la ricerca e richiede risultati aggiornati dopo un cambio di filtri. Salvataggio combinazioni, gruppi di vie e opzioni di applicazione restano disponibili come sezioni espandibili.

## Versione 0.34.8: immobili, scheda via e query

La scheda via si apre direttamente sugli immobili: due colonne sul desktop, una su schermi piccoli, un solo scroll nella modale. Dossier e segnalazione manuale «da verificare» non fanno più parte del flusso di acquisizione. Restano il riepilogo dell'acquisizione, le note, i filtri SISTER e gli errori reali delle operazioni. Le card e «Seleziona tutti» funzionano anche prima del confronto; applicare richiede invece un piano valido, le autorizzazioni di collaudo e il rispetto della regola creazioni/aggiornamenti o solo esistenti.

Ogni identità catastale ha un registro proprio: acquisizioni, confronti, correzioni, avvii e riprese, passaggi verificati, tentativi dopo errori, sospensioni e import conclusi. Il successo viene conservato insieme al checkpoint dell'immobile, prima dell'avanzamento della run. Un guasto sull'immobile successivo non lo annulla. Le prove duplicate non aumentano il numero degli import; una prova storica senza data non inventa una data recente. I dati originali restano nelle osservazioni, quelli importati e le correzioni negli eventi pertinenti.

Gli import ordinari del desktop alimentano questo registro attraverso `property-inbox/`, anche senza aprire la sezione V2. I fatti vengono eliminati dall'inbox solo dopo la persistenza locale. Le identità incomplete restano recuperabili in `property-unresolved/`, senza impedire il passaggio degli immobili validi. La copia online usa il workspace e la protezione delle revisioni esistenti. Non sono state aggiunte tabelle SQL. Lo storico antecedente alla versione contiene soltanto le prove recuperabili: non ricostruisce tentativi o comportamenti mai registrati.

Sulla mappa, **Query immobili** apre il gestore. **Gestisci zone di vie** crea e modifica gruppi di vie nominati, indipendenti dai poligoni di Territorio. Le combinazioni filtrano gli immobili già acquisiti per zone, vie, proprietari, località, categorie, piani, presenza di import verificati ed età dell'ultimo import. Più valori dello stesso campo si sommano; campi diversi si intersecano. Un piano o una data sconosciuti non soddisfano il relativo filtro. È possibile salvare e riaprire una combinazione, selezionare anche tutti i risultati non ancora visualizzati, confrontare e applicare una selezione di più vie. Le operazioni interrotte si riprendono conservando immobili, vie e opzioni iniziali.

L'indice corrente dei proprietari usa il codice fiscale come identità: una persona con più immobili compare una volta nei filtri. Le letture catastali originali restano conservate come prove, anche quando il nome varia. Questo indice non autorizza il bot a saltare le ricerche e le riletture attuali del CRM. La query lavora sull'archivio acquisito: una nuova acquisizione SISTER si avvia ancora dalla scheda della via.

Verifica locale: test di memoria individuale, replay, errori, query di più vie e ripresa; suite worker completa; collaudi Electron della scheda, selezione prima del confronto, zone/query salvate, layout e hover al solo clic. Le prove usano profili temporanei e CRM simulato. Il collaudo delle scritture reali resta vincolato alle schede catastali concordate.

Dal 6 ottobre 2026, la **0.34.2** alimenta la memoria anche dalle acquisizioni quotidiane delle sezioni precedenti, a V2 chiuso, conservando inventario e prove d'import. Il recupero delle due run di via Palmiro Togliatti e le regole dei conteggi sono documentati in [PROPERTY-WORKER-ACQUISITION-RECOVERY.md](PROPERTY-WORKER-ACQUISITION-RECOVERY.md).

Il nuovo flusso parte dalla via e mantiene insieme acquisizione, confronto e applicazione agli immobili selezionati. La stessa applicazione riconosce tramite catasto le schede presenti e crea quelle mancanti soltanto dopo una ricerca completa. È disponibile nella sezione **Worker V2** della stessa applicazione desktop: Lavorazioni, Rifinitura e gli altri flussi restano disponibili durante il passaggio graduale. L'archivio V2 rimane distinto; dalla **0.34.7** la sezione integrata riusa lo stesso Chrome di lavoro e dalla **0.34.11** usa le selezioni operative senza liste di prova.

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

Worker V2 riusa `%APPDATA%\ListingRadarTerritoryLab-live`, inclusi i 928 immobili recuperati e le associazioni confermate. Il profilo è protetto da un lock: non può essere aperto contemporaneamente dal laboratorio separato. Su un computer nuovo le liste di collaudo nascono vuote; dalla 0.34.11 queste liste riguardano soltanto il laboratorio separato, mentre il V2 integrato usa l'accesso operativo. Il file Excel configurato nel worker viene adottato soltanto se manca un percorso esplicito nella configurazione V2.

La mappa vive in un renderer isolato all'interno della stessa finestra: non riceve i comandi o le credenziali della shell quotidiana. Cambiare sezione conserva anche una scheda con modifiche aperte. Tema e dimensioni seguono l'app; la chiusura mette in pausa una run V2 e attende il checkpoint. Durante una run V2 non può partire un secondo motore; **Arresta processo** mette in pausa soltanto V2, conservando i checkpoint quotidiani precedenti. L'installazione di un aggiornamento è bloccata finché la run V2 è attiva.

Premere **Apri Chrome di lavoro**: dalla **0.34.7** richiama lo stesso avvio usato da Lavorazioni e Rifinitura, con profilo `C:\ChromeListingRadar` e porta CDP configurata nel desktop (normalmente 9222). Se il browser è già aperto viene riusato. Accedere manualmente a SISTER e Tecnocloud, aprire una via e acquisire o confrontare i dati. Dalla 0.34.11 il V2 integrato non richiede **Schede autorizzate**: selezionare immobili validi dopo il confronto e confermare il piano prima dell'applicazione. Le autorizzazioni di collaudo restano nel laboratorio separato. Non vengono eliminate funzioni precedenti o eseguite scritture sul gestionale all'apertura.

Durante una run V2 il controllo periodico che mantiene attiva la sessione SISTER del desktop viene sospeso, come già avviene nelle lavorazioni quotidiane. A fine operazione V2 rilascia il proprio collegamento CDP senza chiudere Chrome; l'operazione successiva cerca nuovamente le schede. Il vincolo di un motore alla volta vale per il singolo PC. Non costituisce un blocco globale fra computer: con account distinti le nuove lavorazioni hanno job distinti. La ripresa dello stesso job da Cronologia su due PC non è protetta da un lease distribuito e va evitata. Un blocco su vie/job diversi richiede errore, ora e fase della run per essere diagnosticato; i timeout dei filtri CRM da soli non dimostrano un conflitto fra postazioni.

Il laboratorio separato continua a essere disponibile per le prove simulate:

Da `C:\Users\ruggi\listing-radar`:

```powershell
npm.cmd --prefix worker run territory:dev
```

In alternativa aprire `worker\Avvia Territorio Prova.cmd`. Non serve un installer. Il comando compila il laboratorio e prepara cartografia e inventario; al primo avvio scarica il CSV pubblico del Comune. Le esecuzioni successive riusano la copia locale validata.

La modalità iniziale simula gli immobili e il gestionale, usando il motore Import V2 effettivo. Ogni via acquisita mostra sei casi: due schede da creare, una da aggiornare, un duplicato, un intestatario incompleto e una ricerca non conclusa. La dicitura «simulazione» resta visibile. Questi casi verificano il flusso e non dimostrano il funzionamento sui portali reali.

## Uso

All'apertura la mappa occupa tutta la larghezza. La ricerca sopra la mappa trova nome, codice e località; dopo 250 ms mostra le corrispondenze a tendina. Il clic su un risultato, oppure frecce ed Enter, ingrandisce la via e apre il popup; X cancella la ricerca, Escape chiude la tendina. La ricerca non nasconde altre vie. Senza tracciato si apre il riepilogo senza spostare la mappa. Da **Strumenti → Rete delle vie** si possono cercare soltanto inventario ufficiale, tracciati da associare o vie mai acquisite; X azzera anche questo ambito. Ogni via ha già una scheda privata, anche con zero immobili e operazioni.

1. Passare su una via per evidenziare soltanto il tracciato. Dalla 0.34.5 l'hover non apre popup e non cambia la via del riepilogo già selezionato.
2. Cliccare il tracciato o scegliere una via dalla ricerca per aprire il riepilogo con i dati disponibili. Il riepilogo resta aperto quando il cursore si sposta; un clic su un’altra via lo aggiorna. **Apri scheda** apre la modale: prima dell'acquisizione mostra lo stato iniziale; con dati conservati rende disponibili Immobili e Storico. **Chiudi**, Escape o il clic fuori riportano alla mappa; con modifiche aperte occorre prima salvare o annullare. **Aggiorna scheda** aggiorna la vista senza scartare i moduli modificati. Le viste sotto Strumenti usano la stessa finestra.
3. Acquisire la via. Le letture vengono conservate durante il lavoro, con checkpoint per la ripresa.
4. Confrontare con il gestionale. I duplicati e le ricerche incomplete richiedono verifica; non autorizzano nuove schede.
5. Nella scheda Immobili selezionare i casi pronti e applicare il piano. La presenza viene ricontrollata immediatamente prima della scrittura.

Annotazioni e correzioni sono esplicite e persistenti. Le correzioni si sovrappongono ai dati originali senza eliminarli e restano anche dopo una nuova acquisizione. Dopo una correzione occorre un nuovo confronto. Un import parziale deve essere ripreso prima di modificarne il piano o riacquisire la via. Una seconda applicazione di un import concluso crea un nuovo checkpoint, ricontrolla il gestionale e può aggiornare una scheda modificata nel frattempo.

Durante un confronto l'inventario CRM della via viene letto una sola volta; la ricerca catastale rimane distinta per ciascun immobile. Una lettura fallita resta incompleta per tutta quell'operazione. La cache viene eliminata alla fine, anche in caso di errore o pausa. Ogni applicazione rilegge sia via sia catasto prima di scrivere; nessuna lettura di un confronto precedente autorizza il salvataggio.

### Colori e percentuale di import

Dal **0.34.14** ogni via rappresenta cinque quote: verde per import Cloud verificati fino a 30 giorni inclusi, giallo da 31 a 90 inclusi, rosso oltre 90, blu per dati SISTER conservati ma mai importati in Cloud, grigio per righe dell’inventario ancora senza dati acquisiti. Le prove Cloud senza data restano grigie, con voce distinta nel riepilogo. Il blu comprende anche dati conservati in quarantena: non certifica che siano pronti all’import. Le prove possono appartenere a run precedenti e una nuova acquisizione non le azzera. Il denominatore è l’inventario distinto dell’ultima acquisizione completa; immobili fuori da quell’inventario non alterano le quote. Su 100 unità, 33 import di ieri, 17 di quattro mesi fa, 20 acquisite solo da SISTER e 30 ancora da leggere producono 33% verde, 17% rosso, 20% blu e 30% grigio. Un inventario interamente acquisito senza import Cloud è blu; una via mai acquisita è grigia.

Il gradiente segue la lunghezza complessiva del tracciato, anche curvo o composto da più parti, con transizioni brevi fra le quote. Non indica la posizione fisica delle case importate. Zoom e ritaglio della mappa non ridistribuiscono i colori. I tracciati sono sempre visibili con spessore **4 px e opacità 90%**; soltanto l'hover aumenta lo spessore a **8 px e opacità 100%**. L'area sensibile resta più ampia della linea. Uscendo dalla via il tratto torna normale subito, anche con riepilogo fissato da un clic; passando a un'altra via cambia soltanto l'evidenziazione, senza sostituire il popup aperto al clic. Zoom, trascinamento e uscita dalla finestra ripuliscono l'hover. I giorni sono intervalli completi di 24 ore; la vista si aggiorna anche al ritorno nella finestra e ogni minuto quando visibile.

La percentuale principale è il numero di immobili distinti già importati, anche in run precedenti, diviso per gli immobili distinti dell'ultimo inventario completo. Tre import su dieci immobili danno 30%, anche se il piano selezionava solo quei tre. Un nuovo import dello stesso immobile ne aggiorna la fascia temporale senza contarlo due volte. Solo un import concluso con riferimento CRM costituisce una prova; tentativi, confronti, date mutabili dell'unità e schede semplicemente trovate nel gestionale non incrementano il numeratore.

Il riepilogo distingue il conteggio «In questa acquisizione», che continua a usare solo le prove della run corrente. Un confronto, una correzione o la riapertura non cancellano le prove. Se la lettura più recente è parziale, non si torna alla run vecchia: si mostra il numero letto e il totale da verificare, senza percentuale o gradiente definitivo; il tracciato può essere blu uniforme se esistono dati acquisiti senza import Cloud verificati. Un inventario vuoto concluso è blu senza percentuale. Anche lo storico con righe della stessa via ancora da associare rimane prudenziale. Una prova senza data può contribuire al conteggio ma rimane grigia. Colore e percentuale descrivono gli import effettuati, non certificano che dati successivamente modificati siano allineati.

Le nuove acquisizioni avviate dalla mappa includono categorie A e C. La ripresa conserva i filtri originari. Il totale usa la tabella SISTER precedente ai filtri e comprende anche le unità dell'inventario che non hanno ancora una lettura completa dei proprietari. Indirizzi o identità ambigui impediscono un totale definitivo.

Percentuale e rapporto sono visibili nell'elenco, nel riepilogo e nella modale; aumentando lo zoom ad almeno 16 compaiono anche le etichette percentuali sui tracciati. Lo storico viene aggiornato dalle prove del file locale già esportato, senza ripetere import o riletture dei portali. Le prove restano nell'archivio sincronizzato e sono distinte per acquisizione; i totali di un job che comprende più vie non vengono applicati indistintamente a ciascuna via.

Pausa e chiusura attendono il punto sicuro. Alla riapertura una lettura interrotta diventa «da riprendere»; dalla 0.34.16 un lavoro di import V2 diventa terminato e la coda conserva soltanto gli immobili non conclusi. Gli immobili letti restano disponibili; una lettura fallita non elimina schede conservate e non prova assenze.

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

Il pulsante **Sincronizzazione** permette di caricare o recuperare l'archivio. Le modifiche locali e i conflitti tra revisioni bloccano la sostituzione automatica. Prima di un recupero viene conservata una copia dell'archivio precedente. Le letture recuperate in corso diventano da riprendere; gli import V2 terminano conservando i checkpoint dei singoli immobili. Se la risposta di un salvataggio va persa, un nuovo caricamento riconosce i dati già salvati senza duplicarli. Un lock del profilo impedisce scrittori concorrenti sullo stesso archivio.

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

Le istruzioni seguenti riguardano il laboratorio separato. Nell'app integrata usare **Apri Chrome di lavoro**. Il laboratorio mantiene un Chrome di prova con profilo proprio e rifiuta la porta quotidiana 9222. Se lo stesso profilo Territorio è stato aperto dall'app integrata, a entrambe le app chiuse impostare soltanto `cdpUrl` su `http://127.0.0.1:9223` in `live-config.json`, conservando le autorizzazioni; l'app integrata riadotta automaticamente il browser di lavoro alla prossima apertura.

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
npm.cmd --prefix worker run territory:search-check
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
