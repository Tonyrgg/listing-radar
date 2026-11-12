# Worker 0.34.35 — tabelle, tema e soggetti correlati

## Interfaccia

- Un solo tema condiviso tra finestra desktop e Worker V2: Instrument Sans locale, superfici verdi scure, navigazione e campi coerenti. Tema chiaro mantenuto con la stessa gerarchia.
- Colonne ordinabili in scheda via e coda, in entrambe le direzioni. Civici e catasto usano confronto numerico naturale; piani interrati precedono terra e piani superiori; valori mancanti restano in fondo. Ordinamento stabile, solo visivo: non cambia la sequenza di esecuzione né le selezioni.
- Coda con tabella compatta, indirizzo, civico, piano, tipologia, foglio/particella/sub, intestatario e stato. Un solo dettaglio aperto. Ricerca e azioni di selezione sopra, conteggio e proseguimento nel piede fisso. Stessa tabella nel riepilogo; strumenti secondari raccolti nel menu.
- Mappa a larghezza invariata dietro il pannello sovrapposto.

## Soggetti correlati

- Ogni aggiunta o aggiornamento di un comproprietario viene verificato rileggendo identità CRM, ruolo e quota prima di toccare il successivo.
- Risposta incerta: nessuna ripetizione automatica di Salva; fino a tre riletture, con riapertura della scheda nei recuperi. Se il collegamento è realmente presente si prosegue; altrimenti errore esplicito, senza confermare il risultato.
- Pausa operatore ed errori globali restano bloccanti. Una sessione scaduta non diventa un esito positivo.
- Ripresa: nuova lettura dei collegamenti esistenti, quindi nessuna nuova aggiunta per il soggetto già correttamente collegato.
- Richieste duplicate o senza identità rifiutate prima delle scritture. Duplicati nella lista CRM non più nascosti da una deduplicazione silenziosa.
- Corretto il controllo finale quando `keepUnlistedManagedOwners` è attivo: i comproprietari conservati non provocano più un falso errore di conteggio; ogni soggetto richiesto deve comunque comparire una sola volta, con ruolo e quota corretti.
- Riconoscimento del rifiuto per proprietario già presente distinto dalla semplice etichetta «Proprietario Principale» nel modulo.

## Verifiche

- TypeScript Worker e compilazione desktop.
- Test regressione Tecnocloud UI, policy proprietà, recupero comproprietari e ordinamenti.
- Prove UI coda (persistenza, selezione, modifiche protette, rimozione e avvio simulato), schede, flussi desktop e confronto tema fra contenitore nativo e mappa, anche passando a tema chiaro.
- Copia temporanea dell'archivio reale: Via Gorizia, 66 immobili; coda 68 elementi; ordinamento conserva selezioni; mappa a larghezza invariata; pannello verificato a 1440, 1024 e 390 px; nessun errore JavaScript.
- Installer 0.34.35, pubblicazione e controllo integrità del canale aggiornamenti richiesti per la consegna.

Nessuna scrittura CRM live eseguita durante questi collaudi. Le prove coprono casi riproducibili e regressioni; non attestano affidabilità assoluta di Tecnocloud. Un esito non verificabile rimane esplicitamente da recuperare, mai successo presunto.
