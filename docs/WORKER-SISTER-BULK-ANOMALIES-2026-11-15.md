# Worker 0.34.48 — le anomalie di riga non fermano la coda

## Causa riprodotta sul checkpoint reale

Il checkpoint di Via Crocifisso era completed, con variante found, nessun errore globale e nessun cursore residuo. Conteneva 401 righe completate e sei completed_with_anomalies. La 0.34.47 usava il criterio di completezza di ogni intestatario per decidere se passare alla via successiva: il percorso terminato veniva segnato paused e fermava tutte le altre vie. I retry di rete della precedente versione non correggevano questo caso.

La rilettura non mutativa dell’archivio reale conferma: handled=401, runState=paused, checkpointStatus=completed, strictComplete=false, traversalFinished=true, anomalies=6.

## Comportamento corretto

La conclusione del percorso SISTER e la completezza delle righe sono ora due condizioni distinte. Se tutte le query della via sono found/empty, il checkpoint è completed e non ha lastError, la coda passa alla via successiva. Le righe anomale rimangono in quarantena con prove e motivo; non diventano immobili verificati. Il criterio rigoroso precedente resta disponibile per le funzioni che richiedono tutti gli intestatari verificati.

Una run già salvata come paused/running/failed con questo checkpoint concluso viene recuperata, dopo la verifica della sessione esclusiva, mantenendo ID, impostazioni e 401 immobili. Non riparte per rileggere i sei casi problematici. Le vere query incomplete/fallite, gli errori di sessione e i checkpoint mancanti restano distinguibili da questo caso.

La tabella della coda e il riepilogo indicano le righe da verificare anche per le vie il cui percorso è terminato.

## Verifiche

276 test passati in 37 suite di regressione, incluse la scansione SISTER, quarantena, sincronizzazione e proiezioni desktop. Due regressioni riproducono il falso stop con 401 immobili e sei anomalie e dimostrano il passaggio alla seconda via senza rileggere la prima. Verificata la funzione anche sul checkpoint reale, in sola lettura.

Versione desktop 0.34.48. Installer, release GitHub e integrità del canale verificati nella procedura di consegna. Le prove automatiche non sostituiscono l’osservazione del giro reale: l’esito operativo verrà comunicato separatamente. Non è possibile garantire che un servizio esterno non perda mai connessione o accesso.
