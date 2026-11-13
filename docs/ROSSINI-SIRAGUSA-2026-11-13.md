# Worker 0.34.43 e Radar: tipi scheda, passaggi agenzia e durata

## Rossini

Lo screenshot nuovo mostra `Tipo della scheda non verificato`, introdotto dalla
protezione 0.34.42, non un mancato inserimento dopo copertura mensile dimostrata.
Il classificatore pretendeva un codice numerico e il lettore cercava il codice
in h1/h2 o nel contenitore `.slds-page-header`. Le altre forme rimanevano unknown.

Estesi codici a suffissi alfanumerici e trattini Unicode, titoli Lightning
`.slds-page-header__title`, nome/tipo record espliciti e link allo stesso ID.
I link ad altri record non provano il tipo della scheda corrente. NT/IN restano
prioritari e protetti. Il solo URL /immobile non autorizza scritture.
Un tipo ancora sconosciuto è errore globale riprendibile: il giro attende sul
caso invece di accantonare in cascata il resto della coda. Il checkpoint riporta
ID, tipo unknown e intestazione letta per la diagnosi.

84 test Worker in sei suite, inclusa una pagina con titolo alfanumerico fuori
h1/h2 e un link NT estraneo, poi trasformata in IN per verificare il blocco.
Compilazione desktop. Non disponibile Chrome dell'ufficio: l'utente ha confermato
di non poterlo aprire sul PC collegato alla chat. Nessuna prova o scrittura CRM
reale è stata eseguita; non si certifica la soluzione sul markup della postazione.

## Siragusa e casistiche agenzia

Prima: proprietà `3b8b6700-4923-450e-ac85-a6c0014dad7d`, Via Vito Siragusa 19,
Ad Maiora, CLOSED_SWITCHED / AGENCY_CHANGED, indice 65. Il modello materializzato
manteneva la motivazione di opportunità anche dopo una conferma manuale del cambio.

0094: la vista live applica subito lo stato del rapporto e una conferma PROPERTY
`current_agency`. Un vecchio rapporto CLOSED_SWITCHED ha indice zero; una nostra
agenzia confermata ha ruolo OUR_AGENCY, indice zero e nome/ID del ramo effettivo.
La conferma non inventa una pubblicazione o un incarico CRM, conserva le vecchie
osservazioni e produce un evento audit. RPC solo service_role, revisore reale,
ramo proprio univoco, data non futura; le conferme successive supersedono le prime.
La scelta Non più nostra permette di revocare la conferma senza cancellarla.

Applicata e registrata 0094. Registrata la conferma esplicita dell'utente per
Siragusa 19 tramite la RPC service-role. Ramo riconosciuto univocamente:
Tecnocasa Bitonto — Immobiliare San Francesco D.I. Verificato nel DB OUR_AGENCY,
ACTIVE, indice 0. Data di ingresso NULL: non comunicata dall'utente.

Nel dossier il modulo permette Ora nella nostra agenzia, eventuale data nota e
revoca; invalida la cache Lifecycle. Una scheda nostra non conserva le motivazioni
dell'opportunità né il contesto opportunità passato nell'URL. La sintesi separa
tempo sul mercato e permanenza nell'agenzia attuale; ciascuna agenzia storica
riporta il periodo osservato. Le durate sono osservate/minime, non scadenze di
incarichi inferite. La nostra data ignota rimane esplicita.

Sei test web (RPC atomica, cambio/revoca, date sconosciute e dossier prezzi),
typecheck e build di produzione Next via webpack passati. Turbopack locale
non accetta la junction node_modules esterna al worktree: nessuna modifica
alla configurazione di produzione per aggirare il limite locale.
