# Ripristino lettori agenzie — 10 novembre 2026

Trio Casa ritirata dal giro per istruzione del proprietario: `enabled=false`, lavori
QUEUED/RETRY cancellati, storico conservato. Il worker salta le agenzie disabilitate
anche se esiste un vecchio lavoro in coda; il probe ordinario non include più Trio.

Verifiche HTTP reali del 10 novembre: inventario completo e un dettaglio in ambito
per Iconacasa (110), Vistocasa (111), Ad Maiora (46), Futura (56), Garofalo (39),
PuntoCasa (90), Momento Casa (2). Questi sono conteggi di catalogo della fonte,
che può comprendere anche annunci fuori dal territorio monitorato.

Studio Casa (Casa.it) e Studi Santi (sito/sitemap originale) rispondono 403. Anche
un Chromium pulito ha confermato il blocco: nessun CAPTCHA risolto, proxy o servizio
a pagamento usati. I blocchi originali restano espliciti nella diagnostica.

I due adapter ora passano alle pagine pubbliche dei rispettivi editori TrovaCasa:
Studio Casa 91918 e Studi Santi 81203. Si leggono le categorie di vendita effettivamente
linkate dal catalogo: case, commerciale, box/posti auto e terreni, con paginazione
confinata al medesimo editore e riconciliazione dei conteggi. Affitti esclusi.

Qualificazione live: Studio Casa 54 annunci distinti; Studi Santi 84 distinti,
85 schede dichiarate con una ripetizione riconosciuta. Entrambi i lettori
restituiscono HEALTHY/complete, verificando anche i dettagli campione.
Sono gestiti i token foto A_ e X_ con controlli invariati su editore e annuncio.
Per categorie senza conteggio nel titolo viene usato il numero realmente esposto
nella navigazione dell'editore, verificandolo contro le pagine lette.

## Identità e assenze

Una fonte alternativa conferma la presenza, mai l'assenza dal sito originale.
`absenceAuthoritative=false` impedisce l'incremento delle assenze, anche dopo
la stabilizzazione della baseline. Gli ID sono nel namespace `trovacasa.it:`;
le chiavi e le pubblicazioni originali non vengono riscritte.

Il giro veloce verifica fino a due foto anche per questi annunci, per cercare
corrispondenze con le prove visive già note. Un'identità AUTO_MATCH aggiorna il
medesimo immobile; un caso incerto va nella coda IDENTITY, senza creare nuovi
immobili e senza riaprire casi già decisi. La nuova osservazione completa è
conservata nei dettagli del caso. Un successivo abbinamento verificato chiude il
caso aperto. Le date del portale non diventano date originarie dell'incarico.

## Rallentamento rilevato e correzione

Nel giro reale, un controllo `NULL AND EXISTS` invocava il lettore storico globale
quando una nuova pubblicazione non aveva ancora gruppi archiviati. Migrazione 0078:
ramo esplicito prima del sottocontrollo remoto. Una pubblicazione nuova non legge
l'intero archivio; i controlli contro duplicati storici esistenti restano attivi.
Regressione verificata con archivio esterno indisponibile e pubblicazione nuova.
I tentativi precedenti con errori restano registrati come tali, non come successi.

Il drainer ora considera anche i fallimenti nel limite dei tentativi e termina con
exit code nonzero se un lavoro ha fallito. Un inventario FAILED rende fallito il
lavoro agenzia. Prima GitHub poteva risultare verde pur riportando 17 errori per
capacità DB: gli esiti dei workflow non erano una prova del successo delle fonti.

## Distribuzione

La consegna Git è preparata nel worktree `listing-radar-crawler-release`, partendo
da origin/main e includendo il sorgente web già distribuito: i push automatici
non devono ripristinare il vecchio frontend o eliminare il cron Prisma.
Worker desktop escluso dalla modifica. Le migrazioni applicate sono 0077–0078.
I report reali sono nei file ignorati `.runtime/crawler-*`; non sono fixture di test.
