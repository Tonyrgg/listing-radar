# Audit prima delle modifiche: archivio Intelligence

19 ottobre 2026. Base `ab233ef`, working tree inizialmente pulito. Target autorizzato:
`listing-radar-mu.vercel.app`, progetto Supabase `eqqmglsxwbsihrlecnun`.
Il nuovo brief dell'utente sostituisce esplicitamente l'impostazione CRM di PRODUCT.md.

## Superfici e caller

| Area | Route / componenti | Letture e scritture reali | Decisione |
| --- | --- | --- | --- |
| Oggi | `/`, `/dashboard`, `/acquisition/today` | `vistaOggi`, Acquisition OS, eventi V2 | Entrata in Intelligence; niente agenda nella navigazione |
| Mercato | `/dashboard`, `/listings`, `/lifecycle/properties` | repository V2, properties, agency_listings, publications, opportunities | Archivio completo in Intelligence, una riga per property |
| Intelligence | `/intelligence` | `readIntelligence`, viste `market_observer_*`; refresh via coda | Superficie autorevole; conservare quattro viste e provenienza |
| Acquisizioni | `/acquisition/**`, `acquisition/actions.ts` | acquisition_leads/signals/activities/contacts/appointments, monthly_focus, richieste | Togliere UI ordinaria e CTA; preservare tabelle, azioni e RPC compatibili |
| Diario | `/logbook/**`, PropertyLogbook, QuickLogbook | logbook_entries, universal_logbook, monthly_focus | Togliere diario dalla consultazione; nessuna cancellazione storica |
| Guscio | SidebarNav, AppShellFrame, CercaGlobale | QuickRequestDrawer e quick request attualmente globali | Tre destinazioni: Intelligence, Territorio, Fonti, più impostazioni |
| Commerciale | `/matching`, `/requests`, `/portfolio` | CRM e worker, repository matching | Non promuoverlo nel nuovo guscio; backend conservato, desktop escluso |
| Territorio | `/map`, MapClient/Canvas/Sidebar/Modals | `loadMapWorkspace`, map_property_pins, map_areas/streets/pins/activity_logs | Mappa consultiva V2 di tutti gli stati, conservare vecchi dati e azioni senza diario visibile |
| Scheda | `/casa/[id]`, mercato.tsx, nostra.tsx | `vistaCasa`, property/evidence/events/publications/overrides; fallback portfolio CRM | Un solo dossier, ancore interne e documenti, nessuna pipeline |
| Fonti | `/fonti`, `/lifecycle/agencies/**` | vistaAgenzie, sync_runs, source_health, market_observer_sources/runs | Stato leggibile, errore e ultima lettura; nessuna assenza da fetch fallito |
| Edilizia | Buildings importer/practices/address, BUILDING_DATA_SYNC | building_practice_records/observations/buildings, building_data_import_runs, buildings/building_events | RIUSARE: 1.190 pratiche, 509 associazioni edificio, 7 import registrati |
| Scheduler | `.github/workflows/property-lifecycle.yml` | FAST quattro volte/giorno, DEEP rotante, edilizia lunedì; lease e retry esistenti | Conservare job e storico, aggiungere soltanto eventuale catalogazione metadati nello stesso import |
| Acquisition OS | 0010, `acquisition_link_market_opportunity`, RPC intelligence | 1 lead esistente; replay già idempotente | Compatibilità e storico conservati, nessun lead generato dalla consultazione |

Nessuna tabella o migration precedente viene eliminata. Il worker desktop SISTER/Tecnocloud
non rientra nell'intervento. Le vecchie azioni conservate non sono nuove funzionalità sul legacy.

## Audit live delle fonti, prima di correggere

Richieste HTTP ordinarie, adapter esistenti, paginazione completa, nessun bypass.
Le risposte originali e diagnostiche sono in `.runtime/archive/` (non versionate).

| Fonte | Esito osservato | Inventario / pagine | Diagnosi e intervento consentito |
| --- | --- | --- | --- |
| Studi Santi | FAILED, HTTP 403 | 0 / 1 | Redirect ordinario a www, pagina Cloudflare `Attention Required`; anche homepage bloccata. Parser non raggiunto. Nessun fallback inventato, nessuna autorizzazione missing |
| Studio Casa | HEALTHY locale | 52 / 3 | `/srp/?pId=1098672` accessibile e conteggi riconciliati; profilo agenzia 403. L'adapter usa già lo stato strutturato inventory per il dettaglio, non richiede la pagina bloccata. Verificare run production mirata, non riscrivere parser sano |
| Ad Maiora | HEALTHY | 45 / 8 | 74 record backend, 29 esclusi dal pubblico, zero duplicati finali |
| Futura | HEALTHY | 57 / 7 | Totale e paginazione coerenti |
| Garofalo | HEALTHY | 42 / 1 | API pubblica, identità agenzia e filtri vendita/visibile verificati |
| Iconacasa | HEALTHY | 107 / 6 | 110 tutti contratti, 107 vendita; 642 ripetizioni intermedie deduplicate per identità |
| Momento | HEALTHY | 2 / 1 | Fine paginazione e conteggio riconciliati |
| PuntoCasa | HEALTHY | 84 / 16 | 91 tutti contratti, 7 esclusi non vendita |
| Trio | HEALTHY | 10 / 1 | Fine paginazione e conteggio riconciliati |
| Vistocasa | HEALTHY | 112 / 1 | Payload mappa completo 118 tutti contratti, 112 vendita; copre paginazione ASP.NET |

L'adapter HEALTHY non basta per missing: restano baseline, completamento run e grace period
già centralizzati. Il 403 non si corregge alterando selettori o health. L'esito remoto
può differire da quello locale e va mostrato esplicitamente.

## Fonti comunali: contenuto verificato prima di implementare

| Fonte primaria | Accesso / contenuto reale | Geolocalizzabile / collegabile | Automazione / stato |
| --- | --- | --- | --- |
| [Pratiche edilizie 2024](https://www.opendata.maggioli.cloud/dataset/4980aa37-bd65-4cee-a912-dc3b61373ab9/resource/ccd323fa-55f5-4159-9ad6-c49eba97872a/download/comune-di-bitonto-elenco-pratiche_2024.csv) | HTTP 200 CSV ~5,17 MB, applicazione ape, numero pratica, tipo, stato, protocollo, rilascio, via/civico, foglio/particella/sub; contiene dati personali che il parser esistente esclude | Via+civico quando presenti: edificio; particelle conservate; non prova singola unità né conformità | READY, importer settimanale ESISTENTE; nessun nuovo archivio |
| [Catalogo regionale pratiche](https://dati.puglia.it/ckan/dataset/comune-di-bitonto-elenco-pratiche/resource/3f1b7588-60e2-449a-9c13-c369a65c0631) | Metadati e link a CSV generale distinto, non equivalente al 2024 già importato | Da studiare contenuto e volume prima di includerlo | PARTIAL, non aggiungere indistintamente altri anni/dataset |
| [SIT e PRG](https://www.comune.bitonto.ba.it/it/page/sit-sue-e-prg) | HTTP 200; 18 tavole PRG (anche Palombaio/Mariotto), relazione ed elaborati DPP, link SIT e WMS | Documenti di area, NON assegnazione normativa automatica a una property | READY per catalogo URL/titoli e contesto territoriale; PDF/WMS non ancora interpretati |
| [Albo e trasparenza](https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio) | Verifica HTTP diretta successiva al primo web fetch fallito: 200, tabella 20 atti/pagina, 306 risultati in 16 pagine; ID `/papca/display/…`, categoria, oggetto, date pubblicazione, link dettaglio | Alcune ordinanze espongono via/civici (es. Mazzini 51–57; Fornelli 36A/36B), altre sono solo di viabilità e non provano interventi sulle unità | PARTIAL, audit positivo del catalogo, non ancora ingestion degli atti né PDF; non dichiarare ordinanze/condoni acquisiti |
| [Sportello telematico](https://sportellotelematico.comune.bitonto.ba.it/) | Verifica HTTP diretta: 200 dopo il 502 dello strumento web; servizi/modelli di presentazione e contatore aggregato 14.218 pratiche, non elenco consultabile dimostrato | Nessun elenco di singole pratiche dimostrato | NOT AVAILABLE per ingestion pratiche; nessun accesso autenticato automatizzato |
| [SIT cartografico](https://sit.egov.ba.it/it/map/urbanistica-bitonto/qdjango/121/) / WMS | Link ufficiali verificati; recupero viewer non riuscito con strumento web | Possibile geometria, layer e diritti non verificati | PARTIAL, nessuna attribuzione di vincoli o zonizzazione inventata |

### Scelta tecnica

Estendere il medesimo registro `building_practice_records` con metadati documentali
facoltativi e contesto di area, mantenendo osservazioni/hashes/import esistenti.
Esposizione read-only delle pratiche già raccolte e catalogo dei link PRG verificati.
Niente download massivo PDF, nessun archivio di nuove property.
Un civico collega il documento all'EDIFICIO, non certifica che riguardi la singola
unità: dossier e hover lo devono dichiarare. Via senza civico resta ricerca/review.
Date di protocollo/rilascio/ultimo controllo non diventano date di pubblicazione.

## Strategia UI dopo audit

Agente al desktop, luce diurna, consultazione rapida di indirizzi e prove: conservare
la carta calda e l'inchiostro petrolio dei token esistenti, densità da archivio.
Niente immagini generate: dati, cartografia, foto e documenti reali sono il contenuto.
Mercato completo con filtri; opportunità e score secondari e spiegati; Territorio
consultivo con scheda hover/focus/tap e accesso al medesimo dossier. Nessun diario
o creazione richiesta nel guscio, nessuna eliminazione di lead o attività storiche.

## Riscontri della validazione dopo l'audit iniziale

La run production mirata Studio Casa ha completato 52 osservazioni in ~35 s,
HEALTHY, inventario completo e zero missing; la baseline ha correttamente mantenuto
`absence_evaluation_allowed=false` dopo le precedenti letture fallite.
Studi Santi: ancora 403, zero osservazioni e zero missing, nessuna autorizzazione.

Il campione storico ha inoltre dimostrato due errori di accettazione dettaglio:

- PuntoCasa: URL `bitonto-zona-via-palombaio` reindirizza a `...palombaio-3`,
  un locale di 180 m² a €130.000, diverso dalla scheda precedente di 100 m² a
  €190.000. Non basta conservare la source key della richiesta.
- Vistocasa: URL con `articoliid=9251` e `10093` possono terminare su pagina 404
  o ricerca generale con HTTP 200. Un 200 non è prova di presenza.

I normalizzatori ora rifiutano questi cambi d'identità prima della persistenza.
Non ricostruiscono retroattivamente dati mancanti né registrano una vendita.
Regressioni con le destinazioni realmente osservate e fixture dettaglio esistenti.
La normale pagina con reCAPTCHA nel modulo contatti non è una challenge: corretto
anche questo falso positivo del verificatore HTTP, mantenendo il blocco di 403,
Cloudflare challenge e richiesta esplicita di verifica umana.
