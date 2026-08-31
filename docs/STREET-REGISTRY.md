# Street Registry canonico di Bitonto

Stato al 1 settembre 2026: migration 0006 e 0007, inventario ufficiale, centri, crosswalk OpenStreetMap e metriche applicati all'ambiente Supabase reale. A database ci sono 1.118 Codvia (1.089 attivi, 29 `needs_review`), 1.089 lavorazioni `owner_network` in stato `pending`, 1 centro città e 15 centri zona, 236 vie con geometria e rank, 266 associazioni di zona primarie. Resta da fare l'aggancio del servizio all'interfaccia desktop del Property Worker. Data dell'audit iniziale: 31 agosto 2026.

Le 853 vie senza geometria hanno `city_rank` nullo e finiscono in fondo alla coda, ordinate per `Codvia`: un ordine stabile ma non geografico. Sono in larga parte gli `ARCO`, `CORTE` e `VICO` del centro storico, che OpenStreetMap non mappa con il nome.

## Obiettivo

Lo Street Registry è l'inventario canonico delle aree di circolazione del Comune di Bitonto. Tiene separati:

1. lo schema dati e la coda durevole di Rete proprietari;
2. l'import dell'inventario ufficiale;
3. il collegamento, con provenienza esplicita, alle geometrie;
4. la definizione dei centri e il calcolo di distanza, rank e ring;
5. il consumo atomico della coda da parte del Property Worker.

`Codvia` è l'identità stabile. Due righe con lo stesso nome ma `Codvia` diverso non vengono mai unite automaticamente.

## Audit del modello esistente

Nel database esistevano tre concetti distinti:

- `map_streets`: stato operativo territoriale, senza inventario completo;
- `internal_zones`: 15 zone immobiliari e di matching Listing Radar;
- `property_worker_jobs.street`: input testuale libero per una singola lavorazione Worker.

Nell'ambiente verificato `map_streets` e `property_worker_jobs` non contenevano righe. Le 15 `internal_zones` erano attive; le zone 1–10 avevano un poligono, mentre 11 Zona Expert, 12 Zona Scuole, 13 Borgo San Francesco, 14 Palombaio e 15 Mariotto non avevano geometria. Gli UUID delle zone non sono assunti stabili: i centri di fallback vengono risolti tramite `zone_number`.

## Fonti e limiti

| Uso | Fonte | Esito |
| --- | --- | --- |
| Inventario e identità | Comune di Bitonto, “Elenco delle aree di circolazione”, catalogo Regione Puglia | Fonte canonica; CSV con `Codvia`, specie, descrizione, CAP e comune; licenza CC BY 4.0 |
| Centro città | CartApulia, scheda di Piazza Cavour | Coordinate del landmark ufficiale usate come centro urbano operativo |
| Geometrie catastali | SIT del Comune di Bitonto, layer “Strade” | Poligoni senza toponimo e senza crosswalk `Codvia`; non importati come geometria nominata |
| Geometrie viarie | DBTI Regione Puglia, tratti/elementi stradali | Linee senza campo toponimo/`Codvia`; utili solo dopo un crosswalk validato |
| Centri zone senza poligono | Geocoding OpenStreetMap/Nominatim | Fonte di supporto, marcata `supporting_geocoder`, non ufficiale |

Il CSV validato conteneva 1.118 `Codvia` univoci. Dopo la normalizzazione per il matching risultavano 39 gruppi di nomi duplicati; 29 record legacy/generici richiedevano revisione. L'importatore rifiuta codici duplicati, righe non Bitonto e intestazioni inattese. Voci generiche o soppresse sono conservate come `needs_review`, non eliminate.

Riferimenti:

- catalogo inventario: <https://dati.puglia.it/ckan/dataset/comune-di-bitonto-elenco-delle-aree-di-circolazione1>
- SIT comunale: <https://comune.bitonto.ba.it/it/page/sit-sue-e-prg>
- DBTI viabilità: <https://webapps.sit.puglia.it/arcgis/rest/services/Operationals/DBTIViabilita/MapServer>
- centro Piazza Cavour: <https://catalogazione.cartapulia.it/api/print/card/12337?profile=STAMPA_PDF_PORTALE>

## Schema

La migration `0006_bitonto_street_registry.sql` aggiunge:

- `street_registry_sources`: provenienza, licenza, hash e conteggio;
- `street_registry_import_runs`: esito riproducibile di ogni fase;
- `street_registry_centers`: un centro città e un centro attivo per zona;
- `street_registry_streets`: inventario ufficiale e metriche città;
- `street_registry_street_zones`: relazione molti-a-molti e metriche per zona;
- `street_registry_work_items`: stato durevole di Rete proprietari;
- `street_registry_worker_queue`: vista di lettura pronta per il Worker;
- `claim_street_registry_work`: presa in carico atomica con lease e `SKIP LOCKED`;
- `complete_street_registry_work`: completamento vincolato al Worker proprietario del lease.

Le corone hanno ampiezza 250 metri. La distanza è la minima distanza fra il centro e la linea della via, non la distanza dal solo centroide. Il rank è deterministico: distanza crescente e `Codvia` come ordine stabile.

## Pipeline operativa

Tutti gli script sono dry-run salvo presenza esplicita di `--apply`.

```powershell
npm run street-registry:import
npm run street-registry:import -- --apply

npm run street-registry:centers
npm run street-registry:centers -- --apply

npm run street-registry:geometry -- --file .\data\street-registry\validated.geojson --source-key validated-crosswalk-v1 --source-url https://example.invalid/source
npm run street-registry:geometry -- --file .\data\street-registry\validated.geojson --source-key validated-crosswalk-v1 --source-url https://example.invalid/source --apply

npm run street-registry:crosswalk

npm run street-registry:metrics
npm run street-registry:metrics -- --apply
```

Ordine di applicazione: migration, inventario, centri, crosswalk, geometrie validate, metriche.

## Crosswalk Codvia → OpenStreetMap

SIT comunale e DBTI Puglia hanno le linee ma non il toponimo: nessuno dei due permette un crosswalk diretto su `Codvia`. L'unica fonte con nome e geometria insieme è OpenStreetMap.

`npm run street-registry:crosswalk` interroga Overpass sul confine amministrativo di Bitonto, normalizza i nomi OSM con la stessa `normalizeStreetName` che ha prodotto l'inventario e genera due file, senza mai scrivere sul database:

- `data/street-registry/osm-crosswalk.geojson`: i candidati pronti per `street-registry:geometry`;
- `data/street-registry/osm-crosswalk-report.json`: tutto ciò che è stato escluso e perché.

Una via entra nel GeoJSON solo se la chiave è univoca su entrambi i lati. Le basi di corrispondenza vengono provate dalla più stretta alla più larga e ogni feature dichiara nelle `match_notes` quale l'ha prodotta:

1. `nome_completo`: nome ufficiale completo identico al nome OSM;
2. `nome_completo_senza_apostrofi`: identico a meno dell'apostrofo, perché l'inventario scrive `CANTU'` e OSM scrive `Cantù`;
3. `descrizione_senza_specie`: la descrizione ufficiale coincide con il nome OSM, che non riporta la specie.

Nessuna geometria viene mai marcata `exact`: il crosswalk è per costruzione una ricostruzione, non un dato del Comune.

### Come vengono riconosciute le omonimie

Una strada reale, per quanto lunga, non è mai più larga di quanto sia lunga: l'estensione dei suoi punti resta sotto la somma dei tratti. Quando l'estensione sfonda quella soglia i tratti sono staccati fra loro, cioè lo stesso nome vive in due posti diversi. Il confronto è fra estensione e lunghezza, non contro un limite fisso in metri: un limite fisso scarterebbe anche le strade provinciali, che sono lunghe e legittime.

L'effetto è visibile: la Strada Provinciale 88 (5.854 m di lunghezza, 5.930 m di estensione) viene accettata, mentre `VIA BERNINI` viene esclusa perché OSM ne conosce due tronconi da 99 m complessivi separati da 12 km.

L'import inventario aggiorna solo i campi ufficiali e crea la lavorazione `owner_network` per le vie attive. Non ritira automaticamente codici assenti in un download successivo. L'import geometrico accetta esclusivamente `LineString`/`MultiLineString` GeoJSON con `properties.official_code` e `properties.match_status` uguale a `exact` o `manual`.

Esempio minimo:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "official_code": "123", "match_status": "manual", "match_notes": "verificato su mappa" },
      "geometry": { "type": "LineString", "coordinates": [[16.69, 41.10], [16.70, 41.11]] }
    }
  ]
}
```

## Associazione alle zone

La relazione è molti-a-molti, ma una sola zona può essere primaria per ogni via. La precedenza è:

1. associazione `manual`, `official` o `geometry_intersection` già validata;
2. località ufficiale Palombaio/Mariotto;
3. corrispondenza univoca con `internal_zones.associated_streets`;
4. zona con centro più vicino, solo quando esiste una geometria valida.

`nearest_center` è sempre una stima operativa e porta confidenza e metadata; non viene presentato come dato ufficiale. Le vie senza geometria e senza un seed non vengono forzate in una zona. Le associazioni validate non vengono sovrascritte dal ricalcolo.

## Contratto Property Worker

`worker/src/services/street-registry.ts` espone tre operazioni:

- `list`: anteprima ordinata per città o zona;
- `claim`: prende atomicamente la prossima via e incrementa i tentativi;
- `complete`: registra esito, risultato/errore e l'eventuale `property_worker_job_id`.

Una lavorazione torna disponibile quando il lease scade, quando l'esito è `to_recheck` e finché `attempts` resta sotto `max_attempts`. Gli esiti `completed`, `skipped` e `failed` non vengono ripresi automaticamente: il ritorno in coda di una via fallita è una decisione manuale.

Il Worker usa la chiave di servizio già prevista per le sue operazioni server-side. Le RPC mutative non sono eseguibili da utenti `anon` o `authenticated`; le tabelle hanno RLS e sola lettura autenticata.

## Cose volutamente non automatizzate

- Nessun merge basato soltanto sul nome.
- Nessuna cancellazione o retirement per assenza temporanea dal CSV.
- Nessuna geometria SIT/DBTI dichiarata “esatta” senza crosswalk `Codvia` revisionabile.
- Nessuna modifica ai record legacy di `map_streets` o ai job Worker esistenti.
- Nessuna applicazione automatica della migration o degli import alla produzione.
