# Property Worker V2: registro operativo delle vie

## Obiettivo e confini

La mappa risponde a **dove lavorare**. La scheda della via risponde a **cosa sappiamo e cosa fare adesso**. La coda degli immobili risponde a **quali schede applicare**. Lo storico risponde a **cosa è cambiato**.

Intervento sull’intero renderer Territorio, integrato in Worker V2. La scheda resta in modale, come richiesto; Lavorazioni e Rifinitura restano disponibili. Il redesign non modifica acquisizione, confronto, autorizzazioni, conferma del piano, conservazione delle prove o sincronizzazione. Nessuna applicazione automatica nel CRM.

## Analisi atomica e decisioni

| Livello / elemento | Attrito rilevato | Soluzione e funzione |
| --- | --- | --- |
| Atomo: caratteri | Font dichiarati ma non distribuiti | Instrument Sans variabile locale per interfaccia e testo; IBM Plex Mono locale per catasto, identificativi e dati. Licenze OFL incluse. Nessuna richiesta a server di font. |
| Atomo: scala | Titoli e metadati con dimensioni poco coerenti | Scala dei token condivisi: sezione 22, immobile 16, testo 14, metadati 13, etichetta 11. Pesi e interlinea dei token; niente monospazio nella navigazione. |
| Atomo: colori | Stato operativo e data import confondibili | Tracciato: verde ≤30 giorni, giallo 31–90, rosso >90, grigio senza import datato. Badge testuale distinto per esito immobile. Il colore non è l’unico segnale. |
| Atomo: controlli | Checkbox piccoli, focus incompleto | Area selezione 44×44, focus visibile anche sui disclosure, zoom 44×44, etichette visibili nei campi intestatari, intestazioni semantiche nelle tabelle. |
| Atomo: attesa / errore | Click ripetibili, toast come unico recupero | Blocco immediato e aria-busy sulle richieste; errore locale persistente nei moduli/azioni. Caricamento archivio con testo e Riprova in caso di errore. Nessun retry automatico delle scritture. |
| Molecola: riepilogo via | Ripeteva diversi stati di assenza e molte date | Identità, stato, copertura dell’ultima acquisizione e anzianità import. Date di archivio e provenienza in un disclosure secondario. |
| Molecola: riga via | Quattro livelli di testo ripetuto | Nome 16px, località/stato, copertura quando disponibile; ordinamento alfabetico, priorità o anzianità. Elenco completo tramite Mostra altre vie. |
| Molecola: popup | Azioni e informazioni pari peso | Identità, import, Apri scheda primario; segnalazione manuale secondaria. Dimensionamento entro la mappa. Hover sottile/largo invariato. |
| Molecola: card immobile | Lista lunga senza gerarchia | Indirizzo, catasto, esito e motivo; categoria/intestatari essenziali; dettagli ed evidenze espandibili, correzioni esplicite. Card solo per unità operative autonome. |
| Molecola: note | Salvataggio lontano dall’annotazione | Card dedicata, campo leggibile, segnalazione manuale e Salva/Annulla nello stesso spazio. Modifiche non salvate sempre segnalate nella modale. |
| Organismo: toolbar | Sei azioni con la stessa priorità | Accesso Chrome V2 e sincronizzazione visibili. Strumenti raccoglie rete, schede autorizzate, storico da associare e aggiornamento. Menu chiudibile con Escape e click esterno. |
| Organismo: catalogo | Slogan e filtri occupavano la ricerca | Titolo operativo, ricerca etichettata, disclosure filtri con conteggio attivo, reset, ordinamento e frecce per navigare le vie. Il focus da tastiera evidenzia il tracciato. |
| Organismo: percorso | Tre comandi sparsi fra due tab | Acquisisci → Confronta → Controlla e applica. Prossimo passo derivato dagli esiti conservati; nessuna concatenazione implicita di operazioni. Comandi di nuova acquisizione e confronto restano espliciti. |
| Organismo: avanzamento | Pausa sotto una modale che rende la mappa inerte | Riepilogo corrente e Pausa dentro la scheda, anche durante modifiche non salvate; riepilogo sulla mappa quando la scheda è chiusa. |
| Organismo: coda immobili | Nessuna ricerca o filtro esiti | Ricerca per indirizzo, catasto e intestatario; filtri selezionabili, da confrontare, da verificare, coerenti/allineati, selezionati. Seleziona pronti opera sulle righe filtrate; Deseleziona disponibile. |
| Organismo: piano selezione | Numero solo nel pulsante | Barra persistente: numero, nuove schede, aggiornamenti, selezionati fuori dai filtri e motivo di blocco. Nessuna autorizzazione acquisita automaticamente. |
| Organismo: storico | Recupero precedente prima del lavoro corrente | Operazioni correnti e diario in ordine leggibile; evidenze del vecchio worker in disclosure distinto. La presenza attuale richiede comunque confronto. |
| Pagina: scheda via | Circa 300px prima del lavoro, refresh distruttivo del contesto | Intestazione compatta, tab fissi, contenuto scorrevole. Tab con frecce/Home/End, aria-controls e focus conservato. Disclosure, cursore ricerca e scroll ripristinati per chiave immobile. |
| Pagina: schede autorizzate | Consenso e salvataggio dopo la lista | Elenco scorrevole, selezione e consenso fuori dallo scroll, massimo 10 spiegato, caricamento incrementale, ricerca e intestatari consultabili. Nessun cambio ai controlli backend. |
| Pagina: storico da associare | Taglio alle prime 50 righe | Ricerca e caricamento incrementale; associazione esplicita con inventario ufficiale; scelta aperta protetta da filtro/cambio vista. |
| Pagina: memoria online | Testi generici e validazione fuori dalla modale | Stato sincronizzato/in attesa/errore e data leggibili. Invia modifiche locali / Recupera archivio online; blocco operazione e risultato dentro la modale etichettata. |
| Sistema: layout | Altezza minima provocava scroll esterno | Griglia legata all’altezza disponibile, pannelli con min-height:0; catalogo richiudibile sui piccoli schermi; modale nei limiti del viewport. Temi chiaro/scuro conservati. |

## Regole che non cambiano

- Dal 0.34.3 il gradiente e la percentuale principale usano gli immobili dell'ultimo inventario completo e l'ultimo import verificato di ciascuno, anche in run precedenti. Il conteggio della sola acquisizione corrente rimane distinto. Totale incerto resta esplicitamente incerto.
- Mancanza della data non significa assenza di import.
- Segnalazione manuale e stato del processo sono informazioni separate.
- Correzioni umane e letture originali restano conservate. Correggere impone un nuovo confronto.
- Un processo alla volta fra worker precedente e V2; pausa conserva il checkpoint.
- Applicazione limitata alle identità concordate, con confronto aggiornato e conferma esistente.
- Offline conserva il lavoro locale; conflitti online non sovrascrivono automaticamente modifiche.
- Fonte e licenza dell’inventario/OSM restano accessibili; nessun tracciato assegnato per semplice somiglianza del nome.

## Collaudo

Regressione Electron isolata per acquisizione/confronto/applicazione simulata, hover, associazione, note, due correzioni aperte, restart e colori import. Controlli aggiuntivi per filtri, selezione nascosta, navigazione tastiera, focus/disclosure/scroll dopo refresh, Pausa nella modale, font caricati e assenza di overflow a 390/800/1024/1600. Collaudo integrazione con il worker precedente e sincronizzazione online tramite servizi finti e copie in profili temporanei. Nessuna scrittura di prova nel gestionale reale.

Le due valutazioni indipendenti iniziali hanno concordato su frammentazione del flusso, header troppo alto, font assenti e perdita del contesto di lettura. La seconda ha riprodotto la perdita di focus e l’overflow a 800×600; la prima ha analizzato gerarchia, lessico, card e percorso prima dell’applicazione. Questi comportamenti guidano la verifica finale, insieme ai controlli automatici.

### Esito del 5 ottobre 2026

- Compilazioni Territorio e desktop riuscite; 516 test CI passati.
- Suite completa: 710 casi eseguiti. Nel passaggio con due worker, 706 passati e quattro timeout Chrome a cinque secondi; i quattro casi sono passati nelle ripetizioni isolate, senza modificare test, asserzioni o limite di tempo. Il primo passaggio con concorrenza predefinita aveva 14 timeout.
- Collaudi Electron Territorio, UX, integrazione V2/precedente, memoria online e interfaccia precedente passati. La prova online usa servizi finti e copie temporanee dell’archivio; nessuna applicazione al CRM reale.
- Due revisioni finali indipendenti: font locali caricati, tab da tastiera, disclosure/focus/scroll conservati, azioni di autorizzazione sempre raggiungibili e nessun overflow. Corretti anche i problemi residui rilevati: percorso con pronti e incerti, catalogo mobile senza uscita, filtro selezionati, prefisso IPC nell’errore e controlli inutili nella scheda vuota.
- Il rilevatore Impeccable restituisce un rilievo sul divisore del catalogo (`border-right:1px solid var(--lr-line-quiet)`): verificato come separatore strutturale neutro, non bordo decorativo accentato. Non è stato presentato come scansione priva di rilievi.

### Gradiente per immobile, 0.34.3 (6 ottobre 2026)

Tracciato 4 px al 90%, 8 px in hover. Gradiente continuo lungo la geometria completa: quote recenti, da riprendere per anzianità e mai importate/senza data. Elenco, popup e scheda mostrano le stesse quote; il rapporto della run corrente rimane distinto. Le transizioni brevi non rappresentano posizioni di immobili. Avanzamento e Pausa precedono il riepilogo che cambia altezza durante l'acquisizione.

539 test CI superati e compilazione TypeScript riuscita. Controllo Electron dell'esempio 33/17/50 con lettura dei pixel del canvas, spostamento e zoom; regressioni su hover, note e restart. Verificati anche UX (Pausa/ripresa, focus, filtri e layout), integrazione nella finestra desktop e memoria a V2 chiuso. Il test Pausa usa un click reale subito dopo la verifica di visibilità, perché le finestre Electron nascoste renderizzano a 1 fps e la fixture termina in 720 ms, prima delle due frame richieste dall'attesa di stabilità Playwright. Nessuna scrittura nel gestionale reale.
