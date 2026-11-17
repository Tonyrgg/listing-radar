# VistoCasa e Futura: pin individuali e indirizzi — 17 novembre 2026

Il precedente intervento conservava i valori, ma i due adattatori classificavano i pin come aree/sole vie. Inoltre la mappa della scheda non gestiva EXACT_COORDINATES. Ora la scheda mostra lo spillo sulle coordinate pubblicate dalla fonte con la relativa etichetta, senza equipararlo a una verifica del portone.

VistoCasa legge hLat/hLng della singola scheda, non il centro della zona; Futura legge la mappa map-annuncio e mantiene separate le mappe di contatto dell'agenzia. Entrambe le fonti hanno identità di posizione per annuncio. La RPC mantiene precedenza delle conferme manuali e sceglie il nuovo punto individuale, aggiornando l'indirizzo canonico quando la via è nota.

Riscontro del pin tramite OpenStreetMap/Nominatim in un solo processo esplicito, richieste distanziate almeno 1,1 secondi, cache persistente Supabase RLS service-role. Il crawler periodico legge soltanto la cache e non chiama il geocoder pubblico. Il servizio è sostituibile da PUBLISHER_PIN_GEOCODER_URL nello script. Policy: https://operations.osmfoundation.org/policies/nominatim/. Cache negativa conservata. Nessuna scansione a griglia.

La strada ricavata viene aggiunta se prima assente e il risultato è entro 50 m; un civico cartografico viene aggiunto solo entro 20 m e sulla strada compatibile. È esplicitamente un candidato da verificare al portone. Non si sostituiscono mai le coordinate del pin con quelle del geocoder, né si sostituisce un indirizzo esplicitamente dichiarato con una via discordante. Origine, distanza, licenza e identificativo OSM restano negli snapshot. La scheda ne espone il limite.

Caso 10315: pin 41.105598,16.680485, riscontro Via Quinto Orazio Flacco; nessun house_number nella risposta cartografica. La descrizione dice traversa di Via Palombaio, non dichiara l'ingresso su Via Palombaio. Civico non inventato.

Migrazione 0107 applicata online. Aggiornamento positivo dei due cataloghi con scripts/refresh-publisher-pins.ts: non valuta scomparse e non modifica lo stato degli annunci assenti dall'inventario. Dati personali non inviati al geocoder; inviate soltanto le coordinate già pubbliche dei pin.

Verifiche: regressioni adattatori, pin individuali, selezione spillo e riscontro cartografico, TypeScript, build Next.js. Non sono cambiate funzionalità desktop Worker.
