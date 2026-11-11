# Ricerca prodotto: Avistador, Realix e Facile Acquisire

**Data:** 10 novembre 2026
**Scopo:** tradurre riferimenti pubblici in una direzione concreta per Listing Radar e VAB.
**Perimetro:** pagine pubbliche, descrizioni commerciali e documentazione pubblica. Nessun accesso ad account privati, nessuna estrazione dei dati della piattaforma Avistador, nessuna verifica indipendente dei risultati commerciali dichiarati dai fornitori.

## Sintesi

Avistador è il riferimento più utile per rendere Listing Radar semplice da consultare. Il nucleo del suo prodotto è una sequenza leggibile: raccogliere annunci, confrontarli nel tempo, spiegare i segnali e presentare per primi quelli che meritano attenzione. La pagina pubblica descrive una lista breve «I 10 di oggi», una lista completa filtrabile, un punteggio motivato e un accesso rapido alla scheda; non documenta il codice, i pesi del punteggio, la copertura effettiva o il funzionamento interno dei suoi crawler.

Listing Radar ha uno scopo più ampio: dossier locale su immobili, pubblicazioni, trasformazioni e prove pubbliche di Bitonto, Palombaio e Mariotto. Va quindi ripreso il modo in cui Avistador riduce il carico di lettura, non trasformata l'app in una copia letterale né in un CRM di telefonate. La direzione consigliata è un archivio con una sola vista iniziale chiara, righe diverse secondo il tipo di informazione e schede che mostrano subito fatto, luogo, data, fonte e incertezza.

Per VAB, Facile Acquisire presenta pubblicamente un servizio gestito che include strategia, creatività, campagne Meta, qualifica, riscaldamento, notifiche e formazione alla conversione. Realix comunica un modello di acquisizione anticipata basato su segnali predittivi, ma non pubblica abbastanza dettagli tecnici per ricostruirne il metodo. La via verificabile per VAB resta la campagna Meta con moduli compilati volontariamente, una presa in carico rapida e un flusso semplice di follow-up.

## 1. Avistador: prodotto e flusso osservabile

### Promessa del prodotto

La promessa è circoscritta: non mostrare soltanto l'annuncio appena pubblicato, ma aiutare l'agente a capire quando un venditore privato può essere più disposto a farsi assistere. Il messaggio della pagina italiana è «Chiami al giorno 60, non al giorno 1». È una scelta di posizionamento che sposta l'attenzione dalla quantità di nuovi annunci al momento in cui contattare.

### Flusso utente che le pagine pubbliche descrivono

1. Si sceglie una zona.
2. Si vede una lista breve dei dieci record prioritari del giorno.
3. Ogni record porta poche prove leggibili: tipologia, via, giorni sul mercato, ribassi, variazione di prezzo o altri segnali.
4. Si apre la lista completa e la si filtra per prezzo, tipologia, anzianità, ribassi e portale.
5. La scheda fornisce un argomento d'apertura; l'utente registra l'esito e passa al successivo senza lasciare la vista.
6. I record si possono esportare in CSV; per i team sono dichiarati assegnazione delle zone, blocco temporaneo dei contatti, registro condiviso e report settimanale.

La homepage dichiara tre segnali base per il Timing Score: tempo sul mercato, ribassi e prezzo rispetto alla mediana della zona. In altri esempi aggiunge cambio/repubblicazione del portale, mandato d'agenzia scaduto e densità di concorrenti entro una distanza. La formula, i pesi e le soglie non sono pubblici; non si deve presentare come noto ciò che non lo è.

### Perché il flusso sembra semplice

- Un solo problema operativo per schermata: capire da dove iniziare.
- Una lista prioritaria sopra l'elenco completo; la priorità non nasconde il resto.
- Un punteggio accompagnato dalla ragione, non da una spiegazione opaca.
- La stessa riga riassume immobile e cambiamenti; i filtri non dominano la pagina.
- Il percorso è continuo: selezione, dettaglio, esito, record successivo.
- Il team riceve solo funzioni che eliminano lavoro duplicato e rendono misurabile la copertura.

### Limiti dell'analisi pubblica

Non ho osservato il back office autenticato, né il suo comportamento su account reale. La pagina commerciale non prova che una specifica fonte venga acquisita in modo continuo o che i risultati dichiarati siano completi. Le pagine in lingue diverse non sono del tutto coerenti: la pagina italiana cita Casa.it e Idealista, quella spagnola Idealista e pisos.com; alcuni testi riassumono tre segnali, altri ne mostrano ulteriori. I dettagli tecnici restano quindi ignoti.

## 2. Traduzione in Listing Radar

Il repository definisce già Listing Radar come archivio di intelligence immobiliare, non come agenda commerciale. Il disegno attuale ha Intelligence, Territorio, Fonti e documenti, Richieste e verifiche, Abbinamenti e Impostazioni; Intelligence separa Mercato, Opportunità, Notizie, Usciti e Venduti. Esistono già palette scura, token di design e componenti diversi per mercato, opportunità e notizie. La nuova direzione deve decidere se quella separazione aiuta l'utente o lo costringe a capire prima la struttura interna del prodotto.

### Direzione proposta

**Pagina iniziale: «Da consultare»**

- Una coda breve di aggiornamenti che meritano lettura, senza score presentato come probabilità di vendita.
- Ogni riga mostra immobile/situazione, cosa è cambiato, quando, luogo e qualità della prova.
- Una riga di motivazione: «Perché la vedi qui».
- Elenco completo raggiungibile con filtri in una barra compatta; filtri meno usati restano chiusi.
- Mappa come strumento di localizzazione e confronto, non come passaggio obbligato per capire un documento.

**Tipi di record distinti**

- **Annuncio:** foto, prezzo corrente, variazione, prima/ultima osservazione, portale.
- **Documento comunale:** situazione in una frase, data dell'atto, area/indirizzo, fonte primaria e corrispondenza territoriale.
- **Trasformazione:** stato precedente → stato documentato, date e prova; ciò che non è dimostrato resta separato.
- **Evento non risolto:** indicazione di cosa manca per collegarlo a immobile o unità specifica.

**Scheda dossier**

1. Titolo comprensibile: identità dell'immobile o descrizione della situazione.
2. Dato principale e variazione, se esiste.
3. Timeline sintetica con osservazioni e date dichiarate separate.
4. Fonti e documenti apribili, con livello di collegamento territoriale.
5. Sezione «Cosa sappiamo / cosa resta da verificare».
6. Azioni primarie limitate a consultare la prova, correggere una corrispondenza o salvare una valutazione.

**Tema scuro**

La conversione deve cambiare superfici e contrasto, non semplicemente sostituire bianco con nero assoluto. Il sistema esistente supporta già il tema scuro con superfici verdi/carbone distinte. È preferibile mantenere tale gerarchia, usare il colore solo per stati e tipologie e non usare gradienti o card equivalenti come decorazione.

### Cosa non trasferire letteralmente

- La coda da chiamare e il follow-up commerciale: non corrispondono al mandato attuale di Listing Radar.
- Uno score che affermi quanto un proprietario sia «vicino ad accettare un agente»: è una conclusione predittiva, non un fatto pubblico.
- L'elenco contatti telefonici o una logica di cold call.
- La forma grafica, il testo, le immagini, i nomi o il marchio Avistador. Si riusano principi di gerarchia e interazione, non la loro espressione distintiva.

## 3. Reverse engineering: ciò che possiamo inferire e ciò che no

### Modello funzionale plausibile, non confermato internamente

Le funzioni pubblicizzate sono compatibili con pipeline composte da: acquisizione di schede degli annunci, normalizzazione per portale, snapshot di prezzo/stato, raggruppamento dello stesso immobile, rilevamento di variazioni, classificazione privato/agenzia, calcolo di segnali, ranking e interfaccia operativa. La corrispondenza fra annunci usa, secondo il sito, fotografie; è plausibile che si combinino impronte visive e attributi testuali/geografici, ma l'algoritmo effettivo non è pubblicato.

Il modello dati minimo che serve a ottenere risultati analoghi nel nostro prodotto è:

- annuncio e fonte, con URL e identificativo originario;
- snapshot immutabili con data di osservazione e campi normalizzati;
- eventi derivati espliciti: variazione di prezzo, nuova pubblicazione, ritorno online;
- identità dell'immobile con corrispondenza e livello di certezza;
- evidenza che giustifica ciascun segnale;
- policy di conservazione, opposizione e cancellazione;
- score riproducibile, con fattori mostrati accanto al risultato.

Questo descrive un'architettura che possiamo costruire noi; non è una rivelazione dell'architettura privata di Avistador.

### Vincolo sui dati Avistador

I termini pubblici di Avistador vietano estrazione automatizzata, rivendita e ridistribuzione dei dati mostrati nella piattaforma. L'analisi va limitata alle informazioni pubbliche del sito e a normali osservazioni del flusso pubblicizzato. Non va automatizzato il login, interrogata la sua app per copiarne i record o acquisita una prova gratuita che possa trasformarsi in un addebito senza una decisione separata.

## 4. Facile Acquisire e Realix

### Facile Acquisire

La pagina pubblica descrive una filiera di servizio: analisi locale, video/grafiche, campagne Lead Generation, filtro e qualifica, riscaldamento, notifica, materiali educativi e protocolli per appuntamento/conversione. Il modello commerciale mostrato è costo iniziale/licenza più costo per notizia qualificata, con varianti e garanzie.

Il sito attribuisce parte del risultato a AI/ML e a un insieme di oltre 5.000 proprietari. Sono dichiarazioni commerciali, non una descrizione tecnica verificabile. Inoltre la stessa pagina pubblica indica volumi non uniformi in sezioni diverse: 20–50, 15–50 e 60–180 notizie. Non vanno usati come previsione per Bitonto senza chiarire definizione di «notizia qualificata», periodo, rimborsi, esclusività e numeri storici verificabili.

**Flusso interno replicabile per VAB:** creatività → inserzione Meta → modulo con intento e zona → raccolta in area privata → avviso → risposta rapida → primo confronto → solo dopo averne parlato, eventuale presentazione della persona alla collaborazione immobiliare → esito registrato. L'elemento distintivo non è l'etichetta AI: è la continuità fra annuncio, modulo, risposta e presa in carico.

### Realix

La pagina Realix descrive Listing Pro come acquisizione «prima che il proprietario arrivi sul mercato», basata su analisi predittiva, contenuti digitali e processi automatizzati. Non pubblica le fonti, le variabili, la logica di scoring o il flusso tecnico. Le testimonianze e i numeri presenti sul sito non sono verificati indipendentemente da questa ricerca. Non è corretto dedurre che si tratti solo di Meta Ads o di una specifica tecnica di profilazione.

**Conseguenza:** per replicare il risultato commerciale servono prove sul processo — quali campagne, domande, contatti, tempi e conversioni — non una supposizione su come sia fatto il loro algoritmo. In assenza di dettagli, VAB dovrebbe partire dal percorso opt-in misurabile già pianificato.

### Un riferimento adiacente: MORYA Radar

MORYA presenta un modello utile per l'archivio di fonti: disegnare una zona, ricevere una segnalazione, vedere perché è emersa e la prova collegata al luogo/particella. Elenca registri societari, atti, catasto, vendite, attestati energetici, licenze e urbanistica. La pagina dichiara disponibilità in Francia e Italia «prossimamente» e i dati descritti sono francesi: non è una fonte pronta per Bitonto. È utile come modello di incrocio documentale e di scheda del segnale, non come copertura italiana già disponibile.

## 5. Privacy e sostenibilità operativa

Avistador dichiara nella propria informativa di non conservare il numero telefonico, ma un hash con chiave per deduplicare inserzionisti, rilevare annunci d'agenzia e rispettare opposizioni; dichiara anche di non contattare gli inserzionisti. La homepage, invece, parla di informare i titolari e di chiamare i proprietari. Le dichiarazioni pubbliche non sono perfettamente allineate: non possiamo trattare la loro pagina come una prova che la stessa base giuridica funzioni automaticamente per noi.

L'EDPB chiarisce che il legittimo interesse richiede interesse concreto, necessità e bilanciamento dei diritti, valutati nel contesto. Il Garante italiano ha affermato nel provvedimento del 14 maggio 2026 che dati reperiti in registri pubblici, siti o piattaforme non autorizzano di per sé comunicazioni promozionali telefoniche senza il consenso richiesto e che il controllo RPO è una precondizione per le campagne telefoniche. Prima di qualunque uso di contatti presi da annunci per acquisizione commerciale serve quindi una valutazione professionale specifica. Questo è distinto da raccogliere una richiesta volontaria tramite il modulo VAB.

Per le campagne Meta, la libreria annunci consente di osservare annunci attivi e quelli che hanno raggiunto l'UE nell'ultimo anno; la guida Meta ai lead suggerisce di collegare il recupero delle richieste a un CRM e di rispondere rapidamente. Questi strumenti consentono di studiare creatività e gestione, non di vedere l'intero algoritmo di distribuzione o tutti i parametri di targeting dei concorrenti.

## 6. Piano operativo consigliato

1. **Definire il perimetro di prodotto.** Listing Radar resta un dossier locale di intelligence, non un clone di CRM commerciale. VAB è la filiera di acquisizione opt-in.
2. **Scrivere una specifica UI breve e verificabile.** Una pagina di ingresso, registro completo, dossier e fonti; per ogni schermata indicare scopo, dato principale, azione primaria e stati di errore/vuoto.
3. **Ridisegnare prima un flusso completo.** Partire da una riga di Intelligence → dossier immobile → prova/documento → ritorno al registro. Applicare il tema scuro senza copiare loghi, copy o asset.
4. **Consolidare i dati prima di moltiplicare i segnali.** Ogni variazione deve avere osservazione precedente, nuova osservazione, fonte e certezza del collegamento.
5. **Valutare le fonti una per una.** Preferire API, feed autorizzati e registri ufficiali; per portali commerciali leggere i termini d'uso e ottenere un accesso adeguato prima di automatizzare. Un sito leggibile a mano non equivale a licenza di estrazione.
6. **Per VAB misurare tutto il funnel.** Spesa, invii, richieste valide, contattabilità, appuntamenti, presentazioni alla collaborazione e incarichi; non chiamare «qualificata» una richiesta solo perché ha compilato il modulo.
7. **Rivedere privacy e contatti prima dell'uso commerciale.** La pubblicità opt-in e il prospecting telefonico da dati di annunci sono attività diverse; non riutilizzare i contatti dei portali nel funnel senza parere specifico.

## Fonti pubbliche consultate

- [Avistador Italia — prodotto e flusso](https://avistador.com/it)
- [Avistador — prezzi e caratteristiche per piano](https://avistador.com/it/precos)
- [Avistador — funzionalità per agenzie](https://avistador.com/it/para-agencias)
- [Avistador — termini e privacy](https://avistador.com/it/legal)
- [Avistador Spagna — descrizione del Timing Score e dei segnali](https://avistador.com/es)
- [Facile Acquisire — offerta e dichiarazioni pubbliche](https://facileacquisire.it/)
- [Realix — descrizione di Listing Pro](https://www.reali-x.com/)
- [MORYA Radar — segnali e fonti pubbliche francesi](https://morya.app/es/radar)
- [EDPB Guidelines 1/2024 sul legittimo interesse](https://www.edpb.europa.eu/documents/guideline/guidelines-12024-on-processing-of-personal-data-based-on-article-61f-gdpr_en)
- [Garante Privacy — provvedimento 14 maggio 2026](https://garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/10262367)
- [Regolamento GDPR, art. 14](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX%3A32016R0679)
- [Meta Ad Library](https://www.facebook.com/ads/library/)
- [Meta — guida alla generazione di lead](https://about.fb.com/ltam/wp-content/uploads/sites/14/2023/11/LeadGenerationGuide.pdf)

## Stato di consegna

- Ricerca web pubblica completata e sintetizzata.
- Confronto dei concetti con il design system e la struttura di Listing Radar nel repository.
- Nessun codice, interfaccia, campagna o account è stato modificato.
- Il controllo del browser locale è stato interrotto dal livello di sicurezza prima dell'interazione, perché non riusciva a confermare l'URL della finestra con sufficiente affidabilità. Di conseguenza, questo documento non pretende di descrivere visivamente schermate autenticate o il backend interno di Avistador.
