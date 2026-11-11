# Worker V2: sincronizzazione dopo ogni operazione — 9 novembre 2026

## Evidenza del caso Via Giotto

La memoria condivisa del Worker V2 e ferma alla revisione 48 del 26 ottobre 2026. La ricerca di Via Giotto nei record condivisi trova solo il catalogo delle vie, nessuna lavorazione o import odierno. La postazione domestica usa lo stesso progetto e workspace e conferma la stessa revisione. Questo non prova la perdita dei dati sul PC ufficio: se il Worker era offline, bloccato dalla quota o chiuso prima dell'invio, il ledger resta su quel PC e deve essere riaperto per inviarlo. Non presentare Via Giotto come recuperata fino a verifica dal PC sorgente.

## Correzioni 0.34.29

- Ogni commit atomico del ledger attiva la sincronizzazione, anche se la schermata non emette un evento.
- Un commit durante uno scambio in corso genera un nuovo scambio a breve, senza attendere il polling inattivo di 15 secondi.
- Il polling continua a ricevere le azioni degli altri PC e a ritentare dopo disconnessione.
- Il badge specifica che questa postazione e allineata; il pannello distingue ultimo controllo online e ultimo aggiornamento condiviso. Nessuna conferma prima del primo controllo riuscito della sessione.
- Ledger, confronto a tre vie e invii incrementali restano il registro durevole delle modifiche non confermate. Nessuna reimportazione CRM automatica.

## Prove

32 test mirati sincronizzazione passati. Suite CI Worker: 726 test passati in 97 suite. Compilazione desktop passata. Aggiunte prove su commit durante richiesta in volo, commit persistiti senza evento UI e mancata notifica di scritture abortite.

## Verifica residua del caso

Riaprire il Worker sul PC dell'ufficio con la nuova versione e rete disponibile. Verificare conferma online, revisione remota e presenza dell'import Via Giotto sull'altra postazione. Non basta aggiornare il PC di casa per recuperare dati mai inviati dall'ufficio.
