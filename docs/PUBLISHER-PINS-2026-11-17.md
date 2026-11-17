# VistoCasa e Futura: pin individuali e indirizzi — 17 novembre 2026

Il precedente intervento conservava i valori, ma i due adattatori classificavano i pin come aree/sole vie. Inoltre la mappa della scheda non gestiva EXACT_COORDINATES. Ora la scheda mostra lo spillo sulle coordinate pubblicate dalla fonte con la relativa etichetta, senza equipararlo a una verifica del portone.

VistoCasa legge hLat/hLng della singola scheda, non il centro della zona; Futura legge la mappa map-annuncio e mantiene separate le mappe di contatto dell'agenzia. Entrambe le fonti hanno identità di posizione per annuncio. La RPC mantiene precedenza delle conferme manuali e sceglie il nuovo punto individuale, aggiornando l'indirizzo canonico quando la via è nota.

Riscontro del pin tramite OpenStreetMap/Nominatim in un solo processo esplicito, richieste distanziate almeno 1,1 secondi, cache persistente Supabase RLS service-role. Il crawler periodico legge soltanto la cache e non chiama il geocoder pubblico. Il servizio è sostituibile da PUBLISHER_PIN_GEOCODER_URL nello script. Policy: https://operations.osmfoundation.org/policies/nominatim/. Cache negativa conservata. Nessuna scansione a griglia.

La strada ricavata viene aggiunta se prima assente e il risultato è entro 50 m; un civico cartografico viene aggiunto solo entro 20 m e sulla strada compatibile. È esplicitamente un candidato da verificare al portone. Non si sostituiscono mai le coordinate del pin con quelle del geocoder, né si sostituisce un indirizzo esplicitamente dichiarato con una via discordante. Origine, distanza, licenza e identificativo OSM restano negli snapshot. La scheda ne espone il limite.

Caso 10315: pin 41.105598,16.680485, riscontro Via Quinto Orazio Flacco; nessun house_number nella risposta cartografica. La descrizione dice traversa di Via Palombaio, non dichiara l'ingresso su Via Palombaio. Civico non inventato.

Migrazione 0107 applicata online. Aggiornamento positivo dei due cataloghi con scripts/refresh-publisher-pins.ts: non valuta scomparse e non modifica lo stato degli annunci assenti dall'inventario. Dati personali non inviati al geocoder; inviate soltanto le coordinate già pubbliche dei pin.

Verifiche: regressioni adattatori, pin individuali, selezione spillo e riscontro cartografico, TypeScript, build Next.js. Non sono cambiate funzionalità desktop Worker.

La migrazione 0108 impedisce inoltre di perdere via/civico già noti sullo stesso pin qualora una lettura successiva li ometta. Il confronto manuale resta prioritario. Per i timeout della manutenzione è disponibile --long-timeout: solo dopo annullamento PostgreSQL 57014, ripete la stessa RPC atomica con limite locale di 55 secondi; non cambia i timeout globali né esegue scritture ad hoc. Gli errori HTTP si riprovano tramite selezione esplicita degli ID.

Prova browser del componente reale: coordinate del caso 10315, un marker, zero poligoni d'area, zero errori JavaScript. Esito locale ignorato .runtime/pin-fix/map-check.json e screenshot map-marker.png.

Esito finale online: 113 dettagli VistoCasa e 57 Futura letti. Nel territorio seguito rientrano rispettivamente 112 e 49 annunci; nove esclusioni geografiche. Sei errori temporanei recuperati con passaggi mirati. Rilettura finale sulle posizioni primarie: 112/112 pin VistoCasa e 49/49 Futura coincidono con i valori pubblicati, nessun disaccordo e nessun pin rimasto con precisione di area.

Indirizzi disponibili dopo il doppio riscontro (anche livello strada sui casi inizialmente senza indirizzo): VistoCasa 97 vie e 9 civici; Futura 49 vie e 3 civici. I numeri comprendono valori dichiarati o candidati cartografici, non equivalgono a verifiche del portone. Restano 15 vie VistoCasa e numerosi civici non determinati: le fonti consultate non offrono una base sufficiente per attribuirli. Il caso 10315 ha Via Quinto Orazio Flacco e pin della fonte, senza civico dimostrabile.

Il livello strada una tantum è attivabile con --street-level-lookup, memorizza livello e precedente riscontro nella cache senza interrogazioni ripetute allo stesso livello. I report dettagliati restano locali ignorati in .runtime/pin-fix/. Nessuna operazione di manutenzione chiusa dichiarata riuscita senza rilettura dei valori effettivi.
