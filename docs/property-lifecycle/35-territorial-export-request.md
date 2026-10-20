# Specifica riutilizzabile — export territoriale pratiche edilizie

**Bozza tecnica, non inviata.** Oggetto: export delle sole informazioni
amministrative e territoriali pubblicabili delle pratiche edilizie del Comune
di Bitonto, anno 2025 ed eventualmente annualità precedenti.

Formato preferito CSV UTF-8 con intestazioni stabili; alternativamente XLSX o
API pubblica documentata e paginata. Una riga per riferimento territoriale della
pratica, ripetendo l'identità della pratica in caso di indirizzi/particelle multipli.

| Campo | Semantica |
|---|---|
| practice_number | Riferimento ufficiale completo, conservando anno e tipo |
| practice_type | CILA/SCIA/PdC/SCA o codice ufficiale documentato |
| practice_date | Data amministrativa ISO YYYY-MM-DD; NULL se assente |
| street | Toponimo dichiarato, possibilmente codice toponomastico ufficiale separato |
| civic | Testo originale, comprese lettere/intervalli/SNC; nessuna espansione implicita |
| locality | Bitonto/Palombaio/Mariotto come dichiarato |
| sheet | Foglio dichiarato, come stringa |
| parcel | Particella dichiarata, come stringa |
| subaltern | Subalterno dichiarato, nullable; assenza non significa intero fabbricato |

Utili se disponibili: stable_record_id, protocol_number, protocol_date,
source_url, document_url, last_modified, stato amministrativo e dizionario
dei codici. Chiedere fonte, licenza, data estrazione e copertura effettiva.

Non sono richiesti nominativi, CF, contatti, proprietari, tecnici incaricati,
testi personali o allegati non pubblicabili. I valori mancanti devono restare
nulli; non sostituire date mancanti con la data di esportazione.

Validazione prevista: unicità ID/pratica+riferimento, data valida, confronto
con metadata annuale già pubblico, completezza dichiarata dall'ente, deduplica
idempotente nello stesso archivio V2 e provenance della singola riga.
Nessuna attestazione automatica di proprietà, conformità o identità dell'unità.
