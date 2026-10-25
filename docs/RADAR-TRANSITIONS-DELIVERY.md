# Listing Radar — Cambiamenti immobiliari utili

**Aggiornamento 26 ottobre:** migrazioni 0046–0051 applicate online e web
distribuito. L01 Auth/PostgREST/Next passato. Rilettura primaria di 12 schede
note: 10 elaborate, due strutture non riconosciute con proiezioni conservate;
nessuna nuova fonte. Snapshot 4.102 documenti / 1.328 fatti, zero nuove notizie.
[Consegna e prove correnti](COREIMMOBILIARE-ROLLOUT-2026-10-26.md).
Le sezioni seguenti documentano la preparazione locale del 25 ottobre.

Consegna locale del 25 ottobre 2026. Implementate `property_facts_v2` e
`news_triage_v2`; migrazione **0051 preparata e provata su PostgreSQL incorporato,
non applicata online**. Non sono stati importati nuovi record in produzione.

## Requisiti e comportamento

| Situazione | Risultato |
|---|---|
| «Da uso ufficio ad uso abitativo» | Estrazione di OFFICE → RESIDENTIAL con frase esatta, fonte e data |
| «Divisione in due appartamenti» | Frazionamento con due unità dichiarate; numero iniziale sconosciuto se non esplicito |
| «Terreno da non edificabile a edificabile» | Passaggio dichiarato, gruppo Terreni, sempre da verificare |
| «Area da edificabile a inedificabile» | Direzione inversa conservata; non diventa un miglioramento presunto |
| Variante generica o terreno agricolo | Nessuna edificabilità dedotta; l'effetto concreto resta da chiarire |
| Sopraelevazione, ampliamento o lavori generici | Conservati nell'archivio, esclusi dalle nuove notizie operative |
| Fine lavori / agibilità | Interessano la coda solo con una precedente trasformazione utile nello stesso stabile |
| Scelta manuale già registrata | Resta consultabile anche se la nuova policy archivia quel tipo di lavoro |

Non si deduce un cambio d'uso dalle sole categorie catastali. Una richiesta,
una dichiarazione o un atto urbanistico non certificano automaticamente il
completamento dei lavori, la vigenza di una previsione o l'edificabilità di una
particella. La data amministrativa resta distinta dall'osservazione.

Il filtro Terreni comprende i passaggi espliciti di edificabilità. La firma della
notizia include versione e attributi della trasformazione, così una valutazione
precedente non viene presentata come basata su prove aggiornate. Le decisioni
umane non sono riscritte.

## Conservazione dello storico e migrazione

La migrazione 0051 sostituisce il solo RPC di proiezione, senza nuove tabelle e
senza riscrivere i documenti. Accetta prove V1 ancora valide e nuove prove V2;
una proiezione aggiornata può conservare allegati PDF verificati con V1.

- Un semplice aggiornamento della policy non sostituisce fatti approfonditi con
  la sola classificazione del tipo di pratica.
- Una rilettura primaria V2 migliora il significato del fatto mantenendo la data
  della precedente osservazione quando la prova è la stessa.
- Un hash documento diverso non riusa automaticamente i fatti della versione
  precedente.
- `BUILDABILITY_CHANGED` richiede una frase primaria esplicita, due stati
  distinti e direzione coerente con il testo. Il RPC respinge l'inversione degli
  attributi e mantiene la scrittura riservata al servizio.

Prima del futuro rilascio, 0051 deve precedere le operazioni che salvano nuove
proiezioni V2. Le proiezioni V1 restano leggibili. Non è stato eseguito alcun
ricalcolo o backfill online.

## Verifiche

- Suite web completa: **710 test passati, 25 saltati**, 75 suite passate e due
  saltate. I test saltati non costituiscono una prova.
- Prove finali delle aree modificate: **77 test passati**, già comprese nel
  perimetro della suite; coprono estrazione, triage, versioni e RPC PostgreSQL.
- TypeScript web, ESLint mirato e build Next.js passati.
- La prova SQL conserva il supporto V1, salva una dichiarazione V2 esplicita,
  respinge attributi di edificabilità invertiti e verifica idempotenza e permessi.

I casi testuali sono sintetici. Non dimostrano che nel Comune siano avvenute
quelle trasformazioni o che esistano nuovi venditori.

## Fonti aggiuntive ricercate

### Elenco Pratiche generale — fonte candidata

[Catalogo Regione Puglia](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche)
e [metadati CKAN](https://dati.puglia.it/ckan/api/3/action/package_show?id=comune-di-bitonto-elenco-pratiche).
Il dataset è distinto dall'elenco edilizio 2025 già configurato. Il servizio
pubblico ha risposto il 25 ottobre con **85.601 righe complessive**, aggiornamento
dei metadati `2026-10-22T20:13:12.695234`. Questa non è la data dei singoli atti.

Colonne: Applicazione, Numero Pratica, Oggetto, Data Protocollo, Numero Protocollo,
Ufficio Responsabile. Consultati soltanto metadati, schema e conteggi aggregati;
nessun elenco di nominativi o di singole pratiche è stato acquisito.

Le applicazioni sono etichettate `ape` (77.533 righe) e `apg` (8.068); il loro
significato non è stato presunto. Gli uffici con prefisso 13 contano **2.630 righe**:

| Ufficio dichiarato | Righe aggregate |
|---|---:|
| 13 — Servizio per il Territorio | 2.149 |
| 13.2 — Edilizia Privata | 403 |
| 13.3 — Edilizia Privata | 58 |
| 13.3 — Centro Storico | 18 |
| 13.9 — SUAP e marketing | 2 |

Sono conteggi di procedimenti, non immobili, trasformazioni confermate o lead.
La selezione per parole generiche come «territoriale» include anche servizi
sociali e istruzione: il futuro adattatore dovrà usare gli uffici esatti e poi il
significato del documento. L'endpoint `facets` ha restituito 409; le aggregazioni
SQL in sola lettura hanno funzionato.

Prima di integrare la fonte: campione limitato ai codici ufficio pertinenti,
verifica di date/oggetto e disponibilità della prova primaria, confronto con gli
atti già archiviati, aggiornamento incrementale e nessuna identificazione di
particella dedotta dall'ufficio o dal titolo.

### Pianificazione e approvazioni

Il [catalogo comunale SIT e PRG](https://www.comune.bitonto.ba.it/it/page/sit-sue-e-prg)
pubblica tavole PRG e documenti preliminari del PUG. Un catalogo di tavole non
dimostra da solo una nuova destinazione di un terreno. La consultazione live del
front-end SIT non è riuscita in questa sessione; non si attribuisce validità
urbanistica alle sole mappe o ai loro cambiamenti grafici.

Il [BURP, delibera 513/2021](https://burp.regione.puglia.it/documents/20135/1504482/DEL_513_2021.pdf/6081156e-de11-b00b-4ddf-5ab039eba806?t=1623132282117)
contiene un esempio storico di approvazione definitiva di variante normativa
per la zona D4 di Bitonto. È una pista per incrociare atti e allegati regionali
con quelli comunali, non un nuovo evento 2026 o la prova di una particella ora
edificabile. Nessun connettore BURP è stato attivato.

## Lavoro ancora necessario

Rivedere le prove reali e il campione congelato già esistente; verificare la nuova
fonte con un campione circoscritto prima dell'integrazione; collaudare e rilasciare
il codice e la migrazione nell'ambiente previsto. Eredità, nuove fonti sociali e
VAB restano nelle fasi successive stabilite dall'utente.
