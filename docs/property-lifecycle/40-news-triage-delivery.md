# News Triage V1 — consegna

## 2026 FACTS / NEWS CANDIDATES / REVIEW POOL

[Audit completo e tabella per tipo](39-news-triage-audit.md).
4.074 documenti, 1.319 facts originali conservati integralmente, tre nuove prove
selezionate: **1.322 facts**, di cui **8 nel 2026**. Una card per pratica:
tre REVIEW, tre ARCHIVE_ONLY, zero NEWS_CANDIDATE automatici.
237/237 schede REVIEW 2026 rilette, tre PDF già associati esaminati; nessuna fonte
aggiunta, nessun crawler esteso. La coda non viene riempita con gli atti 2024/25.

## ROOT CAUSE ZERO 30/90

I cinque facts 2026 iniziali erano tutti marzo–maggio, ultimo 19/05, fuori dai
90 giorni. Esistevano 137 documenti recenti: zero facts non significava zero
documenti. La priorità del vecchio CLI favoriva titoli edilizi storici; i 237
REVIEW 2026 non erano ancora stati letti. Ora il deep CLI parte dal cohort 2026
e conserva le proiezioni già archiviate. Date mancanti e localizzazioni deboli
contribuiscono, con conteggi espliciti nell'audit.

## FILTER RULES

`news_triage_v1`, centralizzato lato server: data amministrativa 01/01/2026–oggi
Europe/Rome; fatti raggruppati per record; ordinamento deterministico.
FROM/TO ignoti, significatività/numero unità ignoti e localizzazione incerta
richiedono approfondimento. SCA isolata, sanatorie isolate, manutenzione,
parti comuni, riferimenti contabili e contesto generico restano nell'archivio.
Il completamento può essere spiegato da trasformazioni precedenti dello stesso
building, senza dimostrare la stessa unità. Una disposizione contabile successiva
non è un'offerta; un'asta aggiudicata rimane da verificare.

## BEFORE / AFTER UX

Prima: classificazioni, interesse numerico, certezza della regola, tre colonne
e default 90 giorni vuoto. Ora: titolo umano, indirizzo dichiarato, fatto breve,
perché può contare, mercato conosciuto, tre azioni sempre nello stesso punto.
Lettura verticale, massimo 72ch, controlli tattili e responsive. Prove e dettagli
tecnici chiusi. Filtri: Da valutare / Interessanti / Da approfondire / Scartate,
sette gruppi di utilità. L'archivio storico resta accessibile e usa la stessa
grammatica visiva nel dossier. Torre d'Agera 6 del 2024 resta storico.

## FEEDBACK MODEL

Migration 0045 aggiunge soltanto `public_record_news_feedback`, collegato al
record esistente. Chiave candidate_id + user_id; decisione, motivo facoltativo,
stato, policy, firma prove, date, revisione, cronologia e approfondimento.
RLS per utente, scrittura via RPC autenticate, nessun user_id accettato dal client.
Revisioni impediscono sovrascritture concorrenti e approfondimenti tardivi sopra
una decisione successiva. La lettura non cancella o cambia la decisione umana.
Le prove cambiate dopo la valutazione sono segnalate.

Mostrate: card effettivamente entrate nel viewport, contate una volta per utente.
Interessanti/scartate: ultima decisione. Approfondite: almeno una richiesta nella
cronologia. Motivi aggregati per tipo; nessun ML, nessun automatismo sui facts,
nessuna attività/segnale/lead CRM.

## DEEPEN FLOW

Autenticazione → verifica candidato corrente → decisione DEEPEN persistita →
lettura del record/contesto già noto → scheda primaria Albo → al massimo un
allegato già associato → storia dello stesso edificio e mercato noto → risultato
ENRICHED. Errori lasciano DEEPENING o gap espliciti; non inventano risultati.
Nessuna discovery/link crawling: gli allegati nuovi individuati nell'HTML non
vengono seguiti. Fonti consentite, HTTPS, niente redirect; 8 MB, 20 pagine,
timeout fetch/lettura. Il PDF serverless usa `unpdf` 1.9.1 e non Python su Vercel.
Restano solo span controllati, pagina/hash/URL, dati strutturati e lacune; niente
PDF o descrizione completa persistiti. Prezzi di contesto sono richiesti, non
prezzi di vendita. Superficie/piano dell'unità amministrativa restano ignoti
se non provati. Il catasto dichiarato non certifica una corrispondenza.

## REAL 2026 EXAMPLES

- Palombaio, via L. Ariosto angolo via Petrarca: rilascio 27/03/2026 nella pratica
  21/2024/PDC; ricostruzione/sopraelevazione, indirizzo testuale senza civico
  ufficialmente risolto. REVIEW, nessuna property creata.
- Viale Giovanni XXIII, 01/09/2026: cantiere citato in ordinanza di viabilità,
  civico non dimostrato. REVIEW; il PDF non ha aggiunto un titolo edilizio.
- Corte Abate Marino 8/9, 08/09/2026: aggiudicazione già approvata; REVIEW, non
  offerta attiva. L'accertamento 02/10/2026 resta archivio.

## TESTS

SQL/PGlite sulle migration vere: decisioni e motivi persistiti, isolamento RLS,
date 2024 escluse, revisione concorrente, deepening protetto, statistiche,
facts invariati e zero lead. Test TS: finestra Roma, raggruppamento, storico
come contesto, FROM/TO, manutenzione, gara aggiudicata, contabilità, filtri.
Test UI: blocchi leggibili, nessuna griglia a tre colonne, dettagli chiusi.
Parser PDF serverless esercitato con contenitore PDF reale; host/MIME/dimensione
e indisponibilità verificati. Risultati finali e smoke sotto, dopo il rilascio.

## DEPLOYMENT

Target Supabase `eqqmglsxwbsihrlecnun`: 0001–0044 già presenti, dry-run ha indicato
soltanto 0045, applicata con successo il 20/10/2026. PostgREST notificato.
Web production: https://listing-radar-mu.vercel.app.
Versione e smoke autenticato da riportare a verifica conclusa. Nessun intervento
su SISTER/Tecnocloud o rilascio desktop.

## LIMITATIONS

Non esistono oggi 5–20 candidati forti dimostrati: tre situazioni REVIEW sono
il risultato utile. Il campione è assistito dall'agente, non validazione umana
indipendente. In assenza di contesto edificio non si attribuiscono annunci.
PDF scansionati/firmati/non accessibili e dati mancanti restano UNKNOWN.
ENRICHED significa consultazione delle prove disponibili, non certezza commerciale.
Filtri e statistiche sono personali; lo storico amministrativo rimane condiviso.
