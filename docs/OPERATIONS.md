# Uso quotidiano

La migration `0010` è applicata al progetto Cloud dal 28 settembre 2026 e Vercel ha riportato riuscito il deploy del commit applicativo `5f05e49`. Il flusso è stato verificato su Supabase locale isolato; il percorso autenticato nell'app online resta da collaudare.

1. Aprire `/acquisition/today`: appuntamenti, follow-up scaduti e lead A prima delle verifiche. Aprire ogni lead e registrare attività ed esito.
2. Durante la zona aprire `/acquisition/zone`, filtrare località/via/priorità e usare Quick Add da `/acquisition` per cartelli, immobili vuoti, lavori o altre notizie. Indicare almeno indirizzo, motore e segnale; programmare la prossima azione.
3. Verificare le notizie nella scheda lead. Collegare la property V2 quando l'identità è certa; confrontare i possibili duplicati prima di procedere.
4. Prima di contattare verificare origine, consenso operativo, flag sensibile e `do_not_contact`. Successioni e segnalazioni delicate restano intelligence finché la revisione non è conclusa.
5. Dopo una telefonata registrare esito e follow-up. Fissare l'acquisizione dalla scheda; registrare l'esito dopo la visita. L'esito `mandate` segna `WON`.
6. Nelle richieste buyer indicare se deve vendere prima. Se sì, creare la notizia seller dalla scheda richiesta. Consultare `/acquisition/kpi` per il ciclo settimanale e mensile.

La routine 09–10 coda calda, 10–12 zona, 12–13:15 registrazione e pomeriggio appuntamenti/follow-up è una guida, non un vincolo software. Il modello 30 giorni si misura con i KPI a 7/30/90 giorni.

## Diario operativo V2

Dalla coda Oggi registrare una telefonata, nota o visita in zona con
«Registra attività». Selezionare il lead quando esiste: il Diario usa la stessa
attività della pipeline. Se non esiste un lead, collegare la persona o aprire
una nuova notizia da `/acquisition`. Una prossima azione programmata nel
Diario compare in Oggi alla data prevista; segnare «Completata» dopo averla
svolta. Per i follow-up sui lead usare l'esito e la prossima azione della
scheda acquisizione.

In `/logbook` filtrare per mese, tipo, fonte o località. Aprire la scheda
persona o immobile per leggere la cronologia contestuale. In
`/logbook/month` aggiungere le piste, persone e case al Focus; «Da riportare»
mostra il mese precedente senza copiarlo. Chiudere il mese controllando
attività, conversioni e `/acquisition/stale`.

La migration `0011` è stata collaudata su Supabase locale isolato. Questa
documentazione non attesta ancora che sia applicata al progetto Cloud o che
la UI autenticata online sia stata verificata.
