# Listing Radar — estensione e qualità delle fonti pubbliche

Prima iterazione locale; la consegna successiva include Supabase online, il registro
generale e la coda documenti: [stato aggiornato](RADAR-DOCUMENTS-DELIVERY-2026-10-26.md).

## Stato della modifica

Intervento locale sul Property Lifecycle V2. Nessuna migration, scrittura online,
import live, richiesta al Comune o modifica della configurazione di produzione.
Le aste e le procedure giudiziarie restano fuori dal trattamento.

## Risultati verificati sul registro 2025

La risorsa pubblica del [catalogo Open Data Regione Puglia](https://dati.puglia.it/v2/dataset/comune-di-bitonto-elenco-pratiche-edilizie-2025)
restituisce 11.577 righe e due applicazioni:

| Applicazione | Righe | Pratiche distinte | Ultimo protocollo |
|---|---:|---:|---|
| `ape` | 9.424 | 1.161 | 31/12/2025 |
| `apg` | 2.153 | 1.631 | 31/12/2025 |

Le pratiche distinte sono state conteggiate per numero pratica all’interno di
ciascuna applicazione; le righe ripetute non sono immobili distinti. Per alcuni
termini di trasformazione il conteggio aggregato mostra anche record `apg`
potenzialmente pertinenti, ma il significato dei codici e l’esito delle pratiche
non sono certificati dall’oggetto libero. Questo non autorizza a promuoverli a
fatti immobiliari.

## Modifiche implementate

- Il sync del registro 2025 importa tutte le applicazioni presenti, mantenendo
  separate le chiavi `ape` e `apg`. Il registro 2024 conserva il filtro esistente.
- Il testo libero del registro 2025 non genera più fatti primari. Per ogni pratica
  viene prodotta una proiezione vuota: al prossimo sync vengono rimosse anche le
  eventuali inferenze testuali create in precedenza, conservando record e prove PDF
  verificate separatamente.
- Le run delle pratiche registrano date minima/massima di protocollo, gruppi con
  data, gruppi localizzati, riferimenti catastali, conteggio per applicazione,
  duplicati e link a documenti primari. Il registro 2025 dichiara zero link perché
  la fonte non ne pubblica.
- La pagina **Fonti** mostra questi indicatori e descrive OMI come contesto di zona.
  Il download OMI strutturato è nell’area riservata; non è stata introdotta
  automazione autenticata. La consultazione pubblica rimane disponibile [sulla
  mappa Agenzia Entrate](https://www1.agenziaentrate.gov.it/servizi/geopoi_omi/index.htm).

## I cinque punti: avanzamento

1. **Pratica → documento primario:** il registro 2025 è un indice; il collegamento
   automatico agli atti resta da realizzare. L’Albo è già acquisito e fornisce link
   quando pubblicati, ma i dati del registro non contengono identificatori territoriali
   o URL dell’atto. Non si inventano corrispondenze dal solo oggetto.
2. **Eventi immobiliari utili:** V2 classifica già frazionamenti, fusioni, cambi d’uso,
   edificabilità e fasi dei lavori. Questa modifica evita che il solo indice 2025
   produca fatti; la conferma resta legata all’atto e alle prove disponibili.
3. **Localizzazione:** gli adapter esistenti collegano indirizzi ufficiali e atti
   pubblici a via/edificio con confidenza e livello territoriale. Il registro 2025
   non fornisce indirizzi/catasto strutturati; il SIT/PRG resta catalogo/cartografia,
   non resolver automatico. Nessuna unità viene dedotta.
4. **Contesto di mercato:** annunci e cronologie già alimentano il V2. OMI è indicativo
   per zona e semestre, non per immobile. Per ora resta consultazione manuale perché
   il download massivo verificato richiede accesso autenticato.
5. **Qualità delle fonti:** la pagina **Fonti** ora espone freschezza dei protocolli,
   copertura territoriale, duplicati e link primari sulle run dei registri edilizi.
   Nessun dato personale è mostrato nei nuovi indicatori.

## Verifiche locali

- `npm.cmd exec vitest run -- tests/property-lifecycle/buildings.test.ts tests/property-lifecycle/public-records-phase2.test.ts tests/property-lifecycle/facts-versioning.test.ts`
  — 39 test superati.
- `npm.cmd run typecheck` — superato.
- ESLint sui file modificati — superato.
- `git diff --check` — superato.

Il prossimo sync schedulato è necessario per popolare le nuove metriche su dati reali
e includere i record `apg`. Non è stato avviato in questa modifica.
