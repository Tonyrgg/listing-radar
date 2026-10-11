# Acquisizione conclusa, quarantena e applicazione unica

## Versione 0.34.13

Worker V2 distingue la conclusione della lettura SISTER dalla validità di ogni riga. Quando la ricerca termina, l'acquisizione risulta **conclusa** anche se alcune righe richiedono controllo. Queste rimangono nella **Quarantena**, accessibile dalla scheda della via e da Strumenti. Filtri intenzionali non diventano errori. Una sessione scaduta, una pausa o una ricerca interrotta restano operazioni da riprendere: non provano che la lettura sia terminata.

La quarantena conserva motivo, via, run, data, identità catastale e dati originali disponibili. Quando il vecchio checkpoint contiene soltanto una riga non acquisita, non vengono inventati codici fiscali o proprietari mancanti. Le nuove sorgenti invalide vengono conservate integralmente. Gli immobili in quarantena sono separati dall'elenco operativo e dalle query. Le correzioni valide li rimettono in lavorazione senza modificare l'osservazione originale; una nuova lettura valida può risolvere la stessa identità. I contatori dell'inventario continuano a includere le unità identificabili anche se non ancora importabili. Un foglio, una particella o un indirizzo non interpretabili mantengono il totale incerto, senza trasformare un tentativo in inventario completo.

Le vecchie run V2 segnate «Acquisizione parziale» vengono concluse soltanto quando il checkpoint SISTER certifica `completed`, non presenta `lastError` e tutte le query sono `found` o `empty`. Le righe anomale restano in quarantena. Non si riaprono SISTER e CRM e non si ricostruiscono import mancanti.

## Subalterno assente

Foglio, particella e Comune rimangono obbligatori. Un subalterno vuoto è ammesso e rimane vuoto nel CRM: non si usa un valore inventato. Non è un jolly per tutte le unità della particella. Una scheda con subalterno diverso non viene scelta o cancellata automaticamente; più corrispondenze o un indirizzo senza identità confermata vanno in quarantena. Le ricerche senza subalterno leggono anche gli altri riscontri della particella per rilevare queste ambiguità. I controlli su intestatari privati, CF, quote, Comune e autorizzazioni restano attivi.

## Confronto e import nello stesso avvio

**Applica selezionati** è disponibile per immobili validi anche senza confronto precedente. Per ogni immobile legge il CRM, cerca via e catasto, crea soltanto dopo una ricerca completa senza corrispondenze, oppure aggiorna una scheda identificata. L'opzione **Solo schede esistenti** continua a impedire nuove creazioni. Le ambiguità rilevate prima delle scritture vanno in quarantena e il processo prosegue sugli altri immobili. Il confronto separato rimane disponibile per consultare gli esiti senza scrivere.

Gli esiti incerti successivi a un salvataggio, le interruzioni globali e gli import con checkpoint già avanzati richiedono la ripresa originale. Anche una corrispondenza cambiata durante la ripresa resta sospesa, con il checkpoint intatto. I piani accantonati prima di qualsiasi scrittura vengono archiviati nella quarantena senza bloccare nuove acquisizioni. Non si ripetono scritture incerte per ottenere una falsa conclusione. Ogni import conserva le verifiche di rilettura e lo storico del singolo immobile. La conferma desktop rimane prima dell'avvio delle scritture reali.

Quarantena e risoluzioni sono campi del JSON del workspace già esistente, sincronizzati con le stesse revisioni. Nessuna modifica SQL. La coda dei fatti individuali accetta scritture concorrenti dello stesso fatto su Windows soltanto dopo aver verificato che il file già persistito sia identico byte per byte.

## Verifiche

`npm.cmd --prefix worker run territory:quarantine-check` esercita acquisizione conclusa con anomalie, applicazione senza confronto preliminare, create/update, quarantena delle ambiguità, correzione con originali conservati, accesso globale e layout a 390/1024/1600 px. Usa un profilo temporaneo e un CRM simulato. Le regressioni coprono inoltre subalterno assente, distinzione da altre unità, riapertura e migrazione delle vecchie false acquisizioni parziali, sessioni interrotte e ripresa dei salvataggi incerti. Non costituisce un collaudo delle nuove scritture nel CRM reale.
