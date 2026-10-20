# Public Records: fatti immobiliari e Notizie

Base: e80119e. Target: Listing Radar production, progetto Supabase eqqmglsxwbsihrlecnun.
Data verifica: 20 ottobre 2026. Policy: `property_facts_v1`.

## Documents processed

Passaggio su **4.074/4.074** record esistenti. Rilettura primaria per **2.431**:
le due fonti CSV edilizie 2024/2025 gia configurate, piu 80 schede Albo note.
**1.639** restano REVIEW; altri quattro record hanno solo un tipo pratica
strutturato utilizzabile. Nessuna nuova fonte, inventario storico o property.

I titoli Albo generati e l'intervention_type precedentemente inferito NON sono
prove primarie. Nessuna trasformazione viene estratta da queste etichette.
I CSV completi sono letti solo in memoria; i testi liberi e i dati delle persone
non sono conservati. Gli eventi conservano esclusivamente brevi span pertinenti.

Approfondimento limitato a **8 allegati unici**, non migliaia di PDF:
6 leggibili, 2 di formato non supportato e lasciati REVIEW. Riletture correttive
degli stessi URL durante il collaudo; 80 e 8 sono conteggi di URL unici, non di
richieste HTTP totali. Nessun OCR, bypass o download massivo. Limiti: 8 MB,
20 pagine, timeout e parser con limite di output; pagine e body non archiviati.

## Events extracted / event types

**1.319 fatti** piu **3 combinazioni**. I fatti non sono interventi edilizi
certificati ne immobili distinti. Piu eventi possono appartenere allo stesso atto.

| Tipo | Fatti |
|---|---:|
| MANUTENZIONE_STRAORDINARIA | 362 |
| SCA_AGIBILITA | 229 |
| SANATORIA | 138 |
| FRAZIONAMENTO | 124 |
| FUSIONE | 124 |
| CAMBIO_DESTINAZIONE_USO | 123 |
| MANUTENZIONE_ORDINARIA | 112 |
| RISTRUTTURAZIONE | 44 |
| RESTAURO_RISANAMENTO | 13 |
| INIZIO_LAVORI | 11 |
| AMPLIAMENTO | 9 |
| DEMOLIZIONE_RICOSTRUZIONE | 7 |
| ACCERTAMENTO_CONFORMITA | 6 |
| NUOVA_COSTRUZIONE | 6 |
| DEMOLIZIONE | 3 |
| SOPRAELEVAZIONE | 3 |
| FINE_LAVORI | 1 |
| NUOVA_ATTIVITA | 1 |
| CONDONO | 1 |
| VARIANTE_URBANISTICA | 1 |
| LAVORO_STRADALE | 1 |

Zero fatti validati per le altre categorie supportate, comprese alienazioni,
dismissioni, cessazioni, vincoli/espropri e nuova edificabilita. Zero non significa
assenza nel territorio: significa assenza di prove accettate nel perimetro letto.

## High relevance / direct sale / pre-market

**591** fatti con interesse >=70. Interesse informativo 0-100, non probabilita
di vendita e non Acquisition Opportunity Score. Confidence 0,90 per il tipo
pratica dichiarato, 0,95 per un claim esplicito: pesi della policy, non precisione
empiricamente certificata.

**Direct sale: 0. Pre-market dimostrabile: 0.** Nessun lead, task, follow-up o
outreach. Il criterio di assenza e sempre limitato agli annunci conosciuti.
Un edificio senza immobili monitorati non diventa automaticamente pre-market.

## Frazionamenti / cambi uso / nuove costruzioni

124 dichiarazioni di frazionamento, 123 di cambio d'uso e 6 nuove costruzioni.
Le regolarizzazioni di trasformazioni passate sono marcate separatamente e non
diventano nuove trasformazioni commerciali. Terrazzi e parti comuni hanno
subtype PARTIAL_ASSET, rilevanza 55 e nessuna deduzione di nuove abitazioni.
Conteggi di unita e FROM_USE/TO_USE sono popolati solo quando espliciti.
16 segnali NEW_UNITS_POSSIBLE e 4 PROPERTY_FUNCTION_TRANSFORMED; 7 cambi d'uso
hanno una coppia FROM/TO esplicita. Non sono nuove abitazioni offerte in vendita.
Categorie C/1, C/6, A/10 non vengono tradotte automaticamente in usi urbanistici.

## Completions / sanatorie

229 dichiarazioni SCA, una citazione documentale sostenuta di fine lavori.
Questa ultima prova e un certificato trasmesso entro il **14/06/2022**, richiamato
da un atto successivo: `event_date=NULL`, limite dichiarativo separato,
data documento distinta. Non e una fine lavori avvenuta alla data del nuovo atto.

138 sanatorie, 6 accertamenti e un procedimento collegato a condono. UI:
attivita di regolarizzazione amministrativa; nessuna etichetta di immobile abusivo.
Una SCIA/CILA non prova lavori iniziati; le 11 comunicazioni residue non sono
promosse automaticamente a STARTED. Una frase futura «a conclusione dei lavori»
e una mancata presentazione di fine lavori non sono completamenti dichiarati.

## Urban planning / land / commercial

Una variante territorialmente sostenuta. Nessun BUILDABILITY_CHANGED:
mancano confronto prima/dopo e geometria/particella compatibile verificati.
Ipotetiche lottizzazioni, alternative normative, formazione sugli espropri e atti
con territorio esterno/non dimostrato sono esclusi. Affidamenti e liquidazioni
pertinenti rimangono eventuale supporto amministrativo di rilevanza ridotta.
Un'apertura di attivita dichiarata; nessun locale dichiarato disponibile.

## Combined signals / market crossover

Tre sequenze di trasformazione con successiva dichiarazione di agibilita nello
stesso edificio. Sono sequenze documentali, non prova della medesima unita o di
causalita. I riferimenti a opere regolarizzate/parti comuni non alimentano queste
sequenze. Gli altri pattern sono implementati, ma privi di prove sufficienti.

**302** fatti a livello BUILDING, **4** STREET, **1.013** AREA.
Nessuno a livello PROPERTY: non viene inventata l'identita dell'appartamento.
Solo **3** fatti incrociano edifici con immobili monitorati, tutti con annunci
attivi conosciuti; nessuna falsa assenza. Registry/indirizzi restano quelli del
grafo esistente, inclusi override umani e ambiguita conservate.

## Top 50 / recent 30-90 days

[Campione, errori corretti e Top 50](38-property-facts-quality-and-top50.md).
Il ranking centrale usa interesse 65%, attualita 15%, precisione territoriale 10%,
confidence 8%, novita 2%. Una strada recente non supera una trasformazione
sostenuta solo perche il documento e piu nuovo.

**Ultimi 30 giorni: 0. Ultimi 90 giorni: 0** fatti accettati.
L'import storico odierno non rende recenti le notizie. Il feed iniziale a 90
giorni mostra onestamente il vuoto e permette di aprire lo storico completo.

## Extraction quality / false positives

50 classificazioni iniziali confrontate con fonti primarie dall'agente:
40 sostenute, 2 limitate a porzioni comuni, 8 escluse. Precisione prudenziale
sulle 42 rimaste: 40/42 = 95,24%; ambigui 2/50. Il campione e stato usato per
correggere le regole: NON e un holdout indipendente ne un'approvazione umana.
La precisione globale e il recall sull'intero archivio rimangono UNKNOWN.

Correzioni da casi reali: ricostruzione di tramezzi/scali/rivestimenti diversa da
ricostruzione di edificio; cambio d'uso esplicitamente negato; categorie catastali
scambiate per urbanistica; corsi sugli espropri; atti fuori territorio; condono
pregresso irrilevante; norme ipotetiche nei PDF; fine lavori futura/mancante o
citata in un atto successivo. Le regressioni conservano questi confini.

**Provenance completa: 1.319/1.319** fatti serviti. Fonte, hash, osservazione,
field/row oppure pagina, offset e versione; date ignote restano ignote.
Non e dimostrato che ogni documento contenga tutti i fatti rilevanti estratti.

## Architecture / migrations

Proiezione JSON sulla gia esistente `public_record_territorial_resolutions`:
nessun secondo archivio. Input hash vincolato al record corrente; proiezioni
obsolete o record revocati non alimentano le viste. RPC bounded solo service-role,
letture con security_invoker. Gli override territoriali non vengono scritti.

`building_events` e immutabile e richiede edificio/data: riusarlo per fatti di
area senza data avrebbe inventato questi attributi. Rimane intatto.

Migration applicate, senza riscrivere le precedenti:

- 0042: proiezione semantica, RPC, vista.
- 0043: incrocio di mercato senza ricalcolare densita documentali per evento;
  riferimento pratica leggibile nella provenienza.
- 0044: aggregati del grafo calcolati una volta per query, stessi risultati.

Le ultime due sono correzioni incrementali dopo l'applicazione della 0042,
non copie materializzate dell'archivio. Lettura misurata locale verso production:
14.492 ms prima, 5.780 ms dopo; campione singolo, non SLA.

Il job BUILDING_DATA_SYNC analizza le risposte gia scaricate da CSV/Albo,
prima di scartare il testo libero. Non rifetcha PDF e non espande fonti.
Ricalcolo cheap senza HTTP e replay invariato conservano i claim verificati.
Lo script `scripts/public-records-facts.ts` e un approfondimento esplicito,
con target confermato, ripresa e limiti; non e un crawler schedulato aggiuntivo.
Il deep PDF richiede Python con pypdf sul sistema che lo avvia; il runtime
ordinario non ha questa dipendenza e non esegue deep analysis automaticamente.

## UI

Dentro `/intelligence?vista=notizie`: filtri richiesti, storico/30/90 giorni,
paginazione, interesse, fatto/interpretazione/non sappiamo e provenienza
espandibile. Le prove delle combinazioni hanno un link diretto anche se l'evento
cade in un'altra pagina. Nessuna pagina/prodotto concorrente.
Nel dossier: Eventi immobiliari pubblici, separati dai documenti grezzi.
Nei punti edificio gia localizzati: numero e tipi dei segnali nel tooltip.
Nessun punto artificiale per un atto di area o per un civico non risolto.

## Invariants

4.074/4.074 hash e first_seen originali invariati. 673/673 date di mercato
conservate rispetto alla fotografia precedente. 480 edifici, 673 property e un
lead, invariati. Nessun cambiamento allo score commerciale o a SISTER/Tecnocloud.

## Tests

653 PASS, 25 SKIP nell'ultima suite completa prima dello smoke. PostgreSQL
PGlite reale sulle migration 0042-0044: PASS. Typecheck, lint, build Next.js e
design:check: PASS. Nessun test saltato viene dichiarato eseguito.

## Deployment

Migration production applicate. Release web/runtime e smoke autenticato saranno
registrati qui a verifica completata. Nessuna distribuzione del desktop.

## Remaining limitations / readiness

READY WITH LIMITATIONS per consultazione storica evidence-bound.
NOT READY per dichiarare nuove opportunita pre-market, intenzioni di vendita o
copertura completa delle trasformazioni correnti. Servono review operatore
indipendenti e approfondimenti mirati dei documenti gia noti, non nuove fonti.
I 1.639 REVIEW, i formati firmati non supportati, gli indirizzi assenti nel 2025,
il recall ignoto e la precisione di singola unita restano espliciti.
