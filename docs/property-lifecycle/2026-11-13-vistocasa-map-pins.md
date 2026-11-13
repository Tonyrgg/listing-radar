# Vistocasa — pin individuali per tutti gli annunci

La lettura dei campi hLat/hLng del dettaglio è generale nell'adapter, non legata all'annuncio 9161. Ogni giro ordinario SYNC legge i dettagli di tutte le voci dell'inventario. Coordinate non valide non sostituiscono quelle utilizzabili dell'inventario.

## Correzione della persistenza

Il precedente identificatore delle posizioni usava soltanto l'indirizzo. Più immobili con la stessa dicitura generica potevano quindi condividere una riga e sovrascriverne le coordinate. I pin pubblicati hanno ora una posizione individuale stabile per fonte e annuncio, indipendente dall'indirizzo generico. I cambi delle coordinate aggiornano la stessa posizione individuale.

La migrazione 0098 consente di passare da una posizione Vistocasa alla nuova posizione individuale a parità di precisione. Il controllo sulle posizioni confermate manualmente precede questa regola; una posizione più precisa continua ad avere precedenza. Nessun pin viene promosso automaticamente a civico o coordinata esatta certificata.

La policy nell'osservazione produce una nuova versione anche per gli annunci già letti con il vecchio identificatore. Gli snapshot precedenti restano conservati.

## Giro di verifica

`scripts/vistocasa-map-audit.ts` unisce inventario corrente e URL Vistocasa già conosciuti. È in sola lettura per impostazione predefinita; `--apply --confirm-project=<ref>` salva tramite la normale osservazione atomica e aggiorna il read model. `--resume-run=<uuid>` riprende soltanto una run aperta della stessa agenzia.

Il giro non valuta assenze e non altera lo stato degli annunci il cui dettaglio non è leggibile. Il report locale è `.runtime/vistocasa-map-audit.json`. Le posizioni aggiornate sono usate dalla scheda immobile e dal read model del territorio tramite `primary_location_id`.

Verifiche: 62 test adapter, compresi separazione degli annunci con uguale indirizzo e ripiego per coordinate nulle/non numeriche/fuori intervallo; typecheck web.
